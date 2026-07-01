// 通知组件：封装 sonner 的 Toaster，主题跟随根节点 .dark 类并实时响应切换。
import * as React from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

/** 读取当前根节点是否为暗色，并在 .dark 类变化时同步更新。 */
function useDarkClass(): boolean {
  const [isDark, setIsDark] = React.useState<boolean>(() =>
    typeof document !== 'undefined'
      ? document.documentElement.classList.contains('dark')
      : false
  )

  React.useEffect(() => {
    const root = document.documentElement
    const sync = (): void => setIsDark(root.classList.contains('dark'))
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return isDark
}

function Toaster({ ...props }: ToasterProps): React.JSX.Element {
  const theme: ToasterProps['theme'] = useDarkClass() ? 'dark' : 'light'

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground'
        }
      }}
      {...props}
    />
  )
}

export { Toaster }
