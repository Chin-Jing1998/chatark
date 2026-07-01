import { useEffect, useRef } from 'react'

interface Props {
  /** 左栏宽度回调（已换算为像素，Layout 负责限幅/持久化） */
  onWidth: (px: number) => void
  /** 最左图标栏宽度，用于把指针 X 换算成左栏宽度 */
  railWidth: number
  /** 双击复位的默认宽度 */
  defaultWidth: number
  /** 拖拽开始：Layout 据此关闭宽度缓动，保证 1:1 跟手 */
  onDragStart: () => void
  /** 拖拽结束：Layout 据此恢复缓动 */
  onDragEnd: () => void
}

/** 侧栏与主区之间的可拖拽分隔条：拖动改宽（无缓动跟手），双击复位（有缓动）。 */
export default function Resizer({
  onWidth,
  railWidth,
  defaultWidth,
  onDragStart,
  onDragEnd
}: Props): JSX.Element {
  const dragging = useRef(false)

  useEffect(() => {
    const move = (e: PointerEvent): void => {
      if (dragging.current) onWidth(e.clientX - railWidth)
    }
    const up = (): void => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.classList.remove('select-none')
      onDragEnd()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [onWidth, railWidth, onDragEnd])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="调整侧栏宽度"
      onPointerDown={(e) => {
        // 捕获指针：拖拽事件恒定投递到本元素（并冒泡到 window 监听），即使划过对话 iframe 也不断连
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* 某些环境不支持，靠 iframe pointer-events:none 兜底 */
        }
        dragging.current = true
        document.body.style.cursor = 'col-resize'
        document.body.classList.add('select-none')
        onDragStart()
      }}
      onDoubleClick={() => onWidth(defaultWidth)}
      className="group relative z-10 w-1 shrink-0 cursor-col-resize"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/70 transition-colors group-hover:bg-brand/60" />
    </div>
  )
}
