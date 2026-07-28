import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { FILE_NAMES } from '@shared/constants'
import type { ConversationRecord, SearchHit } from '@shared/types'
import { mapLimit } from '../fs/paths'

/** 单文档纳入索引的正文上限（md 实测最大约 278KB）。 */
const MAX_INDEX_CHARS = 500_000
/**
 * 全库正文常驻上限。超出后新文档只索引标题，避免超大库把主进程内存吃光。
 * 200M 字符 ≈ 400MB（UTF-16）；实测 274 篇对话约用 39M 字符，余量约 7 倍。
 */
const MAX_TOTAL_INDEX_CHARS = 200_000_000
const SNIPPET_RADIUS = 36
const READ_CONCURRENCY = 8

interface DocSource {
  id: string
  title: string
  category: string
  mdPath: string | null
  /** 关键文件 size:mtime 指纹；不变则正文无需重读（增量索引的判据） */
  fingerprint: string
}

interface Doc extends DocSource {
  /** 规范化（小写、压空白）后的正文，用于子串匹配与片段提取 */
  text: string
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ')
}

/**
 * 纯 TS 全文搜索（无原生依赖、无落盘，索引常驻主进程内存）。
 *
 * 实现取舍：**不建 trigram 倒排，直接对常驻正文做子串扫描**。
 * 实测 274 篇对话（39M 字符）全表扫描耗时 1–7ms，而同样数据的 trigram 倒排要占约 1.2GB
 * 内存（正文本身仅 78MB）——倒排在此规模下是净负债：拿 16 倍内存换用户感知不到的几毫秒。
 *
 * 索引为增量构建：rescan 后按 fingerprint 只重读内容真正变化的对话，
 * 未变的复用已有正文，避免每次外部文件改动都全库重读 md。
 */
class SearchService {
  private sources: DocSource[] = []
  private docs = new Map<string, Doc>()
  private dirty = true
  private built = false
  private building: Promise<void> | null = null

  /** 由 library 在每次扫描后注入数据源。 */
  setSource(records: ConversationRecord[]): void {
    this.sources = records.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      mdPath: r.files.md.exists ? join(r.absPath, FILE_NAMES.md) : null,
      fingerprint: r.fingerprint
    }))
    this.dirty = true
  }

  private async build(): Promise<void> {
    // 在让出事件循环前清脏标志并快照 sources（同步块内原子完成）：
    // 否则 mapLimit 的 I/O 期间到来的 setSource() 置 dirty=true 会被末尾覆盖，导致索引长期陈旧。
    this.dirty = false
    const sources = this.sources
    const prev = this.docs

    // 增量：指纹未变且已索引过的文档直接复用正文，只重读真正变化的
    const reused = new Map<string, Doc>()
    const stale: DocSource[] = []
    for (const src of sources) {
      const old = prev.get(src.id)
      if (old && old.fingerprint === src.fingerprint && old.mdPath === src.mdPath) {
        // 标题/分类可能在正文未变的情况下改动（重命名、改分类），一并刷新
        reused.set(src.id, { ...old, title: src.title, category: src.category })
      } else {
        stale.push(src)
      }
    }

    let budget = MAX_TOTAL_INDEX_CHARS
    for (const d of reused.values()) budget -= d.text.length

    const fresh = await mapLimit(stale, READ_CONCURRENCY, async (src) => {
      let body = ''
      if (src.mdPath) {
        try {
          body = await fs.readFile(src.mdPath, 'utf8')
        } catch {
          body = ''
        }
      }
      return { src, body }
    })

    const docs = new Map<string, Doc>(reused)
    for (const { src, body } of fresh) {
      // 预算耗尽时退化为只索引标题（仍可按标题搜到），不让内存无上限增长
      const room = Math.max(src.title.length, Math.min(MAX_INDEX_CHARS, budget))
      const text = normalize(`${src.title}\n${body}`).slice(0, room)
      budget -= text.length
      docs.set(src.id, { ...src, text })
    }

    this.docs = docs
    this.built = true
  }

  private async ensureBuilt(): Promise<void> {
    if (!this.dirty && this.built) return
    if (!this.building) this.building = this.build().finally(() => (this.building = null))
    await this.building
  }

  async query(q: string, limit = 50): Promise<SearchHit[]> {
    const nq = normalize(q)
    if (!nq) return []
    await this.ensureBuilt()

    const hits: SearchHit[] = []
    for (const doc of this.docs.values()) {
      const idx = doc.text.indexOf(nq)
      if (idx < 0) continue
      const titleHit = normalize(doc.title).includes(nq)
      const occurrences = countOccurrences(doc.text, nq)
      const score = occurrences + (titleHit ? 50 : 0)
      hits.push({
        id: doc.id,
        title: doc.title,
        category: doc.category,
        score,
        snippet: makeSnippet(doc.text, idx, nq.length)
      })
    }
    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, limit)
  }
}

function countOccurrences(text: string, needle: string): number {
  let count = 0
  let from = 0
  for (;;) {
    const i = text.indexOf(needle, from)
    if (i < 0) break
    count++
    from = i + needle.length
  }
  return count
}

function makeSnippet(text: string, idx: number, len: number): string {
  const start = Math.max(0, idx - SNIPPET_RADIUS)
  const end = Math.min(text.length, idx + len + SNIPPET_RADIUS)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return prefix + text.slice(start, end).trim() + suffix
}

export const searchService = new SearchService()
