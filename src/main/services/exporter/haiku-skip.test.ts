/**
 * haiku 主导会话跳过导出：gate 通过（≥1 助手回合且 ≥2 实质消息）但主导模型为
 * haiku 时，exportSession 返回 { ok:false, skipped:true } 且不落盘；同构非 haiku
 * 会话正常导出。全部写入临时目录，不触碰真实历史库。
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
