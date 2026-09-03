/**
 * 无头 CLI 核心：参数解析、worker 派生参数、stdin 读取、启动器分支与后台 worker 落盘。
 *
 * 隔离约定：每个用例用 mkdtemp 造一个 userData，并把 CHATARK_USER_DATA 指过去
 * （isMigrationLocked / getLibraryRoot / titlegen 冷却都读进程环境），历史库根写在其内部；
 * claude 一律用 sh 桩替身，绝不触碰真实 userData、真实历史库与真实 claude CLI。
 */
import type { SpawnOptions } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  buildWorkerSpawn,
  parseHeadlessArgs,
  readStdinJson,
  runLauncher,
  runWorker,
  type LauncherParams,
  type SpawnFn,
  type WorkerSpawnParams
} from './cli'

// ---- 通用夹具 ----

const SID = '11111111-2222-3333-4444-555555555555'
const FIVE_FILES = ['对话.md', '对话.html', 'data.js', 'meta.json', 'transcript.jsonl']
/** 覆盖的环境变量：每个用例后原样还原，避免污染同文件内其它测试。 */
const ENV_KEYS = ['CHATARK_USER_DATA', 'CHATARK_CLAUDE_BIN', 'APPIMAGE'] as const

const tmpDirs: string[] = []
let savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true })
})

function makeUserData(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'chatark-headless-'))
  tmpDirs.push(d)
  return d
}

function readLog(userData: string): string {
  const p = path.join(userData, 'logs', 'auto-export.log')
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

interface SpawnCall {
  cmd: string
  args: readonly string[]
  opts: SpawnOptions
}

function stubSpawn(calls: SpawnCall[]): SpawnFn {
  return (cmd, args, opts) => {
    calls.push({ cmd, args, opts })
    return { pid: 4242, unref: () => undefined, on: () => undefined }
  }
}

/** 派生失败桩：pid 缺失，且随后异步 emit 'error'（等价于 ENOENT 的真实行为）。 */
function failingSpawn(err = new Error('spawn ENOENT')): SpawnFn {
  return () => {
    const emitter = new EventEmitter()
    setTimeout(() => emitter.emit('error', err), 0)
    return { pid: undefined, unref: () => undefined, on: (e: 'error', l: (x: Error) => void) => emitter.on(e, l) }
  }
}

/** 造一个真实存在的 .jsonl 转录（启动器会校验后缀与文件类型）。 */
function seedTranscript(userData: string, content = ''): string {
  const p = path.join(userData, 'hook-transcript.jsonl')
  writeFileSync(p, content, 'utf8')
  return p
}

function stdinOf(payload: unknown): PassThrough {
  const s = new PassThrough()
  s.end(typeof payload === 'string' ? payload : JSON.stringify(payload))
  return s
}

/** claude 桩：固定输出一个中文标题，保证 titleMode:'llm' 不会拉起真实 claude。 */
function installClaudeStub(userData: string, output = '无头导出验证'): void {
  const stub = path.join(userData, 'claude-stub.sh')
  writeFileSync(stub, `#!/bin/sh\necho ${output}\n`, { mode: 0o755 })
  process.env.CHATARK_CLAUDE_BIN = stub
}

// ---- parseHeadlessArgs ----

describe('parseHeadlessArgs', () => {
  it('普通 GUI 启动返回 null', () => {
    expect(parseHeadlessArgs(['/bin/electron', '/app'])).toBeNull()
  })

  it('--export-stdin 识别为启动器模式并带通用选项', () => {
    expect(parseHeadlessArgs(['node', 'h.js', '--export-stdin', '--user-data', '/tmp/ud', '--no-detach'])).toEqual({
      mode: 'stdin',
      userData: '/tmp/ud',
      noDetach: true
    })
  })

  it('--export-worker 解析转录路径、会话与 reason', () => {
    const argv = ['node', 'h.js', '--export-worker', '/t/a.jsonl', '--user-data', '/tmp/ud', '--session', 'abc', '--reason', 'clear']
    expect(parseHeadlessArgs(argv)).toEqual({
      mode: 'worker',
      value: '/t/a.jsonl',
      userData: '/tmp/ud',
      sessionId: 'abc',
      reason: 'clear'
    })
  })

  it('--export-worker 缺少转录路径返回 null', () => {
    expect(parseHeadlessArgs(['--export-worker'])).toBeNull()
    expect(parseHeadlessArgs(['--export-worker', '--user-data', '/tmp/ud'])).toBeNull()
  })

  it('--export 按 .jsonl 后缀区分转录路径与 sessionId', () => {
    expect(parseHeadlessArgs(['--export', '/t/a.jsonl'])).toEqual({ mode: 'path', value: '/t/a.jsonl' })
    expect(parseHeadlessArgs(['--export', 'abc-123'])).toEqual({ mode: 'session', value: 'abc-123' })
  })

  it('--export 缺参返回 null', () => {
    expect(parseHeadlessArgs(['--export'])).toBeNull()
  })

  it('--library-maintain 解析 dry-run / confirm / limit', () => {
    expect(parseHeadlessArgs(['--library-maintain', '--dry-run', '--confirm', '--limit', '5'])).toEqual({
      mode: 'maintain',
      dryRun: true,
      confirm: true,
      limit: 5
    })
  })

  it('--limit 非正整数或缺参一律忽略', () => {
    for (const bad of ['0', '-3', 'abc']) {
      expect(parseHeadlessArgs(['--library-maintain', '--limit', bad])).toEqual({ mode: 'maintain' })
    }
    expect(parseHeadlessArgs(['--library-maintain', '--limit'])).toEqual({ mode: 'maintain' })
  })

  it('--library-maintain 优先于导出参数', () => {
    expect(parseHeadlessArgs(['--library-maintain', '--export', '/t/a.jsonl'])?.mode).toBe('maintain')
  })
})

// ---- buildWorkerSpawn ----

describe('buildWorkerSpawn', () => {
  const base: WorkerSpawnParams = {
    execPath: '/Applications/ChatArk.app/Contents/MacOS/ChatArk',
    scriptPath: '/app/out/main/headless.js',
    transcript: '/t/a.jsonl',
    userData: '/tmp/ud',
    logFd: 7,
    env: { PATH: '/usr/bin' }
  }

  it('cmd 取 execPath，args 顺序固定且可选项按需追加', () => {
    const bare = buildWorkerSpawn(base)
    expect(bare.cmd).toBe(base.execPath)
    expect(bare.args).toEqual(['/app/out/main/headless.js', '--export-worker', '/t/a.jsonl', '--user-data', '/tmp/ud'])

    const full = buildWorkerSpawn({ ...base, sessionId: 'sid-1', reason: 'clear' })
    expect(full.args).toEqual([
      '/app/out/main/headless.js',
      '--export-worker',
      '/t/a.jsonl',
      '--user-data',
      '/tmp/ud',
      '--session',
      'sid-1',
      '--reason',
      'clear'
    ])
  })

  it('detach 且 stdio 不继承父进程管道，1/2 指向日志 fd', () => {
    const { opts } = buildWorkerSpawn(base)
    expect(opts.detached).toBe(true)
    expect(Array.isArray(opts.stdio) && opts.stdio[0]).toBe('ignore')
    expect(opts.stdio).toEqual(['ignore', 7, 7])
    expect(opts.windowsHide).toBe(true)
  })

  it('注入 ELECTRON_RUN_AS_NODE 且不修改入参 env', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' }
    const { opts } = buildWorkerSpawn({ ...base, env })
    expect(opts.env?.['ELECTRON_RUN_AS_NODE']).toBe('1')
    expect(opts.env?.['PATH']).toBe('/usr/bin')
    expect(env).toEqual({ PATH: '/usr/bin' })
  })
})

// ---- readStdinJson ----

describe('readStdinJson', () => {
  it('读到 end 后解析出 JSON 对象', async () => {
    await expect(readStdinJson(stdinOf({ session_id: 'abc', reason: 'other' }))).resolves.toEqual({
      kind: 'ok',
      payload: { session_id: 'abc', reason: 'other' }
    })
  })

  it('非 JSON 输入归为 bad-payload', async () => {
    await expect(readStdinJson(stdinOf('not json'))).resolves.toEqual({ kind: 'bad-payload' })
  })

  it('JSON 数组不是钩子负载，同样归为 bad-payload', async () => {
    await expect(readStdinJson(stdinOf('[1,2]'))).resolves.toEqual({ kind: 'bad-payload' })
  })

  it('一个字节都没收到的超时单独归为 timeout', async () => {
    await expect(readStdinJson(new PassThrough(), 20)).resolves.toEqual({ kind: 'timeout' })
  })
})

// ---- runLauncher ----

/** SessionEnd 钩子负载；transcript_path 指向真实存在的 .jsonl，否则被校验拦下。 */
function hookPayload(transcript: string): Record<string, unknown> {
  return {
    session_id: 'abc',
    transcript_path: transcript,
    cwd: '/tmp',
    hook_event_name: 'SessionEnd',
    reason: 'other'
  }
}

function launcherParams(userData: string, extra: Partial<LauncherParams> = {}): LauncherParams {
  return {
    argv: ['node', '/app/out/main/headless.js', '--export-stdin'],
    env: { CHATARK_USER_DATA: userData },
    execPath: '/Applications/ChatArk.app/Contents/MacOS/ChatArk',
    scriptPath: '/app/out/main/headless.js',
    stdin: stdinOf(hookPayload(seedTranscript(userData))),
    ...extra
  }
}

describe('runLauncher', () => {
  it('正常负载派生一次 worker，日志落在 <userData>/logs/auto-export.log', async () => {
    const ud = makeUserData()
    process.env.CHATARK_USER_DATA = ud
    const calls: SpawnCall[] = []
    const src = seedTranscript(ud)

    const code = await runLauncher(
      launcherParams(ud, { stdin: stdinOf(hookPayload(src)), spawn: stubSpawn(calls) })
    )

    expect(code).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0].cmd).toBe('/Applications/ChatArk.app/Contents/MacOS/ChatArk')
    expect(calls[0].args).toEqual([
      '/app/out/main/headless.js',
      '--export-worker',
      src,
      '--user-data',
      ud,
      '--session',
      'abc',
      '--reason',
      'other'
    ])
    expect(calls[0].opts.cwd).toBe(os.tmpdir()) // 不继承钩子进程的项目目录
    expect(existsSync(path.join(ud, 'logs', 'auto-export.log'))).toBe(true)
    const log = readLog(ud)
    expect(log).toContain('mode=launcher')
    expect(log).toContain('result=spawned')
    expect(log).toContain('childPid=4242')
  })

  it('spawn 返回空 pid 时记 spawn-failed，不谎报已派生', async () => {
    const ud = makeUserData()
    process.env.CHATARK_USER_DATA = ud

    const code = await runLauncher(
      launcherParams(ud, { spawn: () => ({ pid: undefined, unref: () => undefined, on: () => undefined }) })
    )

    expect(code).toBe(0)
    expect(readLog(ud)).toContain('result=spawn-failed')
    expect(readLog(ud)).not.toContain('result=spawned')
  })

  it('子进程异步 emit error 时记 spawn-failed 且进程不崩', async () => {
    const ud = makeUserData()
    process.env.CHATARK_USER_DATA = ud

    const code = await runLauncher(launcherParams(ud, { spawn: failingSpawn() }))
    await new Promise((r) => setTimeout(r, 20)) // 等 error 事件落到日志

    expect(code).toBe(0)
    const log = readLog(ud)
    expect(log).toContain('result=spawn-failed')
    expect(log).toContain('error="spawn ENOENT"')
  })

  it('transcript_path 后缀不是 .jsonl 时记 bad-transcript', async () => {
    const ud = makeUserData()
    process.env.CHATARK_USER_DATA = ud
    const txt = path.join(ud, 'transcript.txt')
    writeFileSync(txt, '', 'utf8')
    const calls: SpawnCall[] = []

    const code = await runLauncher(
      launcherParams(ud, { stdin: stdinOf(hookPayload(txt)), spawn: stubSpawn(calls) })
    )

    expect(code).toBe(0)
    expect(calls).toHaveLength(0)
    expect(readLog(ud)).toContain('result=bad-transcript')
  })

  it('transcript_path 指向不存在的文件时记 bad-transcript', async () => {
    const ud = makeUserData()
    process.env.CHATARK_USER_DATA = ud
    const calls: SpawnCall[] = []

    const code = await runLauncher(
      launcherParams(ud, {
        stdin: stdinOf(hookPayload(path.join(ud, '不存在.jsonl'))),
        spawn: stubSpawn(calls)
      })
    )

    expect(code).toBe(0)
    expect(calls).toHaveLength(0)
    expect(readLog(ud)).toContain('result=bad-transcript')
  })

  it('stdin 不是 JSON 对象时记 bad-payload', async () => {
    const ud = makeUserData()
    process.env.CHATARK_USER_DATA = ud
    const calls: SpawnCall[] = []

    const code = await runLauncher(launcherParams(ud, { stdin: stdinOf('not json'), spawn: stubSpawn(calls) }))

    expect(code).toBe(0)
    expect(calls).toHaveLength(0)
    expect(readLog(ud)).toContain('result=bad-payload')
  })

  it('完全没有 stdin 时记 stdin-timeout', async () => {
    const ud = makeUserData()
    process.env.CHATARK_USER_DATA = ud
    const calls: SpawnCall[] = []

    const code = await runLauncher(
      launcherParams(ud, { stdin: undefined, spawn: stubSpawn(calls) })
    )

    expect(code).toBe(0)
    expect(calls).toHaveLength(0)
    expect(readLog(ud)).toContain('result=stdin-timeout')
  })

  it('CHATARK_TITLEGEN 标记下不派生 worker，只记 skip-titlegen', async () => {
    const ud = makeUserData()
    process.env.CHATARK_USER_DATA = ud
    const calls: SpawnCall[] = []

    const code = await runLauncher(
      launcherParams(ud, { env: { CHATARK_USER_DATA: ud, CHATARK_TITLEGEN: '1' }, spawn: stubSpawn(calls) })
    )

    expect(code).toBe(0)
    expect(calls).toHaveLength(0)
    expect(readLog(ud)).toContain('result=skip-titlegen')
  })

  it('stdin 无 transcript_path 时记 no-transcript 且不派生', async () => {
    const ud = makeUserData()
    process.env.CHATARK_USER_DATA = ud
    const calls: SpawnCall[] = []

    const code = await runLauncher(
      launcherParams(ud, { stdin: stdinOf({ session_id: 'abc' }), spawn: stubSpawn(calls) })
    )

    expect(code).toBe(0)
    expect(calls).toHaveLength(0)
    expect(readLog(ud)).toContain('result=no-transcript')
  })

  it('迁移锁存在时让路，不派生 worker', async () => {
    const ud = makeUserData()
    process.env.CHATARK_USER_DATA = ud
    writeFileSync(path.join(ud, 'migration.lock'), JSON.stringify({ pid: process.pid, startedAt: Date.now() }), 'utf8')
    const calls: SpawnCall[] = []

    const code = await runLauncher(launcherParams(ud, { spawn: stubSpawn(calls) }))

    expect(code).toBe(0)
    expect(calls).toHaveLength(0)
    expect(readLog(ud)).toContain('result=skip-migrating')
  })

  it('--no-detach 时进程内跑 worker，不派生子进程', async () => {
    const ud = makeUserData()
    process.env.CHATARK_USER_DATA = ud
    writeFileSync(path.join(ud, 'config.json'), JSON.stringify({ historyRoot: path.join(ud, 'lib') }), 'utf8')
    installClaudeStub(ud)
    const calls: SpawnCall[] = []

    const code = await runLauncher(
      launcherParams(ud, {
        argv: ['node', '/app/out/main/headless.js', '--export-stdin', '--no-detach'],
        spawn: stubSpawn(calls)
      })
    )

    expect(code).toBe(0)
    expect(calls).toHaveLength(0)
    // 空转录未达导出门槛 → worker 记 gate，证明确实进了进程内的 worker 分支
    expect(readLog(ud)).toContain('mode=worker')
    expect(readLog(ud)).toContain('result=gate')
  })

  it('APPIMAGE 环境下同样 inline 运行，不 detach', async () => {
    const ud = makeUserData()
    process.env.CHATARK_USER_DATA = ud
    writeFileSync(path.join(ud, 'config.json'), JSON.stringify({ historyRoot: path.join(ud, 'lib') }), 'utf8')
    installClaudeStub(ud)
    const calls: SpawnCall[] = []

    const code = await runLauncher(
      launcherParams(ud, {
        env: { CHATARK_USER_DATA: ud, APPIMAGE: '/tmp/ChatArk.AppImage' },
        spawn: stubSpawn(calls)
      })
    )

    expect(code).toBe(0)
    expect(calls).toHaveLength(0)
    expect(readLog(ud)).toContain('mode=worker')
  })
})

// ---- runWorker ----

function makeLine(type: 'user' | 'assistant', model: string | null, text: string): string {
  const base: Record<string, unknown> = {
    type,
    sessionId: SID,
    cwd: '/Users/me/项目A',
    gitBranch: null,
    isSidechain: false,
    isMeta: false,
    timestamp: '2026-08-01T00:00:00.000Z',
    version: '2.1.219'
  }
  base['message'] =
    type === 'assistant'
      ? { type: 'message', role: 'assistant', model, content: [{ type: 'text', text }] }
      : { role: 'user', content: [{ type: 'text', text }] }
  return JSON.stringify(base)
}

/** 3 条记录满足 gate（1 助手回合、3 实质消息），模型非 haiku 故不被跳过。 */
function makeTranscript(): string {
  return [
    makeLine('user', null, '帮我整理这份文件'),
    makeLine('assistant', 'claude-opus-5', '好的，已整理完成'),
    makeLine('user', null, '继续')
  ].join('\n')
}

interface WorkerFixture {
  ud: string
  lib: string
  src: string
}

function setupWorker(): WorkerFixture {
  const ud = makeUserData()
  const lib = path.join(ud, 'lib')
  writeFileSync(path.join(ud, 'config.json'), JSON.stringify({ historyRoot: lib }), 'utf8')
  process.env.CHATARK_USER_DATA = ud
  installClaudeStub(ud)
  const src = path.join(ud, `${SID}.jsonl`)
  writeFileSync(src, makeTranscript(), 'utf8')
  return { ud, lib, src }
}

/** 库根下 `<分类>/<对话>/` 的第一个会话目录。 */
function requireExportDir(root: string): string {
  for (const cat of readdirSync(root, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue
    for (const conv of readdirSync(path.join(root, cat.name), { withFileTypes: true })) {
      if (conv.isDirectory()) return path.join(root, cat.name, conv.name)
    }
  }
  throw new Error(`未在 ${root} 下找到导出目录`)
}

describe('runWorker', () => {
  it('首次运行写出五件套、记 result=ok 并释放全部锁', async () => {
    const { ud, lib, src } = setupWorker()

    const code = await runWorker({ transcript: src, userData: ud, sessionId: SID, reason: 'other' })

    expect(code).toBe(0)
    const dir = requireExportDir(lib)
    for (const f of FIVE_FILES) expect(existsSync(path.join(dir, f))).toBe(true)

    const log = readLog(ud)
    expect(log).toContain('mode=worker')
    expect(log).toContain(`sid=${SID}`)
    expect(log).toContain('result=written')
    expect(log).toContain('result=titled')
    expect(log).toContain('result=ok')
    expect(log).toContain('titled=1')

    expect(existsSync(path.join(ud, 'locks', `session-${SID}.lock`))).toBe(false)
    expect(existsSync(path.join(ud, 'locks', 'titlegen.lock'))).toBe(false)
  })

  it('未显式给 sessionId 时按转录文件名推断', async () => {
    const { ud, src } = setupWorker()

    const code = await runWorker({ transcript: src, userData: ud })

    expect(code).toBe(0)
    expect(readLog(ud)).toContain(`sid=${SID}`)
  })

  it('源转录未变化时二次运行记 result=unchanged', async () => {
    const { ud, src } = setupWorker()
    await runWorker({ transcript: src, userData: ud, sessionId: SID })

    const code = await runWorker({ transcript: src, userData: ud, sessionId: SID })

    expect(code).toBe(0)
    expect(readLog(ud)).toContain('result=unchanged')
  })

  it('会话锁被他进程持有时跳过，不落盘也不误删对方的锁', async () => {
    const { ud, lib, src } = setupWorker()
    const lock = path.join(ud, 'locks', `session-${SID}.lock`)
    mkdirSync(path.dirname(lock), { recursive: true })
    writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), 'utf8')

    const code = await runWorker({ transcript: src, userData: ud, sessionId: SID })

    expect(code).toBe(0)
    expect(readLog(ud)).toContain('result=skip-duplicate')
    expect(existsSync(lib)).toBe(false)
    expect(existsSync(lock)).toBe(true)
  })

  it('转录不可读时返回 1 并记 read-failed', async () => {
    const { ud } = setupWorker()

    const code = await runWorker({ transcript: path.join(ud, '不存在.jsonl'), userData: ud, sessionId: SID })

    expect(code).toBe(1)
    const log = readLog(ud)
    expect(log).toContain('result=read-failed')
    expect(log).toContain('result=failed')
  })
})
