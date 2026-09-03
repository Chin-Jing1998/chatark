import { listSessions, activeSessionIds, quickInfo, exportSession } from '../exporter'
import { isPollutedPrompt } from '../exporter/titlegen'
import { MIN_ASSISTANT, MIN_SUBSTANTIVE } from '../exporter/paths'
import { titleLockCallbacks } from '../exporter/title-lock'
import { library } from '../library'
import { resolveUserDataDir } from '../app-paths'
import { getLibraryRoot } from '../settings/store'
import { mapLimit } from '../fs/paths'
import type { ReexportResult, UnexportedSession } from '@shared/types'

export type { ReexportResult, UnexportedSession }

/** quickInfo 的 turns 是去噪后的 user + assistant 条数，其下界必然不低于 gate 的实质消息门槛。 */
const MIN_TURNS = Math.max(MIN_ASSISTANT + 1, MIN_SUBSTANTIVE)

/**
 * 补导出列表的展示判定：只列「导出后真能入库」的会话，避免列表里堆积永远导不进去的条目。
 *
 * 三类直接剔除，与 exporter 的 gate / skipReason 判定一一对应：
 * haiku 主导的一次性查询；自动注入 prompt 派生的会话（本应用起名调用即属此类，
 * 历史上曾在 ~/.claude/projects 留下数百个一问一答的转录）；实质消息数不达导出门槛的空壳会话。
 */
export function isOfferable(info: { title: string; turns: number; model: string | null } | null): boolean {
  if (!info) return true // 读不出信息时不擅自隐藏，交由用户自行判断
  if (info.model && info.model.toLowerCase().includes('haiku')) return false
  if (isPollutedPrompt(info.title)) return false
  return info.turns >= MIN_TURNS
}

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
    if (!isOfferable(info)) return
    out.push({
      sessionId: c.sessionId,
      path: c.path,
      title: info?.title || '(未命名)',
      cwd: info?.cwd || '',
      turns: info?.turns || 0,
      model: info?.model ?? undefined,
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
  // 与 SessionEnd 钩子链路共用同一把起名锁：否则批量补导出会与钩子并发拉起 claude
  const titleLock = titleLockCallbacks(resolveUserDataDir())
  let exported = 0
  let skipped = 0
  let failed = 0
  let done = 0

  // 整段包进抑制：期间本程序写入的目录不逐个触发重扫，结束后由闸门统一重放一次
  await library.runSuppressed(async () => {
    for (const id of sessionIds) {
      const p = byId.get(id)
      if (!p) {
        failed++
      } else {
        const r = await exportSession({ sourceJsonl: p, historyRoot: root, titleMode: 'llm', ...titleLock })
        if (r.ok) exported++
        else if (r.skipped) skipped++
        else failed++
      }
      done++
      onProgress?.(done, sessionIds.length)
    }
    await library.rescan()
  })
  return { exported, skipped, failed }
}
