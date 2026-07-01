import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { FILE_NAMES } from '@shared/constants'
import type { ConversationRecord, SearchHit } from '@shared/types'
import { mapLimit } from '../fs/paths'

const MAX_INDEX_CHARS = 500_000 // 单文档纳入索引的正文上限（md 实测最大约 278KB）
const SNIPPET_RADIUS = 36
const READ_CONCURRENCY = 8

interface DocSource {
  id: string
  title: string
  category: string
  mdPath: string | null
}

interface Doc {
  id: string
  title: string
  category: string
  text: string // 规范化（小写、压空白）后的正文，用于精确子串校验与片段
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ')
}

function trigrams(s: string): string[] {
  const out: string[] = []
  for (let i = 0; i + 3 <= s.length; i++) out.push(s.slice(i, i + 3))
  return out
}

/**
 * 纯 TS trigram 倒排全文索引（无原生依赖）。
 * 懒构建：首次查询时读取各对话 md 建索引；rescan 后置脏、下次查询重建。
 */
class SearchService {
  private sources: DocSource[] = []
  private docs = new Map<string, Doc>()
  private postings = new Map<string, Set<string>>()
  private dirty = true
  private building: Promise<void> | null = null

  /** 由 library 在每次扫描后注入数据源。 */
  setSource(records: ConversationRecord[]): void {
    this.sources = records.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      mdPath: r.files.md.exists ? join(r.absPath, FILE_NAMES.md) : null
    }))
    this.dirty = true
  }

  private async build(): Promise<void> {
    // 在让出事件循环前清脏标志并快照 sources（同步块内原子完成）：
    // 否则 mapLimit 的 I/O 期间到来的 setSource() 置 dirty=true 会被末尾覆盖，导致索引长期陈旧。
    this.dirty = false
    const sources = this.sources
    const docs = new Map<string, Doc>()
    const postings = new Map<string, Set<string>>()

    await mapLimit(sources, READ_CONCURRENCY, async (src) => {
      let body = ''
      if (src.mdPath) {
        try {
          body = await fs.readFile(src.mdPath, 'utf8')
        } catch {
          body = ''
        }
      }
      const text = normalize(`${src.title}\n${body}`).slice(0, MAX_INDEX_CHARS)
      docs.set(src.id, { id: src.id, title: src.title, category: src.category, text })

      const seen = new Set<string>()
      for (const g of trigrams(text)) {
        if (seen.has(g)) continue
        seen.add(g)
        let set = postings.get(g)
        if (!set) {
          set = new Set<string>()
          postings.set(g, set)
        }
        set.add(src.id)
      }
    })

    this.docs = docs
    this.postings = postings
  }

  private async ensureBuilt(): Promise<void> {
    if (!this.dirty && this.docs.size > 0) return
    if (!this.building) this.building = this.build().finally(() => (this.building = null))
    await this.building
  }

  private candidateIds(nq: string): string[] {
    if (nq.length < 3) return [...this.docs.keys()]
    const grams = [...new Set(trigrams(nq))]
    const sets = grams.map((g) => this.postings.get(g)).filter((s): s is Set<string> => Boolean(s))
    if (sets.length < grams.length) return [] // 任一 trigram 无倒排 → 不可能命中
    sets.sort((a, b) => a.size - b.size)
    let acc = [...sets[0]]
    for (let i = 1; i < sets.length && acc.length; i++) {
      const s = sets[i]
      acc = acc.filter((id) => s.has(id))
    }
    return acc
  }

  async query(q: string, limit = 50): Promise<SearchHit[]> {
    const nq = normalize(q)
    if (!nq) return []
    await this.ensureBuilt()

    const hits: SearchHit[] = []
    for (const id of this.candidateIds(nq)) {
      const doc = this.docs.get(id)
      if (!doc) continue
      const idx = doc.text.indexOf(nq)
      if (idx < 0) continue // trigram 仅必要条件，需精确子串校验
      const titleHit = normalize(doc.title).includes(nq)
      const occurrences = countOccurrences(doc.text, nq)
      const score = occurrences + (titleHit ? 50 : 0)
      hits.push({
        id,
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
