import { cn } from '@renderer/lib/cn'
import { useTheme } from '@renderer/lib/useTheme'
import { VIEWS, type RailView } from '@renderer/features/rail/IconRail'
import Explorer from '@renderer/features/explorer/Explorer'
import SearchPanel from '@renderer/features/search/SearchPanel'
import StarredPanel from '@renderer/features/starred/StarredPanel'
import TagsPanel from '@renderer/features/tags/TagsPanel'
import ProjectsPanel from '@renderer/features/projects/ProjectsPanel'

interface Props {
  view: RailView
  onChangeView: (v: RailView) => void
  /** 由 Layout 控制的可调宽度（像素） */
  width: number
  /** 是否给宽度变化加缓动（拖拽中关闭以保 1:1，双击复位时开启） */
  animate: boolean
}

/**
 * 对话库侧栏：
 * - 方案 A（m3e）：内嵌圆角色调容器侧栏；
 * - 方案 B（archive）：顶部内嵌五视图分段切换条 + 紧凑高对比度档案索引侧栏；
 * - 方案 C（glass）：悬浮分层液态玻璃侧栏（带 1px 顶部内高光）。
 */
export default function LeftPanel({ view, onChangeView, width, animate }: Props): JSX.Element {
  const { scheme } = useTheme()

  return (
    <aside
      aria-label="对话库侧栏"
      style={{ width }}
      className={cn(
        'flex shrink-0 flex-col overflow-hidden text-sidebar-foreground',
        scheme === 'classic' &&
          'border-r border-border/60 bg-sidebar/55 backdrop-blur-2xl',
        scheme === 'm3e' &&
          'my-2 ml-1 rounded-[var(--panel-concentric-radius)] border border-border/70 bg-sidebar/80 backdrop-blur-xl',
        scheme === 'archive' && 'border-r border-border bg-sidebar/95',
        scheme === 'glass' &&
          'glass-specular my-2 ml-2 rounded-[var(--panel-concentric-radius)] border border-border/70 bg-sidebar/60 backdrop-blur-2xl',
        animate ? 'transition-[width] duration-200 ease-glass' : 'transition-none'
      )}
    >
      {scheme === 'archive' && (
        <nav
          aria-label="五视图切换"
          className="grid shrink-0 grid-cols-5 gap-0.5 border-b border-border bg-background/50 p-1.5"
        >
          {VIEWS.map((v) => {
            const active = view === v.key
            return (
              <button
                key={v.key}
                type="button"
                aria-pressed={active}
                onClick={() => onChangeView(v.key)}
                className={cn(
                  'h-[26px] rounded-[7px] text-center text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-foreground text-background shadow-2xs'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                {v.shortLabel}
              </button>
            )
          })}
        </nav>
      )}

      <div key={view} className="min-h-0 flex-1 animate-in fade-in-0 duration-200 ease-glass">
        {view === 'explorer' && <Explorer />}
        {view === 'search' && <SearchPanel active />}
        {view === 'starred' && <StarredPanel />}
        {view === 'tags' && <TagsPanel />}
        {view === 'projects' && <ProjectsPanel />}
      </div>
    </aside>
  )
}
