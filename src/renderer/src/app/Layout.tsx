import { useCallback, useEffect, useState } from 'react'
import IconRail, { type RailView } from '@renderer/features/rail/IconRail'
import LeftPanel from '@renderer/features/panel/LeftPanel'
import Resizer from '@renderer/features/panel/Resizer'
import Stage from '@renderer/features/stage/Stage'
import TopBand from '@renderer/features/shell/TopBand'
import CommandPalette from '@renderer/features/command/CommandPalette'
import SettingsDialog from '@renderer/features/settings/SettingsDialog'
import { useHookUpdateNotice } from '@renderer/features/settings/useHookUpdateNotice'

const RAIL_WIDTH = 48
const DEFAULT_LEFT = 240
const MIN_LEFT = 200
const MAX_LEFT = 520
// v2：默认宽度收窄（240），旧键的 270 值失效改用新默认；手动调过的用户重新拖即可
const WIDTH_KEY = 'chatark-left-width-v2'

function loadLeftWidth(): number {
  const v = Number(localStorage.getItem(WIDTH_KEY))
  return Number.isFinite(v) && v >= MIN_LEFT && v <= MAX_LEFT ? v : DEFAULT_LEFT
}

export default function Layout(): JSX.Element {
  const [view, setView] = useState<RailView>('explorer')
  const [cmdOpen, setCmdOpen] = useState(false)
  const [leftWidth, setLeftWidth] = useState<number>(loadLeftWidth)
  const [dragging, setDragging] = useState(false)
  const [settings, setSettings] = useState<{ open: boolean; tab: string }>({
    open: false,
    tab: 'general'
  })

  const openSettings = (tab = 'general'): void => setSettings({ open: true, tab })

  useHookUpdateNotice()

  const setWidth = useCallback((px: number) => {
    setLeftWidth(Math.min(MAX_LEFT, Math.max(MIN_LEFT, Math.round(px))))
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(leftWidth))
    } catch {
      /* 忽略持久化失败 */
    }
  }, [leftWidth])

  // ⌘O/⌘K/⌘R 由主进程菜单加速键承载并经 IPC 转发——在对话 iframe 聚焦时仍生效
  // （渲染层 window.keydown 收不到 iframe 内的按键，故不再自行监听，也避免与菜单加速键重复触发）。
  useEffect(() => {
    return window.api.onOpenCommand(() => setCmdOpen(true))
  }, [])

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-transparent text-foreground">
      <div className="flowlight" aria-hidden />
      <TopBand />
      <div className="relative z-10 flex min-h-0 flex-1">
        <IconRail view={view} onChangeView={setView} onOpenSettings={() => openSettings()} />
        <LeftPanel view={view} width={leftWidth} animate={!dragging} />
        <Resizer
          onWidth={setWidth}
          railWidth={RAIL_WIDTH}
          defaultWidth={DEFAULT_LEFT}
          onDragStart={() => setDragging(true)}
          onDragEnd={() => setDragging(false)}
        />
        <Stage onOpenCommand={() => setCmdOpen(true)} dragging={dragging} />
      </div>

      <CommandPalette
        open={cmdOpen}
        onOpenChange={setCmdOpen}
        onOpenSettings={(tab) => {
          setCmdOpen(false)
          openSettings(tab)
        }}
      />
      <SettingsDialog
        open={settings.open}
        onOpenChange={(open) => setSettings((s) => ({ ...s, open }))}
        tab={settings.tab}
      />
    </div>
  )
}
