import { Files, Search, Star, Tags, FolderGit2, Settings, type LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'

/** 左侧活动栏可切换的五个视图。 */
export type RailView = 'explorer' | 'search' | 'starred' | 'tags' | 'projects'

const VIEWS: Array<{ key: RailView; label: string; icon: LucideIcon }> = [
  { key: 'explorer', label: '对话浏览器', icon: Files },
  { key: 'search', label: '全文搜索', icon: Search },
  { key: 'starred', label: '收藏 / 置顶', icon: Star },
  { key: 'tags', label: '标签 / 分类', icon: Tags },
  { key: 'projects', label: '按项目', icon: FolderGit2 }
]

interface Props {
  view: RailView
  onChangeView: (v: RailView) => void
  onOpenSettings: () => void
}

/**
 * 最左侧窄图标栏（对标 Obsidian 的 ribbon）：切换左面板视图 + 底部设置。
 * 顶部预留 40px 可拖拽留白，避让 macOS 红绿灯 / Windows 窗口控件叠层。
 */
export default function IconRail({ view, onChangeView, onOpenSettings }: Props): JSX.Element {
  return (
    <TooltipProvider delayDuration={300}>
      <nav className="flex w-12 shrink-0 flex-col items-center border-r border-border/60 bg-rail/50 backdrop-blur-2xl">
        <div className="flex flex-1 flex-col items-center gap-1 pb-1 pt-2">
          {VIEWS.map((v) => (
            <RailButton
              key={v.key}
              label={v.label}
              icon={v.icon}
              active={view === v.key}
              isToggle
              onClick={() => onChangeView(v.key)}
            />
          ))}
        </div>

        <div className="flex flex-col items-center gap-1 pb-2">
          <RailButton label="设置" icon={Settings} active={false} isToggle={false} onClick={onOpenSettings} />
        </div>
      </nav>
    </TooltipProvider>
  )
}

function RailButton({
  label,
  icon: Icon,
  active,
  isToggle,
  onClick
}: {
  label: string
  icon: LucideIcon
  active: boolean
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
            'relative flex size-9 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            active
              ? 'text-brand'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          )}
        >
          {active && (
            <span className="absolute left-1 h-5 w-[3px] rounded-full bg-brand" aria-hidden />
          )}
          <Icon className="size-[18px]" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}
