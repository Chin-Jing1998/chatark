/**
 * 黄金样本回归：用 TS 导出器对历史库现成样本重新生成，与库中 对话.md / meta.json /
 * data.js 逐项比对。
 *
 * 样本预筛（异步、在 describe 之前完成）：仅保留 sourcePath 仍存在、gate 通过、且
 * 重建 messageCount 与 golden 一致（源未漂移）者，使后续断言全部真实生效。
 * 绝不写入真实历史库；exportSession 落盘到 scratchpad 临时目录后清理。
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildConversation,
  exportSession,
  folderName,
  metaDict,
  parseJsonl,
  renderHtml,
  renderJs,
  renderJsSerialized,
  renderMd,
  shouldExport,
  skipReason,
  type Conversation
} from './index'
import type { MetaJson } from '@shared/types'
import { resolveTestLibraryRoot } from '../../test-support/library-root'

/**
 * 黄金样本取自使用者本机的真实历史库，故路径不写死在仓库里：
 * CHATARK_TEST_LIBRARY > 应用配置 historyRoot > 默认库根；均不可用时整组跳过。
 */
const HISTORY_ROOT = resolveTestLibraryRoot() ?? ''

interface Candidate {
  dir: string
  meta: MetaJson
  source: string
  mdPath: string
  dataPath: string
}
interface Sample extends Candidate {
  conv: Conversation
}

function sizeOf(p: string): number {
  try {
    return statSync(p).size
  } catch {
    return 0
  }
}

/** 扫描历史库，收集 sourcePath 仍存在的候选。 */
function scanCandidates(): Candidate[] {
  if (!existsSync(HISTORY_ROOT)) return []
  const out: Candidate[] = []
  let categories: string[]
  try {
    categories = readdirSync(HISTORY_ROOT)
  } catch {
    return []
  }
  for (const cat of categories) {
    const catDir = path.join(HISTORY_ROOT, cat)
    let convDirs: string[]
    try {
      if (!statSync(catDir).isDirectory()) continue
      convDirs = readdirSync(catDir)
    } catch {
      continue
    }
    for (const d of convDirs) {
      const dir = path.join(catDir, d)
      const metaPath = path.join(dir, 'meta.json')
      const mdPath = path.join(dir, '对话.md')
      const dataPath = path.join(dir, 'data.js')
      if (!existsSync(metaPath) || !existsSync(mdPath) || !existsSync(dataPath)) continue
      let meta: MetaJson
      try {
        meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as MetaJson
      } catch {
        continue
      }
      const source = meta.sourcePath || ''
      if (!source || !existsSync(source)) continue
      out.push({ dir, meta, source, mdPath, dataPath })
    }
  }
  return out
}

/** 预筛：构建每个候选，仅保留 gate 通过且未漂移者，并缓存已构建的 conv；按源大小均匀取最多 6 个。 */
async function collectCleanSamples(): Promise<Sample[]> {
  const candidates = scanCandidates().sort((a, b) => sizeOf(a.source) - sizeOf(b.source))
  const clean: Sample[] = []
  for (const c of candidates) {
    try {
      const parsed = await parseJsonl(c.source)
      if (!shouldExport(parsed)) continue
      const conv = buildConversation(parsed.records, { sourcePath: c.source, stats: parsed.stats })
      if (skipReason(conv)) continue // haiku / 自动注入 prompt 派生的会话不会被导出，剔除
      if (conv.session_id !== c.meta.sessionId) continue
      if (conv.message_count !== c.meta.messageCount) continue // 源相对 golden 漂移则剔除
      if (conv.title !== c.meta.title) continue // 标题被维护重命名等改过则剔除
      clean.push({ ...c, conv })
    } catch {
      continue
    }
  }
  if (clean.length === 0) return []
  const want = Math.min(6, clean.length)
  const picks: Sample[] = []
  for (let i = 0; i < want; i++) {
    const idx = Math.floor((i * (clean.length - 1)) / Math.max(1, want - 1))
    if (!picks.includes(clean[idx])) picks.push(clean[idx])
  }
  return picks
}

/** 解析 data.js 的内嵌负载（剥离 window.CONVERSATION = ... ;，还原 <）。 */
function parseDataJs(text: string): { meta: Record<string, unknown>; events: Record<string, unknown>[] } {
  const body = text.replace(/^[\s\S]*?window\.CONVERSATION\s*=\s*/, '').replace(/;\s*$/, '')
  return JSON.parse(body)
}

function firstDiff(a: string, b: string): { index: number; mine: string; golden: string } {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i++
  return { index: i, mine: a.slice(Math.max(0, i - 20), i + 60), golden: b.slice(Math.max(0, i - 20), i + 60) }
}

function cleanup(dir: string): void {
  try {
    // 用 fs.rmSync 而非 execSync('rm -rf')：后者在 Windows 上不存在，会让本用例恒失败
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // 忽略清理失败
  }
}

const samples = await collectCleanSamples()

describe('TS 导出器黄金样本回归', () => {
  if (!HISTORY_ROOT) {
    it.skip('未找到可用历史库，跳过', () => {})
    return
  }

  // 库可用而样本为 0 说明守卫已失效（候选全漂移或被预筛清空），必须报警而非静默跳过
  it('样本集非空', () => {
    expect(samples.length).toBeGreaterThan(0)
  })
  if (samples.length === 0) return

  for (const s of samples) {
    const name = path.basename(s.dir)
    describe(name, () => {
      it('meta.json 核心字段完全一致', () => {
        const m = metaDict(s.conv)
        expect(m.sessionId).toBe(s.meta.sessionId)
        expect(m.title).toBe(s.meta.title)
        expect(m.category).toBe(s.meta.category)
        expect(m.model ?? null).toBe(s.meta.model ?? null)
        expect(m.messageCount).toBe(s.meta.messageCount)
        expect(m.userPromptCount).toBe(s.meta.userPromptCount)
        expect(m.assistantCount).toBe(s.meta.assistantCount)
        expect(m.anyTruncated).toBe(s.meta.anyTruncated)
        expect(m.startedAt).toBe(s.meta.startedAt)
        expect(m.endedAt).toBe(s.meta.endedAt)
      })

      it('data.js events 长度与关键字段一致', () => {
        const goldenData = parseDataJs(readFileSync(s.dataPath, 'utf-8'))
        const mine = JSON.parse(renderJsSerialized(s.conv, false).replace(/\\u003c/g, '<')) as {
          events: Record<string, unknown>[]
          meta: Record<string, unknown>
        }
        expect(mine.events.length).toBe(goldenData.events.length)
        for (let i = 0; i < mine.events.length; i++) {
          const a = mine.events[i]
          const b = goldenData.events[i]
          expect(a.seq).toBe(b.seq)
          expect(a.type).toBe(b.type)
          expect(a.role).toBe(b.role)
          expect(a.text).toBe(b.text)
          expect(a.toolName ?? null).toBe(b.toolName ?? null)
          expect(a.truncated).toBe(b.truncated)
          expect(a.originalBytes).toBe(b.originalBytes)
          expect(a.paired).toBe(b.paired)
        }
        // meta 内嵌字段（含本地化时间）亦应一致
        expect(mine.meta.messageCount).toBe(goldenData.meta.messageCount)
        expect(mine.meta.startedAtLocal).toBe(goldenData.meta.startedAtLocal)
        expect(mine.meta.endedAtLocal).toBe(goldenData.meta.endedAtLocal)
        // 整文件字节级一致（render_js.py 早于 golden 生成时间，可作字节基准）
        expect(renderJs(s.conv, false)).toBe(readFileSync(s.dataPath, 'utf-8'))
      })

      it('对话.md 与 golden 完全一致', () => {
        const golden = readFileSync(s.mdPath, 'utf-8')
        const mine = renderMd(s.conv)
        if (mine !== golden) {
          const d = firstDiff(mine, golden)
          console.warn(
            `[md-diff] ${name} @${d.index}\n  mine  : ${JSON.stringify(d.mine)}\n  golden: ${JSON.stringify(d.golden)}`
          )
        }
        expect(mine).toBe(golden)
      })

      it('对话.html 含数据脚本与查看器骨架、无残留占位符', () => {
        const html = renderHtml(s.conv, false)
        expect(html).toContain('window.CONVERSATION = ')
        expect(html).toContain('<!DOCTYPE html>')
        expect(html).not.toContain('__DATA__')
        expect(html).not.toContain('__TOKENS__')
        expect(html).not.toContain('__GLASS__')
        expect(html).not.toContain('__TITLE__')
      })
    })
  }

  it('exportSession 落盘 5 件套到临时目录（不污染真实库）且幂等', async () => {
    const s = samples[0]
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'chatark-export-'))
    const outcome = await exportSession({ sourceJsonl: s.source, historyRoot: tmpRoot })
    if (!outcome.ok) console.warn(`[export-fail] ${s.source} reason=${outcome.reason}`)
    expect(outcome.ok).toBe(true)
    const dir = outcome.dir as string
    expect(dir).toBeTruthy()
    for (const f of ['对话.md', '对话.html', 'data.js', 'meta.json', 'transcript.jsonl']) {
      expect(existsSync(path.join(dir, f)), `缺少 ${f}`).toBe(true)
    }
    // 新目录一律用本地规则标题（不等 LLM），故目录名由落盘的 meta.title 反推
    const written = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf-8')) as MetaJson
    expect(written.titleSource).toBe('local')
    expect(outcome.titleSource).toBe('local')
    expect(path.basename(dir)).toBe(folderName({ ...s.conv, title: written.title ?? '' }))
    // 落盘的 md 与直接渲染一致
    expect(readFileSync(path.join(dir, '对话.md'), 'utf-8')).toBe(renderMd({ ...s.conv, title: written.title ?? '' }))
    // 幂等：源转录未变，第二次直接判定 unchanged 并复用同目录
    const again = await exportSession({ sourceJsonl: s.source, historyRoot: tmpRoot })
    expect(again.ok).toBe(true)
    expect(again.unchanged).toBe(true)
    expect(again.dir).toBe(dir)
    cleanup(tmpRoot)
  })

  it('gate 拦截无助手回复的中断会话', () => {
    // 由预筛保证 samples 全部可导出；此处单独验证 gate 对“仅 user、无 assistant”返回 false
    const fakeRecords = [
      { type: 'user', message: { content: 'hello' } },
      { type: 'user', message: { content: 'are you there' } }
    ]
    const parsed = { records: fakeRecords, stats: { total_lines: 2, bad_lines: 0, good_lines: 2 } }
    expect(shouldExport(parsed)).toBe(false)
  })
})
