/**
 * exportSession 的「先落盘、后起名」契约：LLM 起名前五件套必须已经在盘上，
 * 起名失败或抢不到锁一律保留本地标题，不影响已落盘内容。
 *
 * claude 用 sh 桩替代（CHATARK_CLAUDE_BIN 注入），桩在被调用的瞬间快照库内已有的
 * meta.json，据此证明落盘先于起名。全部写入临时目录，不触碰真实库与真实 claude。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { exportSession, type LogFields } from './export-session'

const SID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee1234'
/** 转录首条提问经 titler → fallbackTitle 后的本地标题（≤12 码点，原样保留） */
const LOCAL_TITLE = '帮我整理这份文件'
const LLM_TITLE = '文件整理助手'

let tmp = ''
let historyRoot = ''
let stubOut = ''
let prevBin: string | undefined
let prevUserData: string | undefined

function makeLine(type: 'user' | 'assistant', text: string): string {
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
      ? { type: 'message', role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text }] }
      : { role: 'user', content: [{ type: 'text', text }] }
  return JSON.stringify(base)
}

function writeTranscript(extra: string[] = []): string {
  const p = path.join(tmp, `src-${extra.length}.jsonl`)
  writeFileSync(
    p,
    [makeLine('user', LOCAL_TITLE), makeLine('assistant', '好的，已整理完成'), makeLine('user', '继续'), ...extra].join(
      '\n'
    ),
    'utf8'
  )
  return p
}

/** 桩 claude：记录参数与环境、快照当前库内 meta.json，再输出 stdout。 */
function makeStub(stdout: string): string {
  const bin = path.join(tmp, 'claude-stub.sh')
  writeFileSync(
    bin,
    [
      '#!/bin/sh',
      `printf '%s\\n' "$@" > "${stubOut}/args.txt"`,
      `printenv > "${stubOut}/env.txt"`,
      `find "${historyRoot}" -name meta.json > "${stubOut}/seen.txt" 2>/dev/null`,
      `printf '%s' '${stdout}'`,
      ''
    ].join('\n'),
    { mode: 0o755 }
  )
  return bin
}

function metaOf(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'))
}

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'chatark-export-session-'))
  historyRoot = path.join(tmp, 'history')
  stubOut = path.join(tmp, 'stub')
  mkdirSync(stubOut, { recursive: true })
  prevBin = process.env.CHATARK_CLAUDE_BIN
  prevUserData = process.env.CHATARK_USER_DATA
  // 冷却文件与 mcp-empty.json 一律落在临时目录，绝不写真实 userData
  process.env.CHATARK_USER_DATA = path.join(tmp, 'userdata')
})

afterEach(() => {
  if (prevBin === undefined) delete process.env.CHATARK_CLAUDE_BIN
  else process.env.CHATARK_CLAUDE_BIN = prevBin
  if (prevUserData === undefined) delete process.env.CHATARK_USER_DATA
  else process.env.CHATARK_USER_DATA = prevUserData
  rmSync(tmp, { recursive: true, force: true })
})

describe('titleMode=llm 的先落盘后改名', () => {
  it('起名前五件套已落盘，成功后目录与 meta 一并改为 LLM 标题', async () => {
    process.env.CHATARK_CLAUDE_BIN = makeStub(LLM_TITLE)
    const logs: LogFields[] = []

    const r = await exportSession({
      sourceJsonl: writeTranscript(),
      historyRoot,
      titleMode: 'llm',
      onLog: (f) => logs.push(f)
    })

    expect(r.ok).toBe(true)
    expect(r.titled).toBe(true)
    expect(r.titleSource).toBe('llm')

    // 桩被调用时库里已有 meta.json，且当时的目录名用的是本地标题
    const seen = readFileSync(path.join(stubOut, 'seen.txt'), 'utf8').trim().split('\n')
    expect(seen.length).toBe(1)
    expect(path.basename(path.dirname(seen[0]))).toContain(LOCAL_TITLE)

    // 改名后：目录名与 meta 均为 LLM 标题，五件套仍在
    const dir = r.dir as string
    expect(path.basename(dir)).toContain(LLM_TITLE)
    expect(metaOf(dir).title).toBe(LLM_TITLE)
    expect(metaOf(dir).titleSource).toBe('llm')
    for (const f of ['对话.md', '对话.html', 'data.js', 'meta.json', 'transcript.jsonl']) {
      expect(existsSync(path.join(dir, f)), `缺少 ${f}`).toBe(true)
    }
    expect(existsSync(seen[0])).toBe(false) // 旧目录已被整体改名
    expect(logs.map((l) => l.result)).toEqual(['written', 'titled'])
  })

  it('传给 claude 的参数含 haiku / 禁用工具 / 严格 MCP / 不落会话，环境不含宿主标记', async () => {
    process.env.CHATARK_CLAUDE_BIN = makeStub(LLM_TITLE)

    await exportSession({ sourceJsonl: writeTranscript(), historyRoot, titleMode: 'llm' })

    const args = readFileSync(path.join(stubOut, 'args.txt'), 'utf8').split('\n')
    expect(args).toContain('--model')
    expect(args).toContain('haiku')
    expect(args).toContain('--strict-mcp-config')
    expect(args).toContain('--no-session-persistence')
    expect(args).toContain('{"mcpServers":{}}')
    const env = readFileSync(path.join(stubOut, 'env.txt'), 'utf8')
    expect(env).toMatch(/^CHATARK_TITLEGEN=1$/m)
    expect(env).not.toMatch(/^CLAUDECODE=/m)
  })

  it('LLM 返回空则保留本地标题与 titleSource=local', async () => {
    process.env.CHATARK_CLAUDE_BIN = makeStub('')
    const logs: LogFields[] = []

    const r = await exportSession({
      sourceJsonl: writeTranscript(),
      historyRoot,
      titleMode: 'llm',
      onLog: (f) => logs.push(f)
    })

    expect(r.ok).toBe(true)
    expect(r.titled).toBe(false)
    expect(r.titleSource).toBe('local')
    expect(path.basename(r.dir as string)).toContain(LOCAL_TITLE)
    expect(metaOf(r.dir as string).titleSource).toBe('local')
    expect(logs.map((l) => l.result)).toEqual(['written', 'title-failed'])
  })

  it('抢不到 titlegen 锁则完全不调用 claude，且不释放他人持有的锁', async () => {
    process.env.CHATARK_CLAUDE_BIN = makeStub(LLM_TITLE)
    const logs: LogFields[] = []
    let released = false

    const r = await exportSession({
      sourceJsonl: writeTranscript(),
      historyRoot,
      titleMode: 'llm',
      onLog: (f) => logs.push(f),
      acquireTitleLock: () => Promise.resolve(false),
      releaseTitleLock: () => {
        released = true
      }
    })

    expect(existsSync(path.join(stubOut, 'args.txt'))).toBe(false)
    expect(r.titleSource).toBe('local')
    expect(path.basename(r.dir as string)).toContain(LOCAL_TITLE)
    // 锁在别的进程手里：这里调用 release 会把对方的锁文件删掉
    expect(released).toBe(false)
    expect(logs.map((l) => l.result)).toEqual(['written', 'title-locked'])
  })

  it('拿到锁时正常起名并在结束后释放', async () => {
    process.env.CHATARK_CLAUDE_BIN = makeStub(LLM_TITLE)
    let acquired = 0
    let released = 0

    const r = await exportSession({
      sourceJsonl: writeTranscript(),
      historyRoot,
      titleMode: 'llm',
      acquireTitleLock: () => {
        acquired += 1
        return Promise.resolve(true)
      },
      releaseTitleLock: () => {
        released += 1
      }
    })

    expect(acquired).toBe(1)
    expect(released).toBe(1)
    expect(r.titled).toBe(true)
  })
})

describe('转录未变化时的补起名', () => {
  it('既有标题仍是本地规则时只补起名，不重写五件套', async () => {
    process.env.CHATARK_CLAUDE_BIN = makeStub('') // 首次：claude 无输出 → 停在本地标题
    const src = writeTranscript()
    const first = await exportSession({ sourceJsonl: src, historyRoot, titleMode: 'llm' })
    expect(first.titleSource).toBe('local')
    const mdBefore = statSync(path.join(first.dir as string, '对话.md')).mtimeMs

    process.env.CHATARK_CLAUDE_BIN = makeStub(LLM_TITLE) // 二次：claude 恢复可用
    const logs: LogFields[] = []
    const second = await exportSession({
      sourceJsonl: src,
      historyRoot,
      titleMode: 'llm',
      onLog: (f) => logs.push(f)
    })

    expect(second.unchanged).toBe(true)
    expect(second.titled).toBe(true)
    expect(second.titleSource).toBe('llm')
    expect(path.basename(second.dir as string)).toContain(LLM_TITLE)
    expect(metaOf(second.dir as string).title).toBe(LLM_TITLE)
    // 五件套一个字节都没重写：目录整体改名，对话.md 的 mtime 原样保留
    expect(statSync(path.join(second.dir as string, '对话.md')).mtimeMs).toBe(mdBefore)
    expect(logs.map((l) => l.result)).toEqual(['unchanged', 'titled'])
  })

  it('既有标题已是 LLM 结果时不再起名，直接早退', async () => {
    process.env.CHATARK_CLAUDE_BIN = makeStub(LLM_TITLE)
    const src = writeTranscript()
    const first = await exportSession({ sourceJsonl: src, historyRoot, titleMode: 'llm' })
    expect(first.titleSource).toBe('llm')
    rmSync(path.join(stubOut, 'args.txt'), { force: true })

    const logs: LogFields[] = []
    const second = await exportSession({
      sourceJsonl: src,
      historyRoot,
      titleMode: 'llm',
      onLog: (f) => logs.push(f)
    })

    expect(second.unchanged).toBe(true)
    expect(second.titled).toBeUndefined()
    expect(existsSync(path.join(stubOut, 'args.txt'))).toBe(false) // claude 没被再拉起
    expect(logs.map((l) => l.result)).toEqual(['unchanged'])
  })
})

describe('titleMode 缺省', () => {
  it('不调用 claude，直接以本地标题落盘', async () => {
    process.env.CHATARK_CLAUDE_BIN = makeStub(LLM_TITLE)

    const r = await exportSession({ sourceJsonl: writeTranscript(), historyRoot })

    expect(existsSync(path.join(stubOut, 'args.txt'))).toBe(false)
    expect(r.titleSource).toBe('local')
    expect(metaOf(r.dir as string).title).toBe(LOCAL_TITLE)
  })
})
