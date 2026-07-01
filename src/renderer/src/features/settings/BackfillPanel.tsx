import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { UnexportedSession } from '@shared/types'
import { Button } from '@renderer/components/ui/button'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { useStore } from '@renderer/app/store'

export default function BackfillPanel(): JSX.Element {
  const { reload } = useStore()
  const [busy, setBusy] = useState(false)
  const [list, setList] = useState<UnexportedSession[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => window.api.onBackfill(setProgress), [])

  const doImport = async (): Promise<void> => {
    const dirs = await window.api.backfill.pickImport()
    if (dirs.length === 0) return
    setBusy(true)
    const results = await window.api.backfill.import(dirs)
    const imported = results.filter((x) => x.ok && x.data.status === 'imported').length
    const dup = results.filter((x) => x.ok && x.data.status === 'skipped-duplicate').length
    toast.success(`导入完成：新增 ${imported}，已存在跳过 ${dup}`)
    await reload()
    setBusy(false)
  }

  const scan = async (): Promise<void> => {
    setBusy(true)
    const r = await window.api.backfill.scanRaw()
    setList(r)
    setSelected(new Set(r.map((s) => s.sessionId)))
    setBusy(false)
  }

  const toggle = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const reexport = async (): Promise<void> => {
    if (selected.size === 0) return
    setBusy(true)
    setProgress({ done: 0, total: selected.size })
    const r = await window.api.backfill.reexport([...selected])
    toast.success(`补导出：成功 ${r.exported}，跳过 ${r.skipped}，失败 ${r.failed}`)
    setProgress(null)
    setList(null)
    await reload()
    setBusy(false)
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        补录只在本机有意义：依赖你 ~/.claude 下的原始会话。分发给他人后，对方在自己机器上补录自己的会话。
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => void doImport()}>
          导入对话文件夹
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => void scan()}>
          扫描未导出会话
        </Button>
        {list && selected.size > 0 && (
          <Button disabled={busy} onClick={() => void reexport()}>
            补导出选中（{selected.size}）
          </Button>
        )}
      </div>

      {progress && (
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">
            补导出中 {progress.done}/{progress.total}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {list && (
        <ScrollArea className="h-56 rounded-md border">
          <div className="divide-y">
            {list.length === 0 && <div className="p-4 text-sm text-muted-foreground">没有未导出的会话</div>}
            {list.map((s) => (
              <label key={s.sessionId} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted">
                <input type="checkbox" checked={selected.has(s.sessionId)} onChange={() => toggle(s.sessionId)} />
                <span className="min-w-0 flex-1 truncate font-medium">{s.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{s.turns} 轮</span>
              </label>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
