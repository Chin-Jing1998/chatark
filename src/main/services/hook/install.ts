import { app } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fail, ok, type HookStatus, type OpResult } from '@shared/types'
import { autoExportLogPath } from '../app-paths'

export type { HookStatus }

const SETTINGS = join(homedir(), '.claude', 'settings.json')
const CODEX_CONFIG = join(homedir(), '.codex', 'config.toml')
const OUR_MARKER = '--export-stdin' // 本应用钩子命令的标识子串
const CODEX_EXPORT_MARKER = 'codex-project-export' // Codex 退出归档钩子标识
const PY_MARKER = 'chat_export' // 旧 Python 版钩子的标识子串

interface HookEntry {
  matcher?: string
  hooks?: Array<{ type: string; command?: string; timeout?: number; async?: boolean }>
}
interface Settings {
  hooks?: Record<string, HookEntry[]>
  [k: string]: unknown
}

/**
 * 钩子超时（秒）。启动器只做「读 stdin → 派生后台 worker → 退出」，耗时约 0.1 s，
 * 故用同步钩子 + 短超时：Claude Code 会等待管道关闭并记录退出码，行为可预期；
 * 真正耗时的导出与起名在已脱离父进程的 worker 中完成，不受此上限约束。
 */
const HOOK_TIMEOUT_S = 10

/** 无头入口在应用包内的相对位置（electron-vite 多入口产物）。 */
const HEADLESS_REL = ['out', 'main', 'headless.js'] as const

/**
 * titlegen 派生的 `claude -p` 会话结束时也会触发本钩子。
 * 该守卫让 sh 在 CHATARK_TITLEGEN 置位时直接短路，连启动器进程都不拉起，
 * 从根上断开「导出 → 起名 → 再导出」的自激循环。
 */
const TITLEGEN_GUARD = '[ -n "$CHATARK_TITLEGEN" ] ||'

/** 构造钩子命令所需的全部外部输入（显式传入，便于跨平台测试）。 */
export interface HookCommandInput {
  platform: string
  /** 应用可执行文件路径（Electron 二进制） */
  execPath: string
  /** 应用根目录，打包后为 `…/Resources/app.asar` */
  appPath: string
  /** 应用数据目录，写进命令以保证 GUI 与无头进程落在同一处 */
  userData: string
  /** Linux AppImage 的自身路径（process.env.APPIMAGE） */
  appImage?: string
}

/** 无头入口脚本的绝对路径。 */
export function headlessScriptPath(appPath: string): string {
  return join(appPath, ...HEADLESS_REL)
}

/** sh 双引号内仍会解释的字符：反斜杠、双引号、反引号、美元符。 */
const SH_ESCAPE_RE = /(["\\`$])/g

/**
 * 路径一律加双引号：`Application Support` 等含空格路径不加引号会被 shell 拆成两个参数。
 * 非 win32 命令由 sh 执行，双引号内的 `$`、反引号、`\` 仍会被解释（`~/Library/$USER 备份`
 * 一类路径会被替换成别的目录），故逐个前置反斜杠；cmd.exe 无此转义规则，仅加引号。
 */
function quoted(path: string, platform: string): string {
  if (platform === 'win32') return `"${path}"`
  return `"${path.replace(SH_ESCAPE_RE, '\\$1')}"`
}

/**
 * 按平台生成钩子命令（纯函数）。
 * - darwin：`ELECTRON_RUN_AS_NODE=1` 让 Electron 二进制以纯 Node 运行无头入口，
 *   不启动 Chromium、不出现程序坞图标。
 * - linux：AppImage 的 execPath 位于随进程退出即卸载的临时挂载点，必须写 AppImage 自身路径。
 * - win32：命令由 Git Bash 或 PowerShell 执行，两者语法不一致，故不含任何 shell 语法与内联环境变量。
 */
export function buildHookCommand(input: HookCommandInput): string {
  const q = (s: string): string => quoted(s, input.platform)
  const tail = `${OUR_MARKER} --user-data ${q(input.userData)}`
  if (input.platform === 'win32') return `${q(input.execPath)} ${tail}`
  if (input.platform === 'darwin') {
    const runner = `ELECTRON_RUN_AS_NODE=1 ${q(input.execPath)}`
    return `${TITLEGEN_GUARD} ${runner} ${q(headlessScriptPath(input.appPath))} ${tail}`
  }
  return `${TITLEGEN_GUARD} ${q(input.appImage || input.execPath)} ${tail}`
}

/** 应用数据目录（钩子命令与日志路径共用同一取值口径）。 */
function userDataDir(): string {
  return app.getPath('userData')
}

/** 当前环境下应写入 settings.json 的钩子命令。 */
export function appCommand(
  platform: string = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string {
  return buildHookCommand({
    platform,
    execPath: process.execPath,
    appPath: app.getAppPath(),
    userData: userDataDir(),
    appImage: env['APPIMAGE']
  })
}

/** 当前版本期望的钩子条目形态（同步执行，故不含 async）。 */
function expectedHook(): { type: 'command'; command: string; timeout: number } {
  return { type: 'command', command: appCommand(), timeout: HOOK_TIMEOUT_S }
}

function entryHasMarker(entry: HookEntry, marker: string): boolean {
  return (entry.hooks ?? []).some((h) => (h.command ?? '').includes(marker))
}

/**
 * 读取结果必须区分「文件不存在」与「解析失败」：
 * 二者混为 null 再 `?? {}` 兜底，会在 settings.json 有语法错误时以空对象覆盖，
 * 把用户全部 Claude Code 配置（permissions / env / statusLine / 其他 hooks）清空。
 */
type ReadResult =
  | { kind: 'ok'; settings: Settings }
  | { kind: 'absent' }
  | { kind: 'corrupt'; error: string }

async function readSettings(): Promise<ReadResult> {
  let raw: string
  try {
    raw = await fs.readFile(SETTINGS, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' }
    return { kind: 'corrupt', error: e instanceof Error ? e.message : String(e) }
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { kind: 'corrupt', error: '顶层不是 JSON 对象' }
    }
    return { kind: 'ok', settings: parsed as Settings }
  } catch (e) {
    return { kind: 'corrupt', error: e instanceof Error ? e.message : String(e) }
  }
}

/** 解析失败时给用户的统一说明——绝不代为覆盖，交由用户自行修复。 */
function corruptFail(error: string): OpResult<never> {
  return fail(
    'PARSE_ERROR',
    `~/.claude/settings.json 解析失败（${error}）。为避免覆盖你的 Claude Code 配置，本次未做任何写入。请先修复该文件再重试。`,
    true
  )
}

/** settings.json 不存在时新建所用的权限：只有属主可读写（内含 API key 等敏感配置）。 */
const DEFAULT_SETTINGS_MODE = 0o600

let tmpCounter = 0

/**
 * 原子写 settings.json：写同目录 .tmp 再 rename。
 * 两处细节不能省：
 *   ① 沿用原文件权限——用户若已把 settings.json 收紧为 0600，rename 换上的新文件
 *      不能退回默认的 0644，等于替他放宽了权限；
 *   ② rename 目标取 realpath——settings.json 若是指向别处的符号链接，直接 rename
 *      会用普通文件顶掉链接本身，用户的配置托管方案随之失效。
 */
async function atomicWrite(data: Settings): Promise<void> {
  // ~/.claude 可能尚不存在（全新环境）：不先建目录则 .tmp 写入直接 ENOENT
  await fs.mkdir(dirname(SETTINGS), { recursive: true })
  const target = await fs.realpath(SETTINGS).catch(() => SETTINGS)
  const mode = await fs
    .stat(SETTINGS)
    .then((st) => st.mode & 0o777)
    .catch(() => DEFAULT_SETTINGS_MODE)
  const tmp = `${target}.${process.pid}.${Date.now()}.${tmpCounter++}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode })
  // writeFile 的 mode 受 umask 削减，显式 chmod 才能精确复原原权限
  await fs.chmod(tmp, mode)
  await fs.rename(tmp, target)
}

// 模块级串行队列：把 install/uninstall 的整个 read-modify-write 串行化，
// 避免并发 IPC 交错导致写入错误内容或 .tmp 竞争。
let opQueue: Promise<unknown> = Promise.resolve()
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = opQueue.then(fn, fn)
  opQueue = run.catch(() => undefined)
  return run
}

/** 本应用备份文件名前缀（清理时据此识别，不碰其他工具的备份）。 */
const BAK_PREFIX = `${basename(SETTINGS)}.bak-`
/** 保留的备份数量上限：每次开关自动导出都会备份，不封顶会在 ~/.claude 里无限堆积。 */
const MAX_BACKUPS = 5

async function backup(): Promise<void> {
  try {
    await fs.copyFile(SETTINGS, `${SETTINGS}.bak-${Date.now()}`)
  } catch {
    /* 首次无文件时忽略 */
  }
  await pruneBackups()
}

/** 只保留最近 MAX_BACKUPS 个备份，其余删除。 */
async function pruneBackups(): Promise<void> {
  try {
    const dir = dirname(SETTINGS)
    const names = (await fs.readdir(dir)).filter((n) => n.startsWith(BAK_PREFIX))
    if (names.length <= MAX_BACKUPS) return
    // 名字尾部是毫秒时间戳，字典序即时间序（位数一致）；降序后删除超出上限的旧备份
    const stale = names.sort((a, b) => b.localeCompare(a)).slice(MAX_BACKUPS)
    for (const n of stale) await fs.rm(join(dir, n), { force: true }).catch(() => undefined)
  } catch {
    /* 清理失败不影响主流程 */
  }
}

/**
 * 清理本应用遗留的原子写临时文件（进程在 rename 前崩溃会留下）。
 * 仅匹配自身命名模式且超过 1 小时的，避免误删正在进行的写入。
 */
export async function pruneStaleTmp(): Promise<void> {
  try {
    const dir = dirname(SETTINGS)
    const prefix = `${basename(SETTINGS)}.`
    const cutoff = Date.now() - 60 * 60 * 1000
    for (const n of await fs.readdir(dir)) {
      if (!n.startsWith(prefix) || !n.endsWith('.tmp')) continue
      const p = join(dir, n)
      const st = await fs.stat(p).catch(() => null)
      if (st && st.mtimeMs < cutoff) await fs.rm(p, { force: true }).catch(() => undefined)
    }
  } catch {
    /* 清理失败不影响启动 */
  }
}

/**
 * 判断一个我方 hook 是否为旧版形态（纯函数，期望值由调用方算一次传入）。
 * 只比对带 OUR_MARKER 的 hook 自身：同一条目内若混有用户自加的命令，不应因它误报。
 */
function isOutdated(
  hook: { command?: string; timeout?: number; async?: boolean },
  expected: { command: string; timeout: number }
): boolean {
  return (
    hook.command !== expected.command || hook.timeout !== expected.timeout || hook.async === true
  )
}

async function isCodexHookInstalled(): Promise<boolean> {
  try {
    const raw = await fs.readFile(CODEX_CONFIG, 'utf8')
    return (
      raw.includes('[[hooks.SessionEnd]]') &&
      (raw.includes(OUR_MARKER) || raw.includes(CODEX_EXPORT_MARKER))
    )
  } catch {
    return false
  }
}

export async function hookStatus(): Promise<HookStatus> {
  const res = await readSettings()
  const s = res.kind === 'ok' ? res.settings : null
  const arr = s?.hooks?.SessionEnd ?? []
  const ourHooks = arr
    .filter((e) => entryHasMarker(e, OUR_MARKER))
    .flatMap((e) => e.hooks ?? [])
    .filter((h) => (h.command ?? '').includes(OUR_MARKER))
  const logPath = autoExportLogPath(userDataDir())
  const expected = expectedHook()
  const codexInstalled = await isCodexHookInstalled()
  return {
    installed: ourHooks.length > 0,
    pythonHookPresent: Object.values(s?.hooks ?? {})
      .flat()
      .some((e) => entryHasMarker(e, PY_MARKER)),
    // 开发模式的 execPath 与 appPath 都不稳定，期望命令无意义，故恒为 false，避免误报
    needsUpdate:
      ourHooks.length > 0 && app.isPackaged && ourHooks.some((h) => isOutdated(h, expected)),
    logPath,
    logExists: existsSync(logPath),
    codexInstalled
  }
}

/** 安装 SessionEnd 自动导出钩子（幂等）；replacePython=true 时同时移除旧 Python 钩子。 */
export function installHook(replacePython = false): Promise<OpResult<HookStatus>> {
  return serialize(async () => {
    if (!app.isPackaged) {
      return fail(
        'INVALID_INPUT',
        '自动导出钩子需在已打包的应用中安装（开发模式的可执行路径不稳定）',
        true
      )
    }
    // macOS 命令直接指向包内脚本：文件缺失时 sh 会以 127 退出、每场会话静默失败，
    // 故安装前先校验存在性，宁可拒绝安装也不写入一条注定跑不通的钩子。
    if (process.platform === 'darwin') {
      const script = headlessScriptPath(app.getAppPath())
      try {
        await fs.access(script)
      } catch {
        return fail(
          'NOT_FOUND',
          '应用内缺少无头入口 out/main/headless.js，请重新安装最新版本后再启用',
          true
        )
      }
    }
    const res = await readSettings()
    if (res.kind === 'corrupt') return corruptFail(res.error)
    const settings: Settings = res.kind === 'ok' ? res.settings : {}
    await backup()

    const hooks = (settings.hooks ??= {})
    let sessionEnd = (hooks.SessionEnd ??= [])
    // 去除本应用旧条目；可选去除 Python 条目
    sessionEnd = sessionEnd.filter((e) => !entryHasMarker(e, OUR_MARKER))
    if (replacePython) {
      for (const ev of Object.keys(hooks)) {
        hooks[ev] = hooks[ev].filter((e) => !entryHasMarker(e, PY_MARKER))
      }
      sessionEnd = (hooks.SessionEnd ?? []).filter((e) => !entryHasMarker(e, OUR_MARKER))
    }
    sessionEnd.push({ matcher: '', hooks: [expectedHook()] })
    hooks.SessionEnd = sessionEnd

    try {
      await atomicWrite(settings)
    } catch (e) {
      return fail('IO_ERROR', `写入 settings.json 失败：${e instanceof Error ? e.message : e}`)
    }
    return ok(await hookStatus())
  })
}

/** 卸载本应用的 SessionEnd 自动导出钩子。 */
export function uninstallHook(): Promise<OpResult<HookStatus>> {
  return serialize(async () => {
    const res = await readSettings()
    if (res.kind === 'corrupt') return corruptFail(res.error)
    if (res.kind === 'absent') return fail('NOT_FOUND', '未找到 settings.json')
    const settings = res.settings
    await backup()
    for (const ev of Object.keys(settings.hooks ?? {})) {
      settings.hooks![ev] = settings.hooks![ev].filter((e) => !entryHasMarker(e, OUR_MARKER))
    }
    try {
      await atomicWrite(settings)
    } catch (e) {
      return fail('IO_ERROR', `写入 settings.json 失败：${e instanceof Error ? e.message : e}`)
    }
    return ok(await hookStatus())
  })
}
