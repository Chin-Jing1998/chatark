import { listSessions, activeSessionIds, quickInfo, exportSession } from '../exporter'
import { library } from '../library'
import { getLibraryRoot } from '../settings/store'
import { mapLimit } from '../fs/paths'
import type { ReexportResult, UnexportedSession } from '@shared/types'

export type { ReexportResult, UnexportedSession }

/** 找出从未导出过的原始会话：全部 session − 库内已登记 − 活跃会话。 */
export async function findUnexported(): Promise<UnexportedSession[]> {
  await library.ensureLoaded()
  const exported = library.allSessionIds()
  const active = await activeSessionIds()
  const sessions = await listSessions()
  const cands = sessions.filter((s) => !exported.has(s.sessionId) && !active.has(s.sessionId))

  const out: UnexportedSession[] = []
  await mapLimit(cands, 6, async (c) => {
    let info: Awaited<ReturnType<typeof quickInfo>> | null = null
    try {
      info = await quickInfo(c.path)
    } catch {
      info = null
    }
    out.push({
      sessionId: c.sessionId,
      path: c.path,
      title: info?.title || '(未命名)',
      cwd: info?.cwd || '',
      turns: info?.turns || 0,
      mtimeMs: c.mtimeMs
    })
  })
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/** 用内置导出器对选定会话补导出并入库；gate 未达标计入 skipped。 */
export async function reexport(
  sessionIds: string[],
  onProgress?: (done: number, total: number) => void
): Promise<ReexportResult> {
  const sessions = await listSessions()
  const byId = new Map(sessions.map((s) => [s.sessionId, s.path]))
  const root = getLibraryRoot()
  let exported = 0
  let skipped = 0
  let failed = 0
  let done = 0

  library.suppressWatch(10 * 60 * 1000)
  try {
    for (const id of sessionIds) {
      const p = byId.get(id)
      if (!p) {
        failed++
      } else {
        const r = await exportSession({ sourceJsonl: p, historyRoot: root })
        if (r.ok) exported++
        else skipped++
      }
      done++
      onProgress?.(done, sessionIds.length)
    }
    await library.rescan()
  } finally {
    // 无论导出/重扫是否抛错，都复位监听抑制，避免残留长达 10 分钟致库刷新失灵
    library.suppressWatch(0)
  }
  return { exported, skipped, failed }
}
