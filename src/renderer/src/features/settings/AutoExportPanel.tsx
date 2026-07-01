import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { HookStatus } from '@shared/types'
import { Switch } from '@renderer/components/ui/switch'

export default function AutoExportPanel(): JSX.Element {
  const [hook, setHook] = useState<HookStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.api.hook.status().then(setHook)
  }, [])

  const toggle = async (): Promise<void> => {
    if (!hook || busy) return
    setBusy(true)
    const r = hook.installed
      ? await window.api.hook.uninstall()
      : await window.api.hook.install(hook.pythonHookPresent)
    if (r.ok) {
      setHook(r.data)
      toast.success(r.data.installed ? '已启用会话结束自动导出' : '已停用自动导出')
    } else {
      toast.error(r.message)
    }
    setBusy(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-md border p-3">
        <div className="pr-4">
          <div className="text-sm font-medium">会话结束自动导出</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            开启后，在 Claude Code 里结束的新会话会自动导出入库。
          </div>
        </div>
        <Switch checked={hook?.installed ?? false} disabled={!hook || busy} onCheckedChange={() => void toggle()} />
      </div>
      {hook?.pythonHookPresent && !hook.installed && (
        <p className="text-xs text-muted-foreground">检测到旧 Python 版钩子，启用将替换它。</p>
      )}
      <p className="text-xs text-muted-foreground">
        钩子调用本应用的无界面导出模式（自包含，无需 Python/Node）。需在已安装的 .app 中启用。
      </p>
    </div>
  )
}
