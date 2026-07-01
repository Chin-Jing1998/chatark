/** 对话浏览器排序的纯逻辑（无 React 依赖，便于单测）。 */
import type { ConversationSummary } from '@shared/types'

export type SortKey = 'started' | 'exported' | 'created' | 'opened' | 'title' | 'size'
export type SortDir = 'asc' | 'desc'

export const SORT_LABELS: Array<{ key: SortKey; label: string }> = [
  { key: 'started', label: '开始时间' },
  { key: 'exported', label: '导出时间' },
  { key: 'created', label: '创建时间' },
  { key: 'opened', label: '打开时间' },
  { key: 'title', label: '名称' },
  { key: 'size', label: '文件大小' }
]

/** 单键升序比较（a 在前返回负）。 */
export function compareBy(
  a: ConversationSummary,
  b: ConversationSummary,
  key: SortKey,
  openedAt: Record<string, number>
): number {
  switch (key) {
    case 'title':
      return a.title.localeCompare(b.title, 'zh')
    case 'exported':
      return (a.exportedAt || '').localeCompare(b.exportedAt || '')
    case 'created':
      return (a.createdAtMs || 0) - (b.createdAtMs || 0)
    case 'opened':
      return (openedAt[a.id] || 0) - (openedAt[b.id] || 0)
    case 'size':
      return (a.totalSizeBytes || 0) - (b.totalSizeBytes || 0)
    case 'started':
    default:
      return (a.startedAt || '').localeCompare(b.startedAt || '')
  }
}

/** 排序：置顶项恒在最前，其余按所选键与方向排序（稳定副本，不改入参）。 */
export function sortItems(
  items: ConversationSummary[],
  key: SortKey,
  dir: SortDir,
  openedAt: Record<string, number>
): ConversationSummary[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...items].sort((a, b) => {
    const pa = a.org.pinned ? 0 : 1
    const pb = b.org.pinned ? 0 : 1
    if (pa !== pb) return pa - pb
    return sign * compareBy(a, b, key, openedAt)
  })
}
