import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import {
  Plus,
  X,
  FolderOpen,
  Search,
  DownloadCloud,
  Palette,
  Sparkles,
  Star,
  Pin,
  Clock
} from 'lucide-react'
import { viewerUrl, fileViewerUrl, OPEN_FILE_MESSAGE } from '@shared/viewer'
import { UI_SCHEMES } from '@shared/themes'
import { cn } from '@renderer/lib/cn'
import { formatDateTime } from '@renderer/lib/format'
import { useStore } from '@renderer/app/store'
import { useTheme } from '@renderer/lib/useTheme'

interface Props {
  /** 打开命令面板（快速切换 / 搜索 / 最近） */
  onOpenCommand: () => void
  /** 打开设置弹窗（可指定初始分区） */
  onOpenSettings?: (tab?: string) => void
  /** 侧栏拖拽中：令对话 iframe 让出指针事件，避免拖拽跨到 iframe 上时断连抖动 */
  dragging?: boolean
}

/**
 * 主舞台：标签条已合流至顶部一体式 TopBand（释放 40px 垂直阅读空间）。
 * 支持 A（M3E 色调容器）、B（档案检索台）、C（液态玻璃）三套容器骨架切换；
 * 无标签时呈现包含库规模统计、A/B/C 方案切换与最近会话直达的工作台仪表盘。
 * 文件标签（kind==='file'）顶部附路径条（显示绝对路径 + 在文件夹中定位）。
 */
export default function Stage({
  onOpenCommand,
  onOpenSettings,
  dragging = false
}: Props): JSX.Element {
  const { state, activate, closeTab, reorderTab, openFile } = useStore()
  const { scheme } = useTheme()
  const hasTabs = state.tabs.length > 0
  const tabRefs = useRef(new Map<string, HTMLDivElement | null>())
  const dragId = useRef<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  useEffect(() => {
    if (scheme === 'classic' && state.activeId) {
      tabRefs.current.get(state.activeId)?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    }
  }, [scheme, state.activeId])

  // 接收对话 iframe 内“点击文件链接”的请求，在应用内新标签打开该文件。
  // 对话 HTML 属不可信外部内容（可能来自导入的第三方包）。
  //
  // 注意：下面的校验**不是安全防线**——渲染层的任何检查都可能被绕过。真正的防线在主进程：
  // convo://open-file 的 handler 会 realpath 后强制校验路径落在库根或某个对话 cwd 之内
  // （见 src/main/protocol/handler.ts）。此处只做快速失败，避免为注定 403 的路径白开一个标签。
  useEffect(() => {
    const SENSITIVE = [
      /[/\\]\.ssh[/\\]/i,
      /[/\\]\.aws[/\\]/i,
      /[/\\]\.gnupg[/\\]/i,
      /[/\\]\.config[/\\]gcloud[/\\]/i,
      /[/\\]Keychains?[/\\]/i
    ]
    const onMsg = (e: MessageEvent): void => {
      const d = e.data as { type?: string; path?: string } | null
      if (!d || d.type !== OPEN_FILE_MESSAGE || typeof d.path !== 'string' || !d.path) return
      const p = d.path
      if (!p.startsWith('/') && !/^[A-Za-z]:[/\\]/.test(p)) return // 必须绝对路径
      if (SENSITIVE.some((re) => re.test(p))) return // 拒绝敏感目录
      openFile(p)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [openFile])

  const focusTab = (id: string): void => {
    requestAnimationFrame(() => tabRefs.current.get(id)?.focus())
  }

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>, index: number, id: string): void => {
    const { tabs } = state
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      activate(id)
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const n =
        e.key === 'ArrowRight' ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length
      const nextId = tabs[n].id
      activate(nextId)
      focusTab(nextId)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      const neighbor = tabs[index + 1]?.id ?? tabs[index - 1]?.id
      closeTab(id)
      if (neighbor) focusTab(neighbor)
    }
  }

  const onDrop = (e: DragEvent, toId: string): void => {
    e.preventDefault()
    const from = dragId.current
    if (from && from !== toId) reorderTab(from, toId)
    dragId.current = null
    setOverId(null)
  }

  return (
    <section
      className={cn(
        'flex min-w-0 flex-1 flex-col overflow-hidden transition-all',
        scheme === 'classic' && 'h-full bg-transparent',
        scheme === 'm3e' &&
          'my-2 mr-2 rounded-[var(--panel-concentric-radius)] border border-border/70 bg-background shadow-xs',
        scheme === 'archive' && 'bg-background',
        scheme === 'glass' &&
          'glass-specular my-2 mr-2 rounded-[var(--panel-concentric-radius)] border border-border/70 bg-background/70 backdrop-blur-2xl'
      )}
    >
      {/* 现状基线（classic）：保留 Stage 独立 40px 标签栏 */}
      {scheme === 'classic' && hasTabs && (
        <div
          role="tablist"
          aria-label="打开的对话"
          className="no-hscroll flex h-10 shrink-0 items-end gap-1 overflow-x-auto border-b border-border/60 px-2"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          {state.tabs.map((t, i) => {
            const isActive = state.activeId === t.id
            return (
              <div
                key={t.id}
                ref={(el) => tabRefs.current.set(t.id, el)}
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                draggable
                onClick={() => activate(t.id)}
                onKeyDown={(e) => onTabKey(e, i, t.id)}
                onDragStart={(e) => {
                  dragId.current = t.id
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (overId !== t.id) setOverId(t.id)
                }}
                onDrop={(e) => onDrop(e, t.id)}
                onDragEnd={() => {
                  dragId.current = null
                  setOverId(null)
                }}
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                className={cn(
                  'group flex max-w-[220px] flex-1 cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'min-w-[130px] border-border/70 border-t-2 border-t-brand bg-background font-medium text-foreground'
                    : 'min-w-[72px] border-transparent text-muted-foreground hover:bg-accent/60',
                  overId === t.id &&
                    dragId.current &&
                    dragId.current !== t.id &&
                    'shadow-[inset_2px_0_0_0_hsl(var(--brand))]'
                )}
              >
                <span className="flex-1 truncate">{t.title}</span>
                <button
                  title="关闭"
                  aria-label={`关闭 ${t.title}`}
                  tabIndex={-1}
                  className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted-foreground/20 group-hover:opacity-100 group-focus-within:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(t.id)
                  }}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )
          })}
          <button
            title="打开对话"
            aria-label="打开对话"
            onClick={onOpenCommand}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="ml-0.5 flex size-6 shrink-0 items-center justify-center self-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-4" />
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {!hasTabs && (
          <EmptyState onOpenCommand={onOpenCommand} onOpenSettings={onOpenSettings} />
        )}
        {state.tabs.map((t) => {
          const isFile = t.kind === 'file' && !!t.path
          return (
            <div
              key={t.id}
              className="absolute inset-0 flex flex-col"
              hidden={state.activeId !== t.id}
            >
              {isFile && <FilePathBar path={t.path!} />}
              <iframe
                className="conv-frame min-h-0 flex-1 border-0"
                style={{
                  background: 'var(--conv-bg, hsl(var(--background)))',
                  // 拖拽侧栏时让出指针事件，使 pointermove 穿透回父窗口（否则被 iframe 吞掉→抖动）
                  pointerEvents: dragging ? 'none' : undefined
                }}
                src={isFile ? fileViewerUrl(t.path!) : viewerUrl(t.id)}
                sandbox="allow-scripts"
                title={t.title}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** 文件标签顶部路径条：显示绝对路径，点击（或按钮）在系统文件管理器中定位。 */
function FilePathBar({ path }: { path: string }): JSX.Element {
  const reveal = (): void => void window.api.file.reveal(path)
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/60 bg-background/60 px-3 text-[12px] backdrop-blur">
      <button
        type="button"
        onClick={reveal}
        title={`在文件夹中显示：${path}`}
        className="min-w-0 flex-1 truncate text-left text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {path}
      </button>
      <button
        type="button"
        onClick={reveal}
        title="在文件夹中显示"
        aria-label="在文件夹中显示"
        className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FolderOpen className="size-3.5" />
      </button>
    </div>
  )
}

function EmptyState({
  onOpenCommand,
  onOpenSettings
}: {
  onOpenCommand: () => void
  onOpenSettings?: (tab?: string) => void
}): JSX.Element {
  const { state, openConversation } = useStore()
  const { scheme, setScheme } = useTheme()

  const categoryCount = useMemo(() => Object.keys(state.byCategory).length, [state.byCategory])
  const starredCount = useMemo(
    () => state.summaries.filter((s) => s.org.pinned || s.org.favorite).length,
    [state.summaries]
  )

  const recentItems = useMemo(() => {
    const byId = new Map(state.summaries.map((s) => [s.id, s]))
    const picked = state.recentIds
      .map((id) => byId.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
    if (picked.length >= 6) return picked.slice(0, 6)
    const seen = new Set(picked.map((s) => s.id))
    for (const s of state.summaries) {
      if (picked.length >= 6) break
      if (!seen.has(s.id)) {
        picked.push(s)
        seen.add(s.id)
      }
    }
    return picked
  }, [state.recentIds, state.summaries])

  return (
    <div className="absolute inset-0 overflow-y-auto px-7 py-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        {/* 顶部欢迎与快捷检索横幅 */}
        <div
          className={cn(
            'flex flex-wrap items-center justify-between gap-4 border p-5',
            scheme === 'm3e' && 'rounded-2xl border-brand/25 bg-brand/8',
            scheme === 'archive' && 'rounded-xl border-border bg-card',
            scheme === 'glass' && 'glass-specular rounded-2xl border-border/70 bg-card/75'
          )}
        >
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-bold tracking-tight text-foreground">
              ChatArk 本地对话归档与检索工作台
            </h2>
            <p className="mt-1 truncate text-[13px] text-muted-foreground">
              库路径：{state.root || '加载中…'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpenCommand}
              className={cn(
                'inline-flex h-9 items-center gap-2 px-3.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                scheme === 'archive'
                  ? 'rounded-[6px] bg-foreground text-background hover:opacity-90'
                  : 'rounded-full bg-brand text-brand-foreground hover:opacity-90'
              )}
            >
              <Search className="size-3.5" />
              <span>快速检索 / 命令</span>
              <kbd className="rounded bg-black/15 px-1.5 py-0.5 text-[11px]">⌘K</kbd>
            </button>
            {onOpenSettings && (
              <>
                <button
                  type="button"
                  onClick={() => onOpenSettings('backfill')}
                  className={cn(
                    'inline-flex h-9 items-center gap-1.5 border border-border px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-accent',
                    scheme === 'archive' ? 'rounded-[6px]' : 'rounded-full'
                  )}
                >
                  <DownloadCloud className="size-3.5 text-brand" />
                  <span>补录会话</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenSettings('theme')}
                  className={cn(
                    'inline-flex h-9 items-center gap-1.5 border border-border px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-accent',
                    scheme === 'archive' ? 'rounded-[6px]' : 'rounded-full'
                  )}
                >
                  <Palette className="size-3.5 text-brand" />
                  <span>主题与方案</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* 库规模 KPI 指标卡 */}
        <div className="grid grid-cols-3 gap-3.5">
          <div
            className={cn(
              'border border-border/70 bg-card/65 p-4',
              scheme === 'archive' ? 'rounded-xl' : 'rounded-2xl'
            )}
          >
            <div className="text-[22px] font-bold tabular-nums text-brand">{state.total}</div>
            <div className="mt-0.5 text-[13px] font-semibold text-foreground">已归档本地会话</div>
            <div className="mt-1 text-[12px] text-muted-foreground">
              跨越 {categoryCount} 个分类目录 · FTS5 全文索引就绪
            </div>
          </div>
          <div
            className={cn(
              'border border-border/70 bg-card/65 p-4',
              scheme === 'archive' ? 'rounded-xl' : 'rounded-2xl'
            )}
          >
            <div className="text-[22px] font-bold tabular-nums text-brand">{starredCount}</div>
            <div className="mt-0.5 text-[13px] font-semibold text-foreground">置顶与收藏要案</div>
            <div className="mt-1 text-[12px] text-muted-foreground">
              核心架构方案与高频查阅记录一键直达
            </div>
          </div>
          <div
            className={cn(
              'border border-border/70 bg-card/65 p-4',
              scheme === 'archive' ? 'rounded-xl' : 'rounded-2xl'
            )}
          >
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
              <Sparkles className="size-4 text-brand" />
              <span>四套界面方案（基线 + A / B / C）</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {UI_SCHEMES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={scheme === s.id}
                  onClick={() => setScheme(s.id)}
                  className={cn(
                    'rounded-md border px-2 py-1.5 text-center text-[11.5px] font-semibold transition-colors',
                    scheme === s.id
                      ? 'border-brand bg-brand/15 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  {s.shortName}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 最近打开 / 最新归档会话直达 */}
        {recentItems.length > 0 && (
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                <Clock className="size-3.5 text-brand" />
                <span>最近阅读与最新归档</span>
              </span>
              <button
                type="button"
                onClick={onOpenCommand}
                className="text-[12px] text-brand hover:underline"
              >
                查看全部 ({state.total}) →
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {recentItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openConversation(item.id, item.title)}
                  className={cn(
                    'flex flex-col gap-1 border border-border/70 bg-card/65 p-3.5 text-left transition-colors hover:border-brand/50 hover:bg-accent/50',
                    scheme === 'archive' ? 'rounded-[6px]' : 'rounded-xl'
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {item.org.pinned && <Pin className="size-3 shrink-0 text-brand" />}
                    {item.org.favorite && (
                      <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
                      {item.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11.5px] tabular-nums text-muted-foreground">
                    <span>{item.category}</span>
                    <span>·</span>
                    <span>{formatDateTime(item.startedAt)}</span>
                    <span className="ml-auto">{item.messageCount} 条</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
