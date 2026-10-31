import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ChevronRight,
  Folder,
  FolderOpen,
  ChevronsDownUp,
  ArrowDownUp,
  RefreshCw
} from 'lucide-react'
import type { ConversationSummary } from '@shared/types'
import { UNCATEGORIZED } from '@shared/constants'
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

/** toast 与 title 中列举跳过/失败明细的条数上限（全量对用户无意义且撑爆界面）。 */
const TOAST_DETAIL_MAX = 3
const TITLE_DETAIL_MAX = 10

/** 对话浏览器：按分类分组的可折叠文件树（对标 Obsidian 文件资源管理器）。 */
export default function Explorer(): JSX.Element {
  const { state, openConversation, activate, rescan, reload } = useStore()
  const ordered = useMemo(() => selectOrderedCategories(state), [state.byCategory])
  const allCats = useMemo(() => selectAllCategories(state), [state.byCategory])

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>(loadSortKey)
  const [sortDir, setSortDir] = useState<SortDir>(loadSortDir)
  const [relocating, setRelocating] = useState(false)

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

  const handleRescan = async (): Promise<void> => {
    const summary = await rescan()
    if (!summary || summary.skipped === 0) return
    toast.info(`重新扫描完成：${summary.skipped} 个目录被跳过`, {
      description: summary.skippedItems
        .slice(0, TOAST_DETAIL_MAX)
        .map((s) => s.path)
        .join('\n')
    })
  }

  const relocateAll = async (): Promise<void> => {
    const confirmed = await window.api.ui.confirm({
      message: `把「${UNCATEGORIZED}」的 ${state.byCategory[UNCATEGORIZED] ?? 0} 个对话全部归位？`,
      detail: '每个对话将移入其 meta.json 记录的分类；未记录分类的移入「其他」。',
      confirmLabel: '全部归位'
    })
    if (!confirmed) return
    setRelocating(true)
    try {
      const r = await window.api.conv.relocateUncategorized()
      if (!r.ok) {
        toast.error(`归位失败：${r.message}`)
        return
      }
      const { moved, failed } = r.data
      toast.success(`已归位 ${moved} 个，失败 ${failed.length} 个`, {
        description: failed.length
          ? failed
              .slice(0, TOAST_DETAIL_MAX)
              .map((f) => `${f.title}：${f.message}`)
              .join('\n')
          : undefined
      })
      await reload()
    } catch (e) {
      toast.error(`归位失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRelocating(false)
    }
  }

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
        onRescan={() => void handleRescan()}
      />

      <ScrollArea className="flex-1">
        <div className="px-1.5 pb-3">
          {groups.map(({ cat, items }) => (
            <div key={cat} className="select-none">
              <div className="flex items-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground">
                <button
                  onClick={() => toggle(cat)}
                  aria-expanded={isOpen(cat)}
                  aria-label={`分类 ${cat}，${items.length} 个对话`}
                  className="group flex min-w-0 flex-1 items-center gap-1 rounded-md py-[5px] pl-1 pr-2 text-left text-[13px] font-medium text-sidebar-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                {cat === UNCATEGORIZED && (
                  <button
                    type="button"
                    onClick={() => void relocateAll()}
                    disabled={relocating}
                    title="把这些对话移入各自 meta.json 记录的分类"
                    className="mr-1 shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    {relocating ? '归位中…' : '全部归位'}
                  </button>
                )}
              </div>

              {/* grid-rows 0fr↔1fr 实现无需测量的高度过渡；子项常驻渲染以支持动画 */}
              <div
                className="grid transition-[grid-template-rows] duration-200 ease-glass"
                style={{ gridTemplateRows: isOpen(cat) ? '1fr' : '0fr' }}
                aria-hidden={!isOpen(cat)}
              >
                <div className="min-h-0 overflow-hidden">
                  {cat === UNCATEGORIZED && (
                    <p className="py-1 pl-6 pr-2 text-[11px] leading-snug text-muted-foreground">
                      这些对话位于库根第一层，不属于任何分类
                    </p>
                  )}
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

          {state.lastRescan && state.lastRescan.skipped > 0 && (
            <div
              className="px-2 pt-2 text-[11px] text-muted-foreground"
              title={state.lastRescan.skippedItems
                .slice(0, TITLE_DETAIL_MAX)
                .map((s) => `${s.path}（${s.reason}）`)
                .join('\n')}
            >
              {state.lastRescan.skipped} 个目录被跳过
            </div>
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
    <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border/40 px-2.5">
      <span className="flex-1 truncate text-[12px] font-semibold tracking-tight text-foreground/85">
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
