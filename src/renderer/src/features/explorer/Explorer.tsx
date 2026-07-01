import { useMemo, useState } from 'react'
import {
  ChevronRight,
  Folder,
  FolderOpen,
  ChevronsDownUp,
  ArrowDownUp,
  RefreshCw
} from 'lucide-react'
import type { ConversationSummary } from '@shared/types'
import { cn } from '@renderer/lib/cn'
import { useStore, selectOrderedCategories, selectAllCategories } from '@renderer/app/store'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import ConversationItem from '@renderer/features/conversation/ConversationItem'
import { sortItems, SORT_LABELS, type SortKey, type SortDir } from './sort'

const SORT_KEY_STORE = 'chatark-sort-key'
const SORT_DIR_STORE = 'chatark-sort-dir'

function loadSortKey(): SortKey {
  const v = localStorage.getItem(SORT_KEY_STORE)
  return SORT_LABELS.some((s) => s.key === v) ? (v as SortKey) : 'started'
}
function loadSortDir(): SortDir {
  const v = localStorage.getItem(SORT_DIR_STORE)
  return v === 'asc' || v === 'desc' ? v : 'desc'
}

/** 对话浏览器：按分类分组的可折叠文件树（对标 Obsidian 文件资源管理器）。 */
export default function Explorer(): JSX.Element {
  const { state, openConversation, activate, rescan } = useStore()
  const ordered = useMemo(() => selectOrderedCategories(state), [state.byCategory])
  const allCats = useMemo(() => selectAllCategories(state), [state.byCategory])

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>(loadSortKey)
  const [sortDir, setSortDir] = useState<SortDir>(loadSortDir)

  const changeSortKey = (k: SortKey): void => {
    setSortKey(k)
    try {
      localStorage.setItem(SORT_KEY_STORE, k)
    } catch {
      /* 忽略 */
    }
  }
  const changeSortDir = (d: SortDir): void => {
    setSortDir(d)
    try {
      localStorage.setItem(SORT_DIR_STORE, d)
    } catch {
      /* 忽略 */
    }
  }

  const groups = useMemo(
    () =>
      ordered.map((cat) => ({
        cat,
        items: sortItems(
          state.summaries.filter((s) => s.category === cat),
          sortKey,
          sortDir,
          state.openedAt
        )
      })),
    [ordered, state.summaries, sortKey, sortDir, state.openedAt]
  )

  const isOpen = (c: string): boolean => !collapsed.has(c)
  const toggle = (c: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })
  const allCollapsed = collapsed.size >= ordered.length && ordered.length > 0
  const toggleAll = (): void => setCollapsed(allCollapsed ? new Set() : new Set(ordered))

  const open = (s: ConversationSummary): void =>
    state.tabs.some((t) => t.id === s.id) ? activate(s.id) : openConversation(s.id, s.title)

  return (
    <div className="flex h-full flex-col">
      <ToolBar
        loading={state.loading}
        allCollapsed={allCollapsed}
        onToggleAll={toggleAll}
        sortKey={sortKey}
        sortDir={sortDir}
        onSortKey={changeSortKey}
        onSortDir={changeSortDir}
        onRescan={() => void rescan()}
      />

      <ScrollArea className="flex-1">
        <div className="px-1.5 pb-3">
          {groups.map(({ cat, items }) => (
            <div key={cat} className="select-none">
              <button
                onClick={() => toggle(cat)}
                aria-expanded={isOpen(cat)}
                aria-label={`分类 ${cat}，${items.length} 个对话`}
                className="group flex w-full items-center gap-1 rounded-md py-[5px] pl-1 pr-2 text-left text-[13px] font-medium text-sidebar-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronRight
                  className={cn(
                    'size-3.5 shrink-0 text-muted-foreground transition-transform',
                    isOpen(cat) && 'rotate-90'
                  )}
                />
                {isOpen(cat) ? (
                  <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1 truncate">{cat}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
                  {items.length}
                </span>
              </button>

              {/* grid-rows 0fr↔1fr 实现无需测量的高度过渡；子项常驻渲染以支持动画 */}
              <div
                className="grid transition-[grid-template-rows] duration-200 ease-glass"
                style={{ gridTemplateRows: isOpen(cat) ? '1fr' : '0fr' }}
                aria-hidden={!isOpen(cat)}
              >
                <div className="min-h-0 overflow-hidden">
                  {items.map((s) => (
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
          ))}

          {!state.loading && groups.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">库中暂无对话</div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function ToolBar({
  loading,
  allCollapsed,
  onToggleAll,
  sortKey,
  sortDir,
  onSortKey,
  onSortDir,
  onRescan
}: {
  loading: boolean
  allCollapsed: boolean
  onToggleAll: () => void
  sortKey: SortKey
  sortDir: SortDir
  onSortKey: (k: SortKey) => void
  onSortDir: (d: SortDir) => void
  onRescan: () => void
}): JSX.Element {
  return (
    <div className="flex items-center gap-0.5 px-2 pb-1 pt-0.5">
      <span className="flex-1 truncate pl-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        对话浏览器
      </span>
      <IconBtn
        title={allCollapsed ? '展开全部' : '折叠全部'}
        onClick={onToggleAll}
        icon={<ChevronsDownUp className="size-4" />}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title="排序"
            aria-label="排序"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowDownUp className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuLabel>排序依据</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={sortKey} onValueChange={(v) => onSortKey(v as SortKey)}>
            {SORT_LABELS.map((s) => (
              <DropdownMenuRadioItem key={s.key} value={s.key}>
                {s.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={sortDir} onValueChange={(v) => onSortDir(v as SortDir)}>
            <DropdownMenuRadioItem value="desc">降序</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="asc">升序</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <IconBtn
        title="重新扫描"
        onClick={onRescan}
        icon={<RefreshCw className={cn('size-4', loading && 'animate-spin')} />}
      />
    </div>
  )
}

function IconBtn({
  title,
  onClick,
  icon
}: {
  title: string
  onClick: () => void
  icon: JSX.Element
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {icon}
    </button>
  )
}
