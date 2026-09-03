import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { HookStatus } from '@shared/types'
import { Switch } from '@renderer/components/ui/switch'
import { Button } from '@renderer/components/ui/button'

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

  // 更新即重新安装：installHook 按 --export-stdin 标识整体替换我方旧条目，天然幂等
  const update = async (): Promise<void> => {
    if (!hook || busy) return
    setBusy(true)
    const r = await window.api.hook.install(hook.pythonHookPresent)
    if (r.ok) {
      setHook(r.data)
      toast.success('钩子已更新')
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
      {hook?.needsUpdate && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5">
          <div className="text-xs text-muted-foreground">
            钩子为旧版（命令或超时已变化），点击更新
          </div>
          <Button size="sm" disabled={busy} onClick={() => void update()}>
            更新钩子
          </Button>
        </div>
      )}
      {hook?.pythonHookPresent && !hook.installed && (
        <p className="text-xs text-muted-foreground">检测到旧 Python 版钩子，启用将替换它。</p>
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={!hook?.logExists}
          title={hook?.logExists ? undefined : '尚无日志'}
          onClick={() => hook && void window.api.file.reveal(hook.logPath)}
        >
          打开日志
        </Button>
        {hook && (
          <span className="break-all text-xs text-muted-foreground">
            {hook.logPath}
            {!hook.logExists && '（尚无日志）'}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        钩子调用本应用的无界面导出模式（自包含，无需 Python/Node）。需在已安装的 .app 中启用。
        macOS 下钩子以纯 Node 模式后台运行，不显示程序坞图标。
      </p>
    </div>
  )
}
