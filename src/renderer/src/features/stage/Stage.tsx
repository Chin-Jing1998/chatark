import { useEffect, useRef, useState, type KeyboardEvent, type DragEvent } from 'react'
import { Plus, X, FolderOpen } from 'lucide-react'
import { viewerUrl, fileViewerUrl, OPEN_FILE_MESSAGE } from '@shared/viewer'
import { cn } from '@renderer/lib/cn'
import { useStore } from '@renderer/app/store'

interface Props {
  /** 打开命令面板（快速切换 / 搜索 / 最近） */
  onOpenCommand: () => void
  /** 侧栏拖拽中：令对话 iframe 让出指针事件，避免拖拽跨到 iframe 上时断连抖动 */
  dragging?: boolean
}

/**
 * 主舞台：可拖拽标签条（满则等宽缩窄 + 可拖拽重排；所有 iframe 常驻仅切显隐）+ convo:// 原样展示。
 * 标签条实现 ARIA tablist 语义与键盘操作；无标签时呈 Obsidian 式紫色操作链接空状态。
 * 文件标签（kind==='file'）顶部附路径条（显示绝对路径 + 在文件夹中定位）。
 */
export default function Stage({ onOpenCommand, dragging = false }: Props): JSX.Element {
  const { state, activate, closeTab, reorderTab, openFile } = useStore()
  const hasTabs = state.tabs.length > 0
  const tabRefs = useRef(new Map<string, HTMLDivElement | null>())
  const dragId = useRef<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  // 切换/新开标签后，把当前标签滚入可见（标签多、横向溢出时仍能看到当前）
  useEffect(() => {
    if (state.activeId) {
      tabRefs.current.get(state.activeId)?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    }
  }, [state.activeId])

  // 接收对话 iframe 内“点击文件链接”的请求，在应用内新标签打开该文件。
  // 对话 HTML 属不可信外部内容（可能来自导入的第三方包），故对上抛路径做约束：
  // 必须为绝对路径，且拒绝密钥/凭证类敏感目录，避免被植入脚本诱导展示敏感文件。
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
      const n = e.key === 'ArrowRight' ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length
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
    <section className="flex h-full min-w-0 flex-1 flex-col bg-transparent">
      {hasTabs && (
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
        {!hasTabs && <EmptyState onOpenCommand={onOpenCommand} />}
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

const LINKS: Array<{ label: string; kbd: string }> = [
  { label: '打开对话', kbd: '⌘O' },
  { label: '全文搜索', kbd: '⌘K' },
  { label: '最近打开', kbd: '⌘R' }
]

function EmptyState({ onOpenCommand }: { onOpenCommand: () => void }): JSX.Element {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
      {LINKS.map((l) => (
        <button
          key={l.label}
          onClick={onOpenCommand}
          className="flex items-center gap-2 rounded px-2 py-1 text-[15px] text-brand transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span>{l.label}</span>
          <kbd className="rounded border border-border/70 px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {l.kbd}
          </kbd>
        </button>
      ))}
    </div>
  )
}
