import { Files, Search, Star, Tags, FolderGit2, Settings, type LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useTheme } from '@renderer/lib/useTheme'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'

/** 左侧活动栏可切换的五个视图。 */
export type RailView = 'explorer' | 'search' | 'starred' | 'tags' | 'projects'

export const VIEWS: Array<{ key: RailView; label: string; shortLabel: string; icon: LucideIcon }> = [
  { key: 'explorer', label: '对话浏览器', shortLabel: '浏览', icon: Files },
  { key: 'search', label: '全文搜索', shortLabel: '搜索', icon: Search },
  { key: 'starred', label: '收藏 / 置顶', shortLabel: '收藏', icon: Star },
  { key: 'tags', label: '标签 / 分类', shortLabel: '标签', icon: Tags },
  { key: 'projects', label: '按项目', shortLabel: '项目', icon: FolderGit2 }
]

interface Props {
  view: RailView
  onChangeView: (v: RailView) => void
  onOpenSettings: () => void
}

/**
 * 最左侧活动栏：
 * - 方案 A（m3e）：56px M3E 胶囊导航栏（胶囊选中底 + 短中文标签）；
 * - 方案 C（glass）：悬浮磨砂胶囊岛（带 1px 顶部内高光）；
 * - 方案 B（archive）：由 LeftPanel 顶部内嵌五视图分段栏接管，本组件不渲染。
 */
export default function IconRail({ view, onChangeView, onOpenSettings }: Props): JSX.Element {
  const { scheme } = useTheme()
  const isClassic = scheme === 'classic'
  const isM3e = scheme === 'm3e'
  const isGlass = scheme === 'glass'

  return (
    <TooltipProvider delayDuration={300}>
      <nav
        aria-label="主视图导航"
        className={cn(
          'flex shrink-0 flex-col items-center transition-all',
          isClassic && 'w-12 border-r border-border/60 bg-rail/50 pt-1 backdrop-blur-2xl',
          isM3e && 'w-14 bg-transparent py-2 pl-1.5',
          isGlass &&
            'glass-specular my-2 ml-2 w-12 rounded-[var(--panel-concentric-radius)] border border-border/70 bg-rail/65 py-2 backdrop-blur-2xl'
        )}
      >
        <div className="flex flex-1 flex-col items-center gap-1.5 pb-1 pt-1">
          {VIEWS.map((v) => (
            <RailButton
              key={v.key}
              label={v.label}
              shortLabel={v.shortLabel}
              icon={v.icon}
              active={view === v.key}
              showShortLabel={isM3e}
              classicIndicator={isClassic}
              isToggle
              onClick={() => onChangeView(v.key)}
            />
          ))}
        </div>

        <div className="flex flex-col items-center gap-1 pb-2">
          <RailButton
            label="设置"
            shortLabel="设置"
            icon={Settings}
            active={false}
            showShortLabel={isM3e}
            classicIndicator={isClassic}
            isToggle={false}
            onClick={onOpenSettings}
          />
        </div>
      </nav>
    </TooltipProvider>
  )
}

function RailButton({
  label,
  shortLabel,
  icon: Icon,
  active,
  showShortLabel,
  classicIndicator,
  isToggle,
  onClick
}: {
  label: string
  shortLabel: string
  icon: LucideIcon
  active: boolean
  showShortLabel: boolean
  classicIndicator?: boolean
  /** 视图切换按钮才是 toggle（暴露 aria-pressed）；设置等动作按钮不是 */
  isToggle: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={isToggle ? active : undefined}
          onClick={onClick}
          className={cn(
            'relative flex flex-col items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            showShortLabel
              ? 'w-12 gap-0.5 rounded-xl py-1.5 text-[11px] font-semibold'
              : classicIndicator
                ? 'size-9 rounded-md'
                : 'size-9 rounded-xl',
            active
              ? classicIndicator
                ? 'text-brand'
                : showShortLabel
                ? 'text-foreground'
                : 'bg-brand text-brand-foreground shadow-xs'
              : 'text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground'
          )}
        >
          {classicIndicator && active && (
            <span className="absolute left-1 h-5 w-[3px] rounded-full bg-brand" aria-hidden />
          )}
          <span
            className={cn(
              'flex items-center justify-center transition-colors',
              showShortLabel && 'h-6 w-10 rounded-full',
              showShortLabel && active && 'bg-brand/18 text-brand'
            )}
          >
            <Icon className="size-[17px]" />
          </span>
          {showShortLabel && <span className="leading-tight">{shortLabel}</span>}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}
