/**
 * haiku 主导会话跳过导出：gate 通过（≥1 助手回合且 ≥2 实质消息）但主导模型为
 * haiku 时，exportSession 返回 { ok:false, skipped:true } 且不落盘；同构非 haiku
 * 会话正常导出。另覆盖标题来源契约（local / user 沿用 / 污染替换）与 unchanged 跳过。
 * 全部写入临时目录，不触碰真实历史库。
 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { exportSession, shouldExport, parseJsonl } from './index'

const SID = '11111111-2222-3333-4444-555555555555'

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
  if (type === 'assistant') {
    base['message'] = {
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text }]
    }
  } else {
    base['message'] = { role: 'user', content: [{ type: 'text', text }] }
  }
  return JSON.stringify(base)
}

/** 3 条记录：user + assistant + user，满足 gate（1 助手回合、3 实质消息）。 */
function makeTranscript(model: string | null): string {
  return [
    makeLine('user', null, '帮我整理这份文件'),
    makeLine('assistant', model, '好的，已整理完成'),
    makeLine('user', null, '继续')
  ].join('\n')
}

function tempRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'chatark-haiku-skip-'))
}

let counter = 0
function writeTemp(content: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'chatark-haiku-src-'))
  const p = path.join(dir, `t${counter++}.jsonl`)
  writeFileSync(p, content, 'utf8')
  return p
}

function exists(p: string): boolean {
  try {
    statSync(p)
    return true
  } catch {
    return false
  }
}

describe('haiku 主导会话跳过导出', () => {
  it('gate 对 haiku 与非 haiku 转录均通过（跳过由模型判定触发）', async () => {
    const haiku = await parseJsonl(writeTemp(makeTranscript('claude-haiku-4-5-20251001')))
    const opus = await parseJsonl(writeTemp(makeTranscript('claude-opus-5')))
    expect(shouldExport(haiku)).toBe(true)
    expect(shouldExport(opus)).toBe(true)
  })

  it('haiku 主导会话返回 { ok:false, skipped:true } 且不产生任何导出目录', async () => {
    const tmp = tempRoot()
    const src = writeTemp(makeTranscript('claude-haiku-4-5-20251001'))
    const historyRoot = path.join(tmp, 'history')
    const r = await exportSession({ sourceJsonl: src, historyRoot })
    expect(r.ok).toBe(false)
    expect(r.skipped).toBe(true)
    expect(r.reason).toContain('haiku')
    expect(exists(historyRoot)).toBe(false)
    rmSync(tmp, { recursive: true, force: true })
  })

  it('同构非 haiku 会话正常导出并落盘', async () => {
    const tmp = tempRoot()
    const src = writeTemp(makeTranscript('claude-opus-5'))
    const historyRoot = path.join(tmp, 'history')
    const r = await exportSession({ sourceJsonl: src, historyRoot })
    expect(r.ok).toBe(true)
    expect(r.dir && exists(path.join(r.dir, 'meta.json'))).toBe(true)
    const meta = JSON.parse(readFileSync(path.join(r.dir as string, 'meta.json'), 'utf8'))
    expect(meta.model).toBe('claude-opus-5')
    rmSync(tmp, { recursive: true, force: true })
  })

  /**
   * titlegen 自激循环第二道防线：LLM 起标题派生的 claude 会话本身是 1 问 1 答，
   * 越过 gate 后若被导出，又会再派生一个 claude —— 无限链式。
   */
  it('首条用户消息为标题生成 prompt 的会话跳过导出', async () => {
    const prompts = [
      '你是对话标题生成器。根据下面的项目路径与对话内容，用中文生成一个不超过 12 个字的主题标题。',
      '为下面 12 个对话各生成一个中文主题标题（每个不超过 12 个字，不要引号/标点/解释）。'
    ]
    for (const prompt of prompts) {
      const tmp = tempRoot()
      const src = writeTemp(
        [makeLine('user', null, prompt), makeLine('assistant', 'claude-opus-5', '答复审查意见')].join('\n')
      )
      const historyRoot = path.join(tmp, 'history')
      const r = await exportSession({ sourceJsonl: src, historyRoot })
      expect(r.ok).toBe(false)
      expect(r.skipped).toBe(true)
      expect(exists(historyRoot)).toBe(false)
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('无 model 字段的旧转录不跳过（保守保留）', async () => {
    const tmp = tempRoot()
    const src = writeTemp(makeTranscript(null))
    const historyRoot = path.join(tmp, 'history')
    const r = await exportSession({ sourceJsonl: src, historyRoot })
    expect(r.ok).toBe(true)
    expect(r.skipped).toBeUndefined()
    rmSync(tmp, { recursive: true, force: true })
  })
})

const FIVE_FILES = ['对话.md', '对话.html', 'data.js', 'meta.json', 'transcript.jsonl']
/** 转录首条提问，经 titler → fallbackTitle 后原样保留（8 码点，未超 12） */
const LOCAL_TITLE = '帮我整理这份文件'

/** 五件套的纳秒级 mtime 指纹：判定"是否被重写"，精度足以区分毫秒内的连续两次写。 */
function fingerprint(dir: string): string[] {
  return FIVE_FILES.map((f) => String(statSync(path.join(dir, f), { bigint: true }).mtimeNs))
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function readMeta(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'))
}

function writeMeta(dir: string, patch: Record<string, unknown>): void {
  const p = path.join(dir, 'meta.json')
  writeFileSync(p, JSON.stringify({ ...readMeta(dir), ...patch }, null, 2), 'utf8')
}

describe('标题来源与重导出', () => {
  it('首次导出用本地标题，titleSource 记为 local 且目录名同步', async () => {
    const tmp = tempRoot()
    const historyRoot = path.join(tmp, 'history')

    const r = await exportSession({ sourceJsonl: writeTemp(makeTranscript('claude-opus-5')), historyRoot })

    expect(r.ok).toBe(true)
    expect(r.titleSource).toBe('local')
    const dir = r.dir as string
    expect(readMeta(dir).title).toBe(LOCAL_TITLE)
    expect(readMeta(dir).titleSource).toBe('local')
    expect(path.basename(dir)).toContain(LOCAL_TITLE)
    rmSync(tmp, { recursive: true, force: true })
  })

  it('源转录未增长时返回 unchanged，五件套一个字节都不重写', async () => {
    const tmp = tempRoot()
    const historyRoot = path.join(tmp, 'history')
    const src = writeTemp(makeTranscript('claude-opus-5'))

    const first = await exportSession({ sourceJsonl: src, historyRoot })
    const dir = first.dir as string
    const before = fingerprint(dir)
    await sleep(20)

    const again = await exportSession({ sourceJsonl: src, historyRoot })

    expect(again.ok).toBe(true)
    expect(again.unchanged).toBe(true)
    expect(again.dir).toBe(dir)
    expect(again.meta?.sessionId).toBe(SID)
    expect(fingerprint(dir)).toEqual(before)
    rmSync(tmp, { recursive: true, force: true })
  })

  it('用户手改的标题在重导出时原样沿用，titleSource 保持 user', async () => {
    const tmp = tempRoot()
    const historyRoot = path.join(tmp, 'history')
    const src = writeTemp(makeTranscript('claude-opus-5'))
    const dir = (await exportSession({ sourceJsonl: src, historyRoot })).dir as string
    writeMeta(dir, { title: '用户改名', titleSource: 'user' })
    appendFileSync(src, '\n' + makeLine('assistant', 'claude-opus-5', '补充一段'), 'utf8')

    const r = await exportSession({ sourceJsonl: src, historyRoot })

    expect(r.ok).toBe(true)
    expect(r.unchanged).toBeUndefined()
    expect(r.dir).toBe(dir)
    expect(r.titleSource).toBe('user')
    expect(readMeta(dir).title).toBe('用户改名')
    expect(readMeta(dir).titleSource).toBe('user')
    rmSync(tmp, { recursive: true, force: true })
  })

  it('既有污染标题被本地回退标题替换（cwd 末级目录名）', async () => {
    const tmp = tempRoot()
    const historyRoot = path.join(tmp, 'history')
    const src = writeTemp(makeTranscript('claude-opus-5'))
    const dir = (await exportSession({ sourceJsonl: src, historyRoot })).dir as string
    writeMeta(dir, { title: '你是对话标题生成器。根据下面的项目路径与对话内容', titleSource: 'llm' })
    appendFileSync(src, '\n' + makeLine('assistant', 'claude-opus-5', '补充一段'), 'utf8')

    const r = await exportSession({ sourceJsonl: src, historyRoot })

    expect(r.titleSource).toBe('local')
    expect(readMeta(dir).title).toBe('项目A') // cwd = /Users/me/项目A
    expect(readMeta(dir).titleSource).toBe('local')
    rmSync(tmp, { recursive: true, force: true })
  })

  it('titleMode 缺省时完全不拉起 claude', async () => {
    const tmp = tempRoot()
    const historyRoot = path.join(tmp, 'history')
    const marker = path.join(tmp, 'claude-called.txt')
    const stub = path.join(tmp, 'claude-stub.sh')
    writeFileSync(stub, `#!/bin/sh\ntouch "${marker}"\necho 不该出现的标题\n`, { mode: 0o755 })
    const prev = process.env.CHATARK_CLAUDE_BIN
    process.env.CHATARK_CLAUDE_BIN = stub

    try {
      const r = await exportSession({ sourceJsonl: writeTemp(makeTranscript('claude-opus-5')), historyRoot })
      expect(r.ok).toBe(true)
      expect(exists(marker)).toBe(false)
      expect(readMeta(r.dir as string).title).toBe(LOCAL_TITLE)
    } finally {
      if (prev === undefined) delete process.env.CHATARK_CLAUDE_BIN
      else process.env.CHATARK_CLAUDE_BIN = prev
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
