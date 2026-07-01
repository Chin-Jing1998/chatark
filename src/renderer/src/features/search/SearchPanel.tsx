import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { SearchHit } from '@shared/types'
import { useStore, selectAllCategories } from '@renderer/app/store'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import ConversationItem from '@renderer/features/conversation/ConversationItem'

/** 全文搜索面板（对标 Obsidian 搜索窗格）：面板内输入 + 命中列表常驻。 */
export default function SearchPanel({ active }: { active: boolean }): JSX.Element {
  const { state, openConversation, activate } = useStore()
  const allCats = useMemo(() => selectAllCategories(state), [state.byCategory])
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (active) inputRef.current?.focus()
  }, [active])

  useEffect(() => {
    const term = q.trim()
    if (!term) {
      setHits([])
      return
    }
    // cancelled 标志：定时器已触发、请求在途时若查询变化/清空，丢弃过期响应，避免覆写新状态
    let cancelled = false
    const timer = setTimeout(() => {
      void window.api.search.query(term, 60).then((r) => {
        if (!cancelled) setHits(r)
      })
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [q])

  const byId = useMemo(() => new Map(state.summaries.map((s) => [s.id, s])), [state.summaries])
  const results = useMemo(
    () => hits.map((h) => ({ hit: h, summary: byId.get(h.id) })).filter((r) => r.summary),
    [hits, byId]
  )

  const open = (id: string, title: string): void =>
    state.tabs.some((t) => t.id === id) ? activate(id) : openConversation(id, title)

  const term = q.trim()

  return (
    <div className="flex h-full flex-col">
      <div className="px-2 pb-1 pt-0.5">
        <div className="mb-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          全文搜索
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索标题与正文…"
            aria-label="全文搜索"
            className="h-8 w-full rounded-md border bg-background pl-8 pr-8 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {q && (
            <button
              type="button"
              aria-label="清空搜索"
              onClick={() => setQ('')}
              className="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="mt-2 min-h-[15px] text-[11px] text-muted-foreground" role="status" aria-live="polite">
          {term ? `命中 ${results.length} 条` : ''}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-0.5 px-1.5 pb-3">
          {results.map(({ hit, summary }) => (
            <ConversationItem
              key={hit.id}
              item={summary!}
              categories={allCats}
              active={state.activeId === hit.id}
              onOpen={() => open(hit.id, hit.title)}
              variant="tree"
              depth={1}
              showPath
            />
          ))}
          {term && results.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">无匹配</div>
          )}
          {!term && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              输入关键词开始搜索
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
