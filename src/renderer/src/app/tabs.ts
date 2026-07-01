/** 标签模型与“满 10 时 LRU 淘汰”的纯逻辑（无 React/Electron 依赖，便于单测）。 */

export interface Tab {
  id: string
  title: string
  /** conversation：对话 iframe（默认）；file：应用内打开的任意文件（附绝对路径） */
  kind?: 'conversation' | 'file'
  /** kind==='file' 时的文件绝对路径 */
  path?: string
}

/** 同时打开标签上限：超过时按“最久未用”自动淘汰。 */
export const MAX_TABS = 10

/** 在近用列表前置一个 id（去重，最近在前）。 */
export function bump(recency: string[], id: string): string[] {
  return [id, ...recency.filter((x) => x !== id)]
}

/** 满 MAX_TABS 时挑选被淘汰者：近用列表中最久未用、且非新标签的、仍开着的标签。 */
export function pickLru(tabs: Tab[], recency: string[], keepId: string): string | null {
  for (let i = recency.length - 1; i >= 0; i--) {
    const id = recency[i]
    if (id !== keepId && tabs.some((t) => t.id === id)) return id
  }
  const fallback = tabs.find((t) => t.id !== keepId)
  return fallback ? fallback.id : null
}

/** 追加新标签；若超上限则淘汰最久未用者，保证结果 ≤ MAX_TABS 且含新标签。 */
export function appendCapped(tabs: Tab[], recency: string[], tab: Tab): Tab[] {
  const next = [...tabs, tab]
  if (next.length <= MAX_TABS) return next
  const lru = pickLru(next, recency, tab.id)
  return lru ? next.filter((t) => t.id !== lru) : next.slice(1)
}
