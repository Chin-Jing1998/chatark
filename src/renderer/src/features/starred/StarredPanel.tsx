import { useMemo } from 'react'
import { Pin, Star, Archive, type LucideIcon } from 'lucide-react'
import type { ConversationSummary, OrgMeta } from '@shared/types'
import { useStore, selectAllCategories } from '@renderer/app/store'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import ConversationItem from '@renderer/features/conversation/ConversationItem'

const SECTIONS: Array<{ key: keyof OrgMeta; label: string; icon: LucideIcon }> = [
  { key: 'pinned', label: '置顶', icon: Pin },
  { key: 'favorite', label: '收藏', icon: Star },
  { key: 'archived', label: '归档', icon: Archive }
]

/** 收藏 / 置顶面板（对标 Obsidian 书签）：按置顶 / 收藏 / 归档分段列出。 */
export default function StarredPanel(): JSX.Element {
  const { state, openConversation, activate } = useStore()
  const allCats = useMemo(() => selectAllCategories(state), [state.byCategory])

  const sections = useMemo(
    () =>
      SECTIONS.map((sec) => ({
        ...sec,
        items: state.summaries
          .filter((s) => s.org[sec.key as 'pinned' | 'favorite' | 'archived'])
          .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
      })),
    [state.summaries]
  )

  const open = (s: ConversationSummary): void =>
    state.tabs.some((t) => t.id === s.id) ? activate(s.id) : openConversation(s.id, s.title)

  const empty = sections.every((s) => s.items.length === 0)

  return (
    <div className="flex h-full flex-col">
      <div className="px-2 pb-1 pt-0.5 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        收藏 / 置顶
      </div>

      <ScrollArea className="flex-1">
        <div className="px-1.5 pb-3">
          {sections.map(
            (sec) =>
              sec.items.length > 0 && (
                <div key={sec.key as string} className="mb-2">
                  <div className="flex items-center gap-1.5 px-1.5 py-1 text-[11px] font-medium text-muted-foreground">
                    <sec.icon className="size-3.5" />
                    <span>{sec.label}</span>
                    <span className="tabular-nums text-muted-foreground/70">{sec.items.length}</span>
                  </div>
                  {sec.items.map((s) => (
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
              )
          )}

          {empty && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              还没有置顶或收藏。右键任意对话即可标记。
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
