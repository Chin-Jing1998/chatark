import { useMemo, useState } from 'react'
import { Folder, Hash } from 'lucide-react'
import type { ConversationSummary } from '@shared/types'
import { cn } from '@renderer/lib/cn'
import {
  useStore,
  selectAllCategories,
  selectOrderedCategories
} from '@renderer/app/store'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import ConversationItem from '@renderer/features/conversation/ConversationItem'

type Sel = { kind: 'category' | 'tag'; value: string } | null

/** 标签 / 分类筛选面板：上方列分类与标签及计数，选中后下方列出匹配对话。 */
export default function TagsPanel(): JSX.Element {
  const { state, openConversation, activate } = useStore()
  const allCats = useMemo(() => selectAllCategories(state), [state.byCategory])
  const ordered = useMemo(() => selectOrderedCategories(state), [state.byCategory])

  const tagCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of state.summaries) for (const t of s.org.tags) m.set(t, (m.get(t) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [state.summaries])

  const [sel, setSel] = useState<Sel>(null)

  const matches = useMemo(() => {
    if (!sel) return [] as ConversationSummary[]
    return state.summaries
      .filter((s) =>
        sel.kind === 'category' ? s.category === sel.value : s.org.tags.includes(sel.value)
      )
      .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
  }, [sel, state.summaries])

  const isSel = (kind: 'category' | 'tag', value: string): boolean =>
    sel?.kind === kind && sel.value === value

  const pick = (kind: 'category' | 'tag', value: string): void =>
    setSel((cur) => (cur?.kind === kind && cur.value === value ? null : { kind, value }))

  const open = (s: ConversationSummary): void =>
    state.tabs.some((t) => t.id === s.id) ? activate(s.id) : openConversation(s.id, s.title)

  return (
    <div className="flex h-full flex-col">
      <div className="px-2 pb-1 pt-0.5 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        标签 / 分类
      </div>

      <ScrollArea className="flex-1">
        <div className="px-1.5 pb-3">
          <SectionLabel>分类</SectionLabel>
          {ordered.map((c) => (
            <Row
              key={c}
              icon={<Folder className="size-3.5" />}
              label={c}
              count={state.byCategory[c] ?? 0}
              active={isSel('category', c)}
              onClick={() => pick('category', c)}
            />
          ))}

          {tagCounts.length > 0 && (
            <>
              <SectionLabel>标签</SectionLabel>
              {tagCounts.map(([t, n]) => (
                <Row
                  key={t}
                  icon={<Hash className="size-3.5" />}
                  label={t}
                  count={n}
                  active={isSel('tag', t)}
                  onClick={() => pick('tag', t)}
                />
              ))}
            </>
          )}

          {sel && (
            <div className="mt-2 border-t pt-2">
              <div className="px-1.5 pb-1 text-[11px] text-muted-foreground">
                {sel.value} · {matches.length} 条
              </div>
              {matches.map((s) => (
                <ConversationItem
                  key={s.id}
                  item={s}
                  categories={allCats}
                  active={state.activeId === s.id}
                  onOpen={() => open(s)}
                  variant="tree"
                  depth={1}
                  showPath
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="px-1.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
      {children}
    </div>
  )
}

function Row({
  icon,
  label,
  count,
  active,
  onClick
}: {
  icon: JSX.Element
  label: string
  count: number
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md px-1.5 py-[5px] text-left text-[13px] transition-colors',
        active
          ? 'bg-brand/15 font-medium text-foreground'
          : 'text-sidebar-foreground hover:bg-accent hover:text-accent-foreground'
      )}
    >
      <span className={cn('shrink-0', active ? 'text-brand' : 'text-muted-foreground')}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">{count}</span>
    </button>
  )
}
