import { cn } from '@renderer/lib/cn'
import type { RailView } from '@renderer/features/rail/IconRail'
import Explorer from '@renderer/features/explorer/Explorer'
import SearchPanel from '@renderer/features/search/SearchPanel'
import StarredPanel from '@renderer/features/starred/StarredPanel'
import TagsPanel from '@renderer/features/tags/TagsPanel'

interface Props {
  view: RailView
  /** 由 Layout 控制的可调宽度（像素） */
  width: number
  /** 是否给宽度变化加缓动（拖拽中关闭以保 1:1，双击复位时开启） */
  animate: boolean
}

/** 中间面板（玻璃侧栏）：仅活动视图（切换淡入）。顶部避让与外观/关于入口由 TopBand 统一承担。 */
export default function LeftPanel({ view, width, animate }: Props): JSX.Element {
  return (
    <aside
      aria-label="对话库侧栏"
      style={{ width }}
      className={cn(
        'flex shrink-0 flex-col border-r border-border/60 bg-sidebar/55 text-sidebar-foreground backdrop-blur-2xl',
        animate ? 'transition-[width] duration-200 ease-glass' : 'transition-none'
      )}
    >
      <div key={view} className="min-h-0 flex-1 animate-in fade-in-0 duration-200 ease-glass">
        {view === 'explorer' && <Explorer />}
        {view === 'search' && <SearchPanel active />}
        {view === 'starred' && <StarredPanel />}
        {view === 'tags' && <TagsPanel />}
      </div>
    </aside>
  )
}
