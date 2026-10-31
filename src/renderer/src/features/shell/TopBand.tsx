import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import {
  Sun,
  Moon,
  Monitor,
  Info,
  Plus,
  X,
  Search,
  Settings,
  Layers,
  type LucideIcon
} from 'lucide-react'
import type { ThemeMode } from '@shared/api'
import { PRESETS, UI_SCHEMES } from '@shared/themes'
import { cn } from '@renderer/lib/cn'
import { useStore } from '@renderer/app/store'
import { useTheme } from '@renderer/lib/useTheme'
import AboutDialog from './AboutDialog'

const THEME_ICON: Record<ThemeMode, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon
}
const THEME_LABEL: Record<ThemeMode, string> = {
  system: '跟随系统',
  light: '亮色',
  dark: '暗色'
}

interface Props {
  /** 左侧导航+侧栏合宽（像素），用于使顶栏左区与下方侧栏分界线精准对齐 */
  leftSpanWidth: number
  onOpenCommand: () => void
  onOpenSettings: (tab?: string) => void
}

/**
 * 一体式顶部状态与标签带（42px）：
 * - 左区（与侧栏分界对齐）：避让 macOS 红绿灯后展示 ChatArk 标识与会话库规模计数；
 * - 右区（与主舞台对齐）：合流打开的会话标签页、全局检索触发器、A/B/C 方案切换、6 预设色点与外观/设置入口。
 */
export default function TopBand({
  leftSpanWidth,
  onOpenCommand,
  onOpenSettings
}: Props): JSX.Element {
  const { state, activate, closeTab, reorderTab } = useStore()
  const { mode, toggle, preset, setPreset, scheme, cycleScheme } = useTheme()
  const [aboutOpen, setAboutOpen] = useState(false)
  const ThemeIcon = THEME_ICON[mode]
  const currentScheme = UI_SCHEMES.find((s) => s.id === scheme) ?? UI_SCHEMES[0]

  const tabRefs = useRef(new Map<string, HTMLDivElement | null>())
  const dragId = useRef<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  useEffect(() => {
    if (state.activeId) {
      tabRefs.current.get(state.activeId)?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    }
  }, [state.activeId])

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

  // 现状基线（classic）：保留经典 40px 居中标题栏（舞台标签栏由 Stage 独立承载）
  if (scheme === 'classic') {
    return (
      <div
        className="relative z-20 flex h-10 shrink-0 items-center justify-center border-b border-border/60 bg-background/25 backdrop-blur-2xl"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="pointer-events-none select-none text-[13px] font-semibold tracking-wide text-muted-foreground/85">
          ChatArk
        </span>

        <div
          className="absolute right-2 flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            type="button"
            title={`当前方案：${currentScheme.name}（点击循环切换四套方案）`}
            onClick={cycleScheme}
            className="flex h-7 items-center gap-1 rounded-md border border-border/70 bg-background/70 px-2 text-[12px] font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Layers className="size-3.5 text-brand" />
            <span>{currentScheme.shortName}</span>
          </button>
          <button
            type="button"
            title={`外观：${THEME_LABEL[mode]}（点击切换）`}
            aria-label={`切换外观，当前${THEME_LABEL[mode]}`}
            onClick={toggle}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ThemeIcon className="size-4" />
          </button>
          <button
            type="button"
            title="设置"
            aria-label="打开设置"
            onClick={() => onOpenSettings('scheme')}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Settings className="size-4" />
          </button>
          <button
            type="button"
            title="关于"
            aria-label="关于"
            onClick={() => setAboutOpen(true)}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Info className="size-4" />
          </button>
        </div>

        <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative z-20 flex h-[42px] shrink-0 items-stretch border-b transition-colors',
        scheme === 'archive'
          ? 'border-border bg-sidebar/95'
          : scheme === 'glass'
            ? 'border-border/60 bg-background/40 backdrop-blur-2xl'
            : 'border-border/60 bg-sidebar/70 backdrop-blur-xl'
      )}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* 左区：与下方侧栏右边界对齐，预留 76px 避让 macOS 红绿灯 */}
      <div
        style={{ width: leftSpanWidth }}
        className={cn(
          'flex shrink-0 items-center justify-between gap-2 pl-[76px] pr-3',
          scheme === 'archive' ? 'border-r border-border' : 'border-r border-border/50'
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="pointer-events-none select-none truncate text-[13px] font-bold tracking-tight text-foreground">
            ChatArk
          </span>
          <span
            className={cn(
              'pointer-events-none shrink-0 select-none px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
              scheme === 'archive'
                ? 'rounded border border-border bg-background text-muted-foreground'
                : 'rounded-full bg-brand/12 text-brand'
            )}
            style={scheme === 'archive' ? { fontFamily: 'var(--font-mono)' } : undefined}
          >
            {state.total}
          </span>
        </div>
      </div>

      {/* 右区：合流舞台标签页 + 一体化状态控制簇 */}
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2.5">
        <div
          role="tablist"
          aria-label="打开的对话"
          className="no-hscroll flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1"
        >
          {state.tabs.map((t, i) => {
            const isActive = state.activeId === t.id
            const codeLabel =
              t.kind === 'file' ? 'FILE' : String(i + 1).padStart(2, '0')
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
                  'group flex h-[28px] max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 px-2.5 text-[12.5px] outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring',
                  scheme === 'm3e' &&
                    (isActive
                      ? 'min-w-[120px] rounded-full bg-brand/15 font-semibold text-foreground ring-1 ring-brand/30'
                      : 'min-w-[80px] rounded-full text-muted-foreground hover:bg-accent/70 hover:text-foreground'),
                  scheme === 'archive' &&
                    (isActive
                      ? 'min-w-[120px] rounded-[8px] border border-border bg-card font-semibold text-foreground shadow-2xs'
                      : 'min-w-[80px] rounded-[8px] border border-transparent text-muted-foreground hover:bg-background/80 hover:text-foreground'),
                  scheme === 'glass' &&
                    (isActive
                      ? 'glass-specular min-w-[120px] rounded-lg border border-border/80 bg-card/90 font-semibold text-foreground'
                      : 'min-w-[80px] rounded-lg text-muted-foreground hover:bg-card/50 hover:text-foreground'),
                  overId === t.id &&
                    dragId.current &&
                    dragId.current !== t.id &&
                    'shadow-[inset_2px_0_0_0_hsl(var(--brand))]'
                )}
              >
                {scheme === 'archive' && (
                  <span
                    className="shrink-0 text-[11px] font-bold text-brand"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {codeLabel}
                  </span>
                )}
                <span className="flex-1 truncate">{t.title}</span>
                <button
                  title="关闭"
                  aria-label={`关闭 ${t.title}`}
                  tabIndex={-1}
                  className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:bg-muted-foreground/20 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(t.id)
                  }}
                >
                  <X className="size-3" />
                </button>
              </div>
            )
          })}
          <button
            type="button"
            title="打开对话 (⌘O)"
            aria-label="打开对话"
            onClick={onOpenCommand}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-3.5" />
          </button>
        </div>

        {/* 右侧一体化工具簇（no-drag，等高 28px 协调排布） */}
        <div
          className="flex shrink-0 items-center gap-1.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* 方案 C 显示 6 预设快速切换色点 */}
          {scheme === 'glass' && (
            <div className="mr-1 hidden items-center gap-1 sm:flex" role="group" aria-label="快速切换主题色板">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={`色板：${p.name}`}
                  aria-label={`切换色板至 ${p.name}`}
                  onClick={() => setPreset(p.id)}
                  className={cn(
                    'size-3.5 rounded-full border border-white/70 transition-transform hover:scale-110',
                    preset === p.id && 'ring-2 ring-brand ring-offset-1 ring-offset-background'
                  )}
                  style={{ background: p.flow[0] }}
                />
              ))}
            </div>
          )}

          <div
            className={cn(
              'flex h-[28px] items-center overflow-hidden border text-[12px]',
              scheme === 'm3e'
                ? 'rounded-full border-border/70 bg-background/85 px-1'
                : scheme === 'archive'
                  ? 'rounded-[8px] border-border bg-card'
                  : 'glass-specular rounded-lg border-border/70 bg-card/75'
            )}
          >
            <button
              type="button"
              title="全局检索与命令面板 (⌘K)"
              onClick={onOpenCommand}
              className="flex h-full items-center gap-1.5 border-r border-border/60 px-2.5 text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
            >
              <Search className="size-3.5" />
              <span className="hidden md:inline">检索</span>
              <kbd
                className="text-[11px] font-semibold text-brand"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                ⌘K
              </kbd>
            </button>

            <button
              type="button"
              title={`当前界面方案：${currentScheme.name}（点击循环切换 A/B/C）`}
              onClick={cycleScheme}
              className="flex h-full items-center gap-1 border-r border-border/60 px-2.5 font-medium text-foreground transition-colors hover:bg-accent/70"
            >
              <Layers className="size-3.5 text-brand" />
              <span>{currentScheme.shortName}</span>
            </button>

            <button
              type="button"
              title={`外观：${THEME_LABEL[mode]}（点击切换）`}
              aria-label={`切换外观，当前${THEME_LABEL[mode]}`}
              onClick={toggle}
              className="flex h-full w-7 items-center justify-center border-r border-border/60 text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
            >
              <ThemeIcon className="size-3.5" />
            </button>

            <button
              type="button"
              title="打开设置"
              aria-label="打开设置"
              onClick={() => onOpenSettings('appearance')}
              className="flex h-full w-7 items-center justify-center border-r border-border/60 text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
            >
              <Settings className="size-3.5" />
            </button>

            <button
              type="button"
              title="关于 ChatArk"
              aria-label="关于"
              onClick={() => setAboutOpen(true)}
              className="flex h-full w-7 items-center justify-center text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
            >
              <Info className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </div>
  )
}
