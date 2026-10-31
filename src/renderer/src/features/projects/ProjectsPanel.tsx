import { useMemo, useState } from 'react'
import { ChevronRight, ChevronsDownUp, FolderGit2 } from 'lucide-react'
import type { ConversationSummary } from '@shared/types'
import { cn } from '@renderer/lib/cn'
import { useStore, selectAllCategories } from '@renderer/app/store'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import ConversationItem from '@renderer/features/conversation/ConversationItem'
import { commonPrefixSegments, groupByProject, shortenCwd } from './group'

/** Windows 路径大小写不敏感；渲染层读不到 process.platform，退而按浏览器标识判定。 */
function isCaseInsensitivePath(): boolean {
  if (typeof navigator === 'undefined') return false
  return /win/i.test(navigator.platform || '') || /windows/i.test(navigator.userAgent || '')
}

/** 按项目视图：以会话工作目录（meta.cwd）分组的可折叠列表。 */
export default function ProjectsPanel(): JSX.Element {
  const { state, openConversation, activate } = useStore()
  const allCats = useMemo(() => selectAllCategories(state), [state.byCategory])
  const caseInsensitive = useMemo(() => isCaseInsensitivePath(), [])

  const groups = useMemo(
    () => groupByProject(state.summaries, state.openedAt, caseInsensitive),
    [state.summaries, state.openedAt, caseInsensitive]
  )
  const prefix = useMemo(() => commonPrefixSegments(groups.map((g) => g.cwd)), [groups])

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const isOpen = (k: string): boolean => !collapsed.has(k)
  const toggle = (k: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  const allCollapsed = collapsed.size >= groups.length && groups.length > 0
  const toggleAll = (): void =>
    setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.key)))

  const open = (s: ConversationSummary): void =>
    state.tabs.some((t) => t.id === s.id) ? activate(s.id) : openConversation(s.id, s.title)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/40 px-2.5">
        <span className="flex-1 truncate text-[12px] font-semibold tracking-tight text-foreground/85">
          按项目归档
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {groups.length}
        </span>
        <button
          type="button"
          title={allCollapsed ? '展开全部' : '折叠全部'}
          aria-label={allCollapsed ? '展开全部' : '折叠全部'}
          onClick={toggleAll}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ChevronsDownUp className="size-4" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-1.5 pb-3">
          {groups.map((g) => {
            const sub = shortenCwd(g.cwd, prefix)
            return (
              <div key={g.key} className="select-none">
                <button
                  onClick={() => toggle(g.key)}
                  aria-expanded={isOpen(g.key)}
                  aria-label={`项目 ${g.label}，${g.items.length} 个对话`}
                  title={g.cwd || undefined}
                  className="group flex w-full items-start gap-1 rounded-md py-[5px] pl-1 pr-2 text-left text-[13px] font-medium text-sidebar-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronRight
                    className={cn(
                      'mt-[3px] size-3.5 shrink-0 text-muted-foreground transition-transform',
                      isOpen(g.key) && 'rotate-90'
                    )}
                  />
                  <FolderGit2 className="mt-[2px] size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1">
                      <span className="flex-1 truncate">{g.label}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
                        {g.items.length}
                      </span>
                    </span>
                    {sub && (
                      <span className="block truncate text-[11px] font-normal text-muted-foreground/70">
                        {sub}
                      </span>
                    )}
                  </span>
                </button>

                {/* grid-rows 0fr↔1fr 实现无需测量的高度过渡；子项常驻渲染以支持动画 */}
                <div
                  className="grid transition-[grid-template-rows] duration-200 ease-glass"
                  style={{ gridTemplateRows: isOpen(g.key) ? '1fr' : '0fr' }}
                  aria-hidden={!isOpen(g.key)}
                >
                  <div className="min-h-0 overflow-hidden">
                    {g.items.map((s) => (
                      <ConversationItem
                        key={s.id}
                        item={s}
                        categories={allCats}
                        active={state.activeId === s.id}
                        onOpen={() => open(s)}
                        variant="tree"
                        depth={1}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )
          })}

          {!state.loading && groups.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">库中暂无对话</div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
