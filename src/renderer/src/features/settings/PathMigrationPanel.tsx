import { useEffect, useState } from 'react'
import type { MigrationProgress } from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import { useStore } from '@renderer/app/store'
import { formatBytes } from '@renderer/lib/format'

const PHASE_LABEL: Record<MigrationProgress['phase'], string> = {
  plan: '准备',
  copying: '复制中',
  verifying: '校验中',
  switching: '切换中',
  done: '完成',
  error: '出错'
}

export default function PathMigrationPanel(): JSX.Element {
  const { reload } = useStore()
  const [root, setRoot] = useState('')
  const [migrating, setMigrating] = useState(false)
  const [progress, setProgress] = useState<MigrationProgress | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.library.getRoot().then(setRoot)
  }, [])
  useEffect(() => {
    if (migrating) return window.api.onMigration(setProgress)
  }, [migrating])

  const change = async (): Promise<void> => {
    setMsg(null)
    setError(null)
    const picked = await window.api.library.pickRoot()
    if (!picked || picked === root) return
    const okToGo = await window.api.ui.confirm({
      message: '更换历史库保存路径？',
      detail: `将把当前库全部内容迁移到：\n${picked}\n\n复制并逐文件校验通过后，旧路径下的内容会被移入系统回收站（可恢复）。`,
      confirmLabel: '开始迁移'
    })
    if (!okToGo) return
    setMigrating(true)
    setProgress(null)
    const r = await window.api.library.setRoot(picked)
    setMigrating(false)
    if (r.ok) {
      setRoot(picked)
      const kept = r.data.sourceKept
      setMsg(
        kept.length > 0
          ? `迁移完成，共 ${r.data.movedFiles} 个文件。旧路径下有 ${kept.length} 项未能移入回收站，仍留在原处，可手动清理。`
          : `迁移完成，共 ${r.data.movedFiles} 个文件，旧路径内容已移入回收站。`
      )
      await reload()
    } else {
      setError(r.message)
    }
  }

  const pct = progress && progress.totalBytes > 0 ? Math.round((progress.copiedBytes / progress.totalBytes) * 100) : 0

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-sm font-medium">历史库保存路径</div>
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs break-all text-muted-foreground">
          {root || '加载中…'}
        </div>
      </div>
      <Button onClick={() => void change()} disabled={migrating}>
        {migrating ? '迁移中…' : '更改路径并迁移'}
      </Button>

      {migrating && progress && (
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">
            {PHASE_LABEL[progress.phase]} · {progress.copiedFiles}/{progress.totalFiles} 文件 ·{' '}
            {formatBytes(progress.copiedBytes)} / {formatBytes(progress.totalBytes)}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {msg && <div className="text-sm text-emerald-600 dark:text-emerald-400">{msg}</div>}
      {error && <div className="text-sm text-destructive">迁移失败：{error}</div>}
      <p className="text-xs text-muted-foreground">
        采用「复制 → 校验 → 切换 → 旧路径移入回收站」，校验通过前绝不动旧数据；新旧路径不得互相嵌套。
        不能选用主目录、桌面、文稿等个人数据总入口作为库根——请在其下新建专用子目录。
      </p>
    </div>
  )
}
