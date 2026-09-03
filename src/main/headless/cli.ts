/**
 * 无头导出核心（纯 Node，**绝不** import electron）。
 *
 * 本模块被两处复用：
 *   ① `src/main/headless.ts` → 打包为 `out/main/headless.js`，可用 `node` 直跑，
 *      也可用 `ELECTRON_RUN_AS_NODE=1 <ChatArk 可执行文件>` 以应用内置的 Node 运行；
 *   ② `src/main/index.ts` 的无头分支（Electron 主进程被带 `--export*` 参数拉起时）。
 *
 * 职责分两层：
 *   - **启动器**（`--export-stdin`）：读 SessionEnd 钩子的 stdin JSON，派生一个脱离父进程的
 *     后台 worker 后立刻退出。钩子进程等的是 stdio 管道关闭，故 worker 的 stdio 一律不继承
 *     （`'ignore'` + 日志 fd），否则钩子会一直阻塞到导出结束。
 *   - **worker**（`--export-worker <transcript>`）：真正解析、落盘、起标题，全程只写
 *     `<userData>/logs/auto-export.log`，不占用任何终端输出。
 *
 * 全链路的退出码原则：自动导出失败绝不阻断用户的 Claude Code 会话，启动器一律返回 0。
 */
import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process'
import { closeSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { autoExportLogPath, locksDir, resolveUserDataDir } from '../services/app-paths'
import { exportSession, listSessions, type ExportOutcome } from '../services/exporter'
import { titleLockCallbacks } from '../services/exporter/title-lock'
import { TITLEGEN_ENV_MARK } from '../services/exporter/titlegen'
import { acquireFileLock, releaseFileLock } from '../services/fs/file-lock'
import { appendLogLine, openLogFd, rotateIfLarge } from '../services/hook/export-log'
import { runLibraryMaintain } from '../services/library-maintain'
import { isMigrationLocked } from '../services/migration/lock'
import { getLibraryRoot } from '../services/settings/store'

// ---- 参数与常量 ----

const FLAG_MAINTAIN = '--library-maintain'
const FLAG_EXPORT_STDIN = '--export-stdin'
const FLAG_EXPORT_WORKER = '--export-worker'
const FLAG_EXPORT = '--export'
const FLAG_USER_DATA = '--user-data'
const FLAG_SESSION = '--session'
const FLAG_REASON = '--reason'
const FLAG_NO_DETACH = '--no-detach'
const FLAG_DRY_RUN = '--dry-run'
const FLAG_CONFIRM = '--confirm'
const FLAG_LIMIT = '--limit'

/** 令 worker 以纯 Node 运行 Electron 二进制。用 `node` 直跑时该变量无副作用。 */
const RUN_AS_NODE_ENV = 'ELECTRON_RUN_AS_NODE'

/**
 * AppImage 的 execPath 位于临时挂载点，父进程一退出即卸载，detach 出去的 worker 会失去
 * 可执行映像。该平台一律进程内 inline 运行，牺牲钩子返回速度换取可用性。
 */
const APPIMAGE_ENV = 'APPIMAGE'

/** stdin 读取兜底：钩子不给输入时不能挂死。启动器要求亚秒级返回，故取 1 s。 */
const STDIN_TIMEOUT_MS = 1000

/** 会话锁陈旧阈值：单次导出（含 LLM 起名）远快于此，超时即认定持有者已崩溃。 */
const SESSION_LOCK_STALE_MS = 10 * 60 * 1000

/** 锁文件名中允许的会话标识长度上限（超长文件名在部分文件系统上会被拒）。 */
const MAX_SID_LEN = 80

/** 日志里错误信息的截断长度：单行日志不该被堆栈撑爆。 */
const MAX_ERROR_LEN = 200

/** 日志 mode 字段取值。 */
const MODE_LAUNCHER = 'launcher'
const MODE_WORKER = 'worker'

export interface HeadlessArgs {
  mode: 'stdin' | 'worker' | 'path' | 'session' | 'maintain'
  /** path/session/worker 模式的目标：转录路径或 sessionId */
  value?: string
  userData?: string
  sessionId?: string
  /** SessionEnd 钩子的 reason（clear/resume/logout/prompt_input_exit/other），仅用于日志 */
  reason?: string
  /** 强制进程内 inline 运行 worker，不 detach（排障与 AppImage 用） */
  noDetach?: boolean
  dryRun?: boolean
  confirm?: boolean
  limit?: number
}

/** 取 `--flag <value>` 的取值；缺参或下一位又是选项时视为未给。 */
function flagValue(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag)
  if (i < 0) return undefined
  const v = argv[i + 1]
  return v !== undefined && !v.startsWith('--') ? v : undefined
}

/** 各模式通用的选项；仅收录真正出现的项，便于调用方做全等断言。 */
function commonOpts(argv: readonly string[]): Partial<HeadlessArgs> {
  const userData = flagValue(argv, FLAG_USER_DATA)
  const sessionId = flagValue(argv, FLAG_SESSION)
  const reason = flagValue(argv, FLAG_REASON)
  return {
    ...(userData ? { userData } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(reason ? { reason } : {}),
    ...(argv.includes(FLAG_NO_DETACH) ? { noDetach: true } : {})
  }
}

/** `--limit n`：非正整数一律忽略（宁可全量处理，也不因笔误静默截断）。 */
function limitOpt(argv: readonly string[]): number | undefined {
  const raw = Number(flagValue(argv, FLAG_LIMIT))
  return Number.isFinite(raw) && raw > 0 ? raw : undefined
}

/**
 * 解析无头参数。非无头调用或参数缺失一律返回 null（不抛异常），
 * 调用方据此判断「本次是 GUI 启动」。
 */
export function parseHeadlessArgs(argv: readonly string[]): HeadlessArgs | null {
  if (argv.includes(FLAG_MAINTAIN)) {
    const limit = limitOpt(argv)
    return {
      mode: 'maintain',
      ...commonOpts(argv),
      ...(argv.includes(FLAG_DRY_RUN) ? { dryRun: true } : {}),
      ...(argv.includes(FLAG_CONFIRM) ? { confirm: true } : {}),
      ...(limit !== undefined ? { limit } : {})
    }
  }
  if (argv.includes(FLAG_EXPORT_STDIN)) return { mode: 'stdin', ...commonOpts(argv) }

  const worker = flagValue(argv, FLAG_EXPORT_WORKER)
  if (worker) return { mode: 'worker', value: worker, ...commonOpts(argv) }
  if (argv.includes(FLAG_EXPORT_WORKER)) return null // 给了标志却没给转录路径

  const target = flagValue(argv, FLAG_EXPORT)
  if (target) {
    const mode = target.endsWith('.jsonl') ? 'path' : 'session'
    return { mode, value: target, ...commonOpts(argv) }
  }
  return null
}

// ---- 输出与 stdin ----

/**
 * 无头模式的 stdout/stderr 可能被上游提前关闭：SessionEnd 钩子场景下 Claude Code 会话
 * 一结束即断开管道，写入触发 EPIPE。未监听 stream error 时该错误会变成未捕获异常。
 */
export function silenceEpipe(): void {
  const ignore = (e: NodeJS.ErrnoException): void => {
    if (e?.code !== 'EPIPE') console.error('无头导出输出失败：', e)
  }
  process.stdout.on('error', ignore)
  process.stderr.on('error', ignore)
}

/** 写入并等待落盘；管道已关（EPIPE）时回调仍被调用，避免 exit 截断未写完的缓冲。 */
export function writeAndFlush(stream: NodeJS.WritableStream, text: string): Promise<void> {
  return new Promise((resolve) => {
    stream.write(text, () => resolve())
  })
}

/** JSON 文本 → 普通对象；数组、null 与解析失败一律返回 null。 */
function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(raw)
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
    return v as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * stdin 读取结果。超时（钩子没给输入）与负载不合法是两类完全不同的故障，
 * 混成一个 null 会让日志无法区分「钩子没喂数据」与「喂了但不是 JSON 对象」。
 */
export type StdinRead =
  | { kind: 'ok'; payload: Record<string, unknown> }
  | { kind: 'timeout' }
  | { kind: 'bad-payload' }

/** 读取钩子送来的 JSON；到 end 或超时即解析。一个字节都没收到的超时单独归类。 */
export function readStdinJson(stream: NodeJS.ReadableStream, timeoutMs = STDIN_TIMEOUT_MS): Promise<StdinRead> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (timedOut: boolean): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (timedOut && chunks.length === 0) return resolve({ kind: 'timeout' })
      const payload = parseJsonObject(Buffer.concat(chunks).toString('utf8'))
      resolve(payload ? { kind: 'ok', payload } : { kind: 'bad-payload' })
    }
    stream.on('data', (c: Buffer | string) => chunks.push(Buffer.from(c)))
    stream.on('end', () => finish(false))
    stream.on('error', () => finish(false))
    timer = setTimeout(() => finish(true), timeoutMs)
    timer.unref?.()
  })
}

/** 转录路径可用性校验：钩子 JSON 的取值不可信，后缀与文件类型都要核。 */
function isUsableTranscript(p: string): boolean {
  if (!p.toLowerCase().endsWith('.jsonl')) return false
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** 对象取字符串字段；类型不符或空串返回 undefined。 */
function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key]
  return typeof v === 'string' && v ? v : undefined
}

function errorLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return (msg.split('\n')[0] ?? '').slice(0, MAX_ERROR_LEN)
}

// ---- worker 派生 ----

/** spawn 注入点：只用到 pid、unref 与 error 监听，`child_process.spawn` 天然满足。 */
export type SpawnFn = (
  cmd: string,
  args: readonly string[],
  opts: SpawnOptions
) => {
  pid?: number | undefined
  unref: () => void
  /** 派生失败（ENOENT / EACCES）以异步事件报出，不监听会变成未捕获异常 */
  on: (event: 'error', listener: (err: Error) => void) => unknown
}

export interface WorkerSpawnParams {
  execPath: string
  scriptPath: string
  transcript: string
  userData: string
  sessionId?: string
  reason?: string
  /** 日志文件 fd：worker 的 stdout/stderr 直接指向它，绝不继承钩子的管道 */
  logFd: number
  env: NodeJS.ProcessEnv
}

export interface WorkerSpawnPlan {
  cmd: string
  args: string[]
  opts: SpawnOptions
}

/** 构造后台 worker 的 spawn 参数（纯函数，不产生副作用）。 */
export function buildWorkerSpawn(p: WorkerSpawnParams): WorkerSpawnPlan {
  return {
    cmd: p.execPath,
    args: [
      p.scriptPath,
      FLAG_EXPORT_WORKER,
      p.transcript,
      FLAG_USER_DATA,
      p.userData,
      ...(p.sessionId ? [FLAG_SESSION, p.sessionId] : []),
      ...(p.reason ? [FLAG_REASON, p.reason] : [])
    ],
    opts: {
      detached: true,
      stdio: ['ignore', p.logFd, p.logFd],
      env: { ...p.env, [RUN_AS_NODE_ENV]: '1' },
      // 钩子进程的 cwd 是用户的项目目录：worker 活得比它久，继承该 cwd 会挡住目录删除
      // （Windows）并在目录已消失时令 spawn 直接失败。固定到系统临时目录。
      cwd: tmpdir(),
      windowsHide: true
    }
  }
}

// ---- 导出执行 ----

/** 会话标识转锁文件名：来自钩子 JSON 的取值不可信，只保留安全字符并限长。 */
function lockName(sid: string): string {
  const safe = sid.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, MAX_SID_LEN)
  return safe || 'unknown'
}

/** 汇总行的 result 取值。 */
function outcomeResult(r: ExportOutcome): string {
  if (r.ok) return r.unchanged ? 'unchanged' : 'ok'
  return r.skipped ? 'skipped' : 'failed'
}

/** 退出码：跳过（haiku / 自动注入派生会话）不是错误。 */
function exitCodeFor(r: ExportOutcome): number {
  return r.ok || r.skipped ? 0 : 1
}

interface ExportOnceParams {
  transcript: string
  userData: string
  sid: string
  /** SessionEnd 钩子的 reason，仅记入汇总行 */
  hookReason?: string
}

/**
 * 执行一次导出并写诊断日志：后台 worker 与 `--export` 命令共用同一路径，
 * 保证两种触发方式的日志形态与标题串行策略完全一致。
 */
async function exportOnce(p: ExportOnceParams): Promise<ExportOutcome> {
  const logPath = autoExportLogPath(p.userData)
  const startedAt = Date.now()
  const outcome = await exportSession({
    sourceJsonl: p.transcript,
    historyRoot: getLibraryRoot(),
    titleMode: 'llm',
    onLog: (fields) => appendLogLine(logPath, { mode: MODE_WORKER, sid: p.sid, ...fields }),
    ...titleLockCallbacks(p.userData)
  })
  appendLogLine(logPath, {
    mode: MODE_WORKER,
    sid: p.sid,
    result: outcomeResult(outcome),
    ms: Date.now() - startedAt,
    title: outcome.meta?.title ?? '',
    dir: outcome.dir ?? '',
    titled: outcome.titled ? 1 : 0,
    reason: p.hookReason ?? ''
  })
  return outcome
}

export interface WorkerParams {
  transcript: string
  userData: string
  sessionId?: string
  reason?: string
}

/**
 * 后台 worker：同一会话只允许一个实例落盘（会话锁），其余直接退出。
 * 无论成败都不向 stdout/stderr 写字节——它的输出端就是日志文件。
 */
export async function runWorker(p: WorkerParams): Promise<number> {
  const logPath = autoExportLogPath(p.userData)
  const sid = p.sessionId ?? basename(p.transcript).replace(/\.jsonl$/i, '')
  const sessionLock = join(locksDir(p.userData), `session-${lockName(sid)}.lock`)

  if (!acquireFileLock(sessionLock, SESSION_LOCK_STALE_MS)) {
    appendLogLine(logPath, { mode: MODE_WORKER, sid, result: 'skip-duplicate' })
    return 0
  }
  try {
    const outcome = await exportOnce({
      transcript: p.transcript,
      userData: p.userData,
      sid,
      ...(p.reason ? { hookReason: p.reason } : {})
    })
    return exitCodeFor(outcome)
  } catch (e) {
    appendLogLine(logPath, { mode: MODE_WORKER, sid, result: 'worker-error', error: errorLine(e) })
    return 1
  } finally {
    releaseFileLock(sessionLock)
  }
}

// ---- 启动器 ----

/** 运行期注入点：GUI 与纯 Node 入口各自提供，测试可全部替换。 */
export interface HeadlessIo {
  stdin?: NodeJS.ReadableStream
  /** 派生 worker 用的可执行文件（Electron 二进制或 node） */
  execPath?: string
  /** worker 脚本绝对路径（out/main/headless.js） */
  scriptPath?: string
  /** GUI 侧的 userData 兜底：argv 与调用方都没给时才用 */
  userData?: string
  spawn?: SpawnFn
}

export interface LauncherParams extends HeadlessIo {
  argv: readonly string[]
  env: NodeJS.ProcessEnv
}

/** userData 优先级：argv `--user-data` > 调用方注入 > 环境变量/平台默认。 */
function resolveUserData(args: HeadlessArgs | null, p: LauncherParams): string {
  return args?.userData ?? p.userData ?? resolveUserDataDir(p.argv, p.env)
}

/**
 * `--export-stdin` 启动器：读钩子 JSON → 派生后台 worker → 立刻返回。
 * 任何异常都记日志后返回 0：自动导出绝不阻断用户会话。
 */
export async function runLauncher(p: LauncherParams): Promise<number> {
  const args = parseHeadlessArgs(p.argv)
  const userData = resolveUserData(args, p)
  const logPath = autoExportLogPath(userData)

  // 自激循环第一道防线：本次会话由 titlegen 派生的 claude 产生，导出它只会再派生 claude。
  if (p.env[TITLEGEN_ENV_MARK]) {
    appendLogLine(logPath, { mode: MODE_LAUNCHER, result: 'skip-titlegen' })
    return 0
  }

  try {
    const read: StdinRead = p.stdin ? await readStdinJson(p.stdin) : { kind: 'timeout' }
    if (read.kind !== 'ok') {
      // stdin-timeout：钩子未喂输入或喂得太慢；bad-payload：喂了但不是 JSON 对象
      appendLogLine(logPath, {
        mode: MODE_LAUNCHER,
        result: read.kind === 'timeout' ? 'stdin-timeout' : 'bad-payload'
      })
      return 0
    }
    const transcript = stringField(read.payload, 'transcript_path')
    if (!transcript) {
      appendLogLine(logPath, { mode: MODE_LAUNCHER, result: 'no-transcript' })
      return 0
    }
    const sessionId = stringField(read.payload, 'session_id')
    const reason = stringField(read.payload, 'reason')

    // 后缀不符或不是普通文件：派生 worker 只会白跑一趟并记 read-failed，就地拒绝更省事
    if (!isUsableTranscript(transcript)) {
      appendLogLine(logPath, {
        mode: MODE_LAUNCHER,
        result: 'bad-transcript',
        sid: sessionId ?? '',
        path: transcript
      })
      return 0
    }

    // 迁移进行中：让路。此时写入旧库根的会话不在迁移的文件快照内，会被删源一并清掉。
    if (isMigrationLocked()) {
      appendLogLine(logPath, { mode: MODE_LAUNCHER, result: 'skip-migrating', sid: sessionId ?? '' })
      return 0
    }

    // 轮转只在这里做一次：worker 拿到的是轮转后的 fd，不会写到一半被换文件。
    rotateIfLarge(logPath)

    const inline = args?.noDetach || Boolean(p.env[APPIMAGE_ENV])
    if (inline) {
      await runWorker({
        transcript,
        userData,
        ...(sessionId ? { sessionId } : {}),
        ...(reason ? { reason } : {})
      })
      return 0
    }

    const fd = openLogFd(logPath)
    let childPid = 0
    try {
      const plan = buildWorkerSpawn({
        execPath: p.execPath ?? process.execPath,
        scriptPath: p.scriptPath ?? __filename,
        transcript,
        userData,
        ...(sessionId ? { sessionId } : {}),
        ...(reason ? { reason } : {}),
        logFd: fd,
        env: p.env
      })
      const child = (p.spawn ?? nodeSpawn)(plan.cmd, plan.args, plan.opts)
      // 派生失败是异步事件：不监听则整个启动器以未捕获异常收场，钩子看到非零退出码
      child.on('error', (e: Error) =>
        appendLogLine(logPath, {
          mode: MODE_LAUNCHER,
          result: 'spawn-failed',
          sid: sessionId ?? '',
          error: errorLine(e)
        })
      )
      child.unref()
      childPid = child.pid ?? 0
    } finally {
      closeSync(fd)
    }
    // pid 缺失即未真正派生（后续必有 error 事件）：不能记成 spawned，否则日志显示导出已启动
    appendLogLine(logPath, {
      mode: MODE_LAUNCHER,
      result: childPid ? 'spawned' : 'spawn-failed',
      sid: sessionId ?? '',
      childPid
    })
    return 0
  } catch (e) {
    appendLogLine(logPath, { mode: MODE_LAUNCHER, result: 'launcher-error', error: errorLine(e) })
    return 0
  }
}

// ---- 命令分发 ----

/** `--export <jsonl|sessionId>`：定位转录 → 导出 → 结果 JSON 打到 stdout。 */
async function runExportInline(args: HeadlessArgs, p: LauncherParams): Promise<number> {
  const userData = resolveUserData(args, p)
  let transcript = args.value ?? null
  if (args.mode === 'session') {
    const sessions = await listSessions()
    transcript = sessions.find((s) => s.sessionId === args.value)?.path ?? null
  }
  if (!transcript) {
    await writeAndFlush(process.stderr, '未能确定要导出的转录路径\n')
    return 1
  }
  try {
    const outcome = await exportOnce({
      transcript,
      userData,
      sid: args.sessionId ?? basename(transcript).replace(/\.jsonl$/i, '')
    })
    await writeAndFlush(process.stdout, `${JSON.stringify(outcome)}\n`)
    return exitCodeFor(outcome)
  } catch (e) {
    await writeAndFlush(process.stderr, `导出异常：${errorLine(e)}\n`)
    return 1
  }
}

/** `--library-maintain`：存量库清理与批量重命名，报告 JSON 打到 stdout。 */
async function runMaintain(args: HeadlessArgs): Promise<number> {
  try {
    const report = await runLibraryMaintain(getLibraryRoot(), {
      ...(args.dryRun ? { dryRun: true } : {}),
      ...(args.confirm ? { confirm: true } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {})
    })
    await writeAndFlush(process.stdout, `${JSON.stringify(report, null, 2)}\n`)
    return 0
  } catch (e) {
    await writeAndFlush(process.stderr, `维护失败：${errorLine(e)}\n`)
    return 1
  }
}

/** 无头命令统一入口，返回进程退出码。 */
export async function runHeadlessCli(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  io: HeadlessIo = {}
): Promise<number> {
  const args = parseHeadlessArgs(argv)
  if (!args) {
    await writeAndFlush(process.stderr, '无效的无头参数\n')
    return 1
  }
  const p: LauncherParams = { ...io, argv, env }
  if (args.mode === 'stdin') return runLauncher(p)
  if (args.mode === 'maintain') return runMaintain(args)
  if (args.mode === 'worker') {
    if (!args.value) return 1
    return runWorker({
      transcript: args.value,
      userData: resolveUserData(args, p),
      ...(args.sessionId ? { sessionId: args.sessionId } : {}),
      ...(args.reason ? { reason: args.reason } : {})
    })
  }
  return runExportInline(args, p)
}
