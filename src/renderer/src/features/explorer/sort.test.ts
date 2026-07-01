import { describe, it, expect } from 'vitest'
import type { ConversationSummary } from '@shared/types'
import { sortItems } from './sort'

function mk(p: Partial<ConversationSummary> & { id: string }): ConversationSummary {
  return {
    id: p.id,
    sessionId: p.id,
    title: p.title ?? p.id,
    category: p.category ?? '其他',
    relPath: p.relPath ?? `其他/${p.id}`,
    model: p.model ?? 'opus',
    startedAt: p.startedAt ?? '',
    endedAt: p.endedAt ?? '',
    exportedAt: p.exportedAt ?? '',
    createdAtMs: p.createdAtMs ?? 0,
    messageCount: p.messageCount ?? 0,
    totalSizeBytes: p.totalSizeBytes ?? 0,
    org: p.org ?? { pinned: false, favorite: false, archived: false, tags: [] },
    integrity: p.integrity ?? {
      missingFiles: [],
      categoryMismatch: false,
      duplicateSessionId: false
    }
  }
}

const pinned = (id: string, extra: Partial<ConversationSummary> = {}): ConversationSummary =>
  mk({ id, org: { pinned: true, favorite: false, archived: false, tags: [] }, ...extra })

describe('sortItems', () => {
  it('置顶项恒在最前（降序）', () => {
    const items = [
      mk({ id: 'a', startedAt: '2026-01-03' }),
      pinned('p', { startedAt: '2026-01-01' }),
      mk({ id: 'b', startedAt: '2026-01-02' })
    ]
    const out = sortItems(items, 'started', 'desc', {})
    expect(out[0].id).toBe('p')
  })

  it('置顶项恒在最前（升序也是）', () => {
    const items = [
      mk({ id: 'a', startedAt: '2026-01-03' }),
      pinned('p', { startedAt: '2026-01-09' }),
      mk({ id: 'b', startedAt: '2026-01-02' })
    ]
    const out = sortItems(items, 'started', 'asc', {})
    expect(out[0].id).toBe('p')
  })

  it('按开始时间降序', () => {
    const items = [
      mk({ id: 'a', startedAt: '2026-01-01' }),
      mk({ id: 'b', startedAt: '2026-01-03' }),
      mk({ id: 'c', startedAt: '2026-01-02' })
    ]
    expect(sortItems(items, 'started', 'desc', {}).map((s) => s.id)).toEqual(['b', 'c', 'a'])
  })

  it('按名称升序（中文 locale）', () => {
    const items = [mk({ id: 'z', title: '苹果' }), mk({ id: 'y', title: '香蕉' })]
    const out = sortItems(items, 'title', 'asc', {})
    expect(out.map((s) => s.title)).toEqual(['苹果', '香蕉'])
  })

  it('按创建时间降序', () => {
    const items = [
      mk({ id: 'a', createdAtMs: 100 }),
      mk({ id: 'b', createdAtMs: 300 }),
      mk({ id: 'c', createdAtMs: 200 })
    ]
    expect(sortItems(items, 'created', 'desc', {}).map((s) => s.id)).toEqual(['b', 'c', 'a'])
  })

  it('按打开时间降序（未打开的排最后）', () => {
    const items = [mk({ id: 'a' }), mk({ id: 'b' }), mk({ id: 'c' })]
    const openedAt = { a: 500, c: 900 }
    expect(sortItems(items, 'opened', 'desc', openedAt).map((s) => s.id)).toEqual(['c', 'a', 'b'])
  })

  it('按文件大小降序', () => {
    const items = [
      mk({ id: 'a', totalSizeBytes: 10 }),
      mk({ id: 'b', totalSizeBytes: 30 }),
      mk({ id: 'c', totalSizeBytes: 20 })
    ]
    expect(sortItems(items, 'size', 'desc', {}).map((s) => s.id)).toEqual(['b', 'c', 'a'])
  })

  it('按导出时间升序', () => {
    const items = [
      mk({ id: 'a', exportedAt: '2026-03-02T00:00:00Z' }),
      mk({ id: 'b', exportedAt: '2026-03-01T00:00:00Z' })
    ]
    expect(sortItems(items, 'exported', 'asc', {}).map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('不修改入参数组', () => {
    const items = [mk({ id: 'a', startedAt: '1' }), mk({ id: 'b', startedAt: '2' })]
    const copy = [...items]
    sortItems(items, 'started', 'desc', {})
    expect(items).toEqual(copy)
  })
})
