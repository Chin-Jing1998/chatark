import { useEffect, useMemo, useState } from 'react'
import {
  Sun,
  Moon,
  Monitor,
  Check,
  Layers,
  Palette,
  FolderCog,
  DownloadCloud,
  Zap,
  Info,
  type LucideIcon
} from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@renderer/components/ui/dialog'
import { useStore } from '@renderer/app/store'
import { useTheme } from '@renderer/lib/useTheme'
import { cn } from '@renderer/lib/cn'
import type { ThemeMode } from '@shared/api'
import { PRESETS, UI_SCHEMES, type Palette as ThemePalette } from '@shared/themes'
import PathMigrationPanel from './PathMigrationPanel'
import BackfillPanel from './BackfillPanel'
import AutoExportPanel from './AutoExportPanel'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  tab: string
}

const NAV_ITEMS: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: 'scheme', label: '四套界面方案', icon: Layers },
  { id: 'appearance', label: '外观与明暗', icon: Sun },
  { id: 'theme', label: '主题风格画廊', icon: Palette },
  { id: 'path', label: '保存路径与迁移', icon: FolderCog },
  { id: 'backfill', label: '历史会话补录', icon: DownloadCloud },
  { id: 'autoexport', label: 'Hook 自动导出', icon: Zap },
  { id: 'about', label: '关于 ChatArk', icon: Info }
]

/** 兼容旧入口（general/backfill…）→ 平铺分区锚点。 */
function normalize(tab: string): string {
  if (tab === 'general') return 'scheme'
  return ['scheme', 'appearance', 'theme', 'path', 'backfill', 'autoexport', 'about'].includes(tab)
    ? tab
    : 'scheme'
}

export default function SettingsDialog({ open, onOpenChange, tab }: Props): JSX.Element {
  const [activeNav, setActiveNav] = useState<string>(() => normalize(tab))

  // 打开时滚动到入口指定的分区
  useEffect(() => {
    if (!open) return
    const id = normalize(tab)
    setActiveNav(id)
    const h = requestAnimationFrame(() => {
      document.getElementById(`settings-${id}`)?.scrollIntoView({ block: 'start' })
    })
    return () => cancelAnimationFrame(h)
  }, [open, tab])

  const jumpTo = (id: string): void => {
    setActiveNav(id)
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden border-border/60 bg-popover/92 p-0 backdrop-blur-2xl">
        <DialogTitle className="shrink-0 border-b border-border/60 px-6 py-3 text-base font-semibold">
          工作台设置与主题中心
        </DialogTitle>
        <div className="grid max-h-[78vh] grid-cols-[196px_minmax(0,1fr)] overflow-hidden">
          {/* 左侧分区锚点导航栏 */}
          <nav
            aria-label="设置分区导航"
            className="flex flex-col gap-1 border-r border-border/60 bg-sidebar/50 p-3"
          >
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const active = activeNav === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => jumpTo(item.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active
                      ? 'bg-brand/15 font-semibold text-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  <Icon className={cn('size-4 shrink-0', active && 'text-brand')} />
                  <span className="truncate">{item.label}</span>
                </button>
              )
            })}
          </nav>

          {/* 右侧分区卡片内容区 */}
          <div className="space-y-4 overflow-y-auto px-6 py-5">
            <Card
              id="scheme"
              title="四套界面与主题方案（现状基线 + A / B / C 全保留）"
              desc="实时切换外壳布局骨架、侧栏条目样式、专属色板与 convo:// 对话阅读器排版。"
            >
              <SchemeGrid />
            </Card>
            <Card id="appearance" title="外观模式" desc="外壳与对话正文统一随明暗模式变化。">
              <ModeGrid />
            </Card>
            <Card
              id="theme"
              title="主题风格画廊（9 套双色板预设）"
              desc="切换后外壳强调色与对话正文整套配色同步变化（含已打开的对话）。"
            >
              <ThemeGallery />
            </Card>
            <Card id="path" title="保存路径与迁移">
              <PathMigrationPanel />
            </Card>
            <Card id="backfill" title="历史会话补录">
              <BackfillPanel />
            </Card>
            <Card id="autoexport" title="Hook 自动导出">
              <AutoExportPanel />
            </Card>
            <Card id="about" title="关于">
              <About />
            </Card>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SchemeGrid(): JSX.Element {
  const { scheme, setScheme } = useTheme()
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {UI_SCHEMES.map((s) => {
        const selected = scheme === s.id
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => setScheme(s.id)}
            aria-pressed={selected}
            className={cn(
              'flex flex-col justify-between gap-2 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected
                ? 'border-brand bg-brand/10 ring-1 ring-brand/35'
                : 'border-border hover:bg-accent/50'
            )}
          >
            <div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[12.5px] font-semibold text-foreground">{s.name}</span>
                {selected && <Check className="size-3.5 shrink-0 text-brand" />}
              </div>
              <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">{s.desc}</p>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function Card({
  id,
  title,
  desc,
  children
}: {
  id: string
  title: string
  desc?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <section
      id={`settings-${id}`}
      className="scroll-mt-2 rounded-xl border border-border/60 bg-card/40 p-4"
    >
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </section>
  )
}

/* ---------- 外观：明暗模式 ---------- */

const MODES: Array<{ key: ThemeMode; label: string; icon: typeof Sun }> = [
  { key: 'system', label: '跟随系统', icon: Monitor },
  { key: 'light', label: '亮色', icon: Sun },
  { key: 'dark', label: '暗色', icon: Moon }
]

function ModeGrid(): JSX.Element {
  const { mode, set } = useTheme()
  return (
    <div className="grid grid-cols-3 gap-2">
      {MODES.map((m) => (
        <button
          key={m.key}
          onClick={() => set(m.key)}
          aria-pressed={mode === m.key}
          className={cn(
            'flex flex-col items-center gap-2 rounded-lg border p-4 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            mode === m.key
              ? 'border-brand bg-brand/10 text-foreground'
              : 'border-border text-muted-foreground hover:bg-accent'
          )}
        >
          <m.icon className={cn('size-5', mode === m.key && 'text-brand')} />
          {m.label}
        </button>
      ))}
    </div>
  )
}

/* ---------- 主题风格：预设画廊 ---------- */

function ThemeGallery(): JSX.Element {
  const { mode, preset, setPreset } = useTheme()
  const isDark = useMemo(
    () =>
      mode === 'dark' ||
      (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches),
    [mode]
  )

  return (
    <div className="grid grid-cols-3 gap-3">
      {PRESETS.map((p) => {
        const pal = isDark ? p.dark : p.light
        const selected = preset === p.id
        return (
          <button
            key={p.id}
            onClick={() => setPreset(p.id)}
            aria-pressed={selected}
            className={cn(
              'group flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected ? 'border-brand ring-1 ring-brand/40' : 'border-border hover:bg-accent/50'
            )}
          >
            <ThemePreview pal={pal} />
            <div className="flex items-center justify-between gap-1">
              <span className="truncate text-[12px] font-medium">{p.name}</span>
              {selected && <Check className="size-3.5 shrink-0 text-brand" />}
            </div>
          </button>
        )
      })}
    </div>
  )
}

/** 预设缩略预览：底色 + 四色气泡样条 */
function ThemePreview({ pal }: { pal: ThemePalette }): JSX.Element {
  return (
    <div
      className="flex h-14 items-end gap-1.5 rounded-lg border p-2"
      style={{ background: pal.bg, borderColor: pal.line }}
    >
      <div className="flex-1 rounded-md p-1.5" style={{ background: pal.panel }}>
        <div className="flex gap-1">
          {[pal.accent, pal.user, pal.tool, pal.answer].map((c, i) => (
            <span key={i} className="h-2 w-2 rounded-full" style={{ background: c }} />
          ))}
        </div>
        <div className="mt-1 h-1.5 w-3/4 rounded-full" style={{ background: pal.line }} />
      </div>
    </div>
  )
}

/* ---------- 关于 ---------- */

function About(): JSX.Element {
  const { state } = useStore()
  return (
    <div className="space-y-2 text-sm">
      <div>
        共 <b>{state.total}</b> 个对话
      </div>
      <div className="break-all text-xs text-muted-foreground">库路径：{state.root}</div>
      <p className="pt-2 text-xs text-muted-foreground">
        ChatArk · 文件即数据，所见即磁盘 · 第三方独立工具，与 Anthropic 官方无关。
      </p>
    </div>
  )
}
