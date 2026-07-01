import { useState } from 'react'
import { Sun, Moon, Monitor, Info, type LucideIcon } from 'lucide-react'
import type { ThemeMode } from '@shared/api'
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

/**
 * 全宽玻璃标题带：贯通顶部 40px，避让 macOS 红绿灯 / Windows 控件并作为窗口拖拽区，
 * 居中显示软件应用名称；右侧放外观切换与关于按钮（no-drag，可点）。
 */
export default function TopBand(): JSX.Element {
  const { mode, toggle } = useTheme()
  const [aboutOpen, setAboutOpen] = useState(false)
  const ThemeIcon = THEME_ICON[mode]

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
          title={`外观：${THEME_LABEL[mode]}（点击切换）`}
          aria-label={`切换外观，当前${THEME_LABEL[mode]}`}
          onClick={toggle}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ThemeIcon className="size-4" />
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
