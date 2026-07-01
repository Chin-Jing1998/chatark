import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import type { ConversationRecord, ScanResult } from '@shared/types'
import { parseDirName, mapLimit } from './paths'
import { parseConversationDir } from './parse-dir'

const SCAN_CONCURRENCY = 8

async function listSubdirs(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => join(dir, e.name))
}

async function hasMeta(dir: string): Promise<boolean> {
  try {
    await fs.access(join(dir, 'meta.json'))
    return true
  } catch {
    return false
  }
}

/**
 * 扫描库根 → 分类目录（第一层）→ 对话目录（第二层）。
 * 仅把"含 meta.json 或目录名符合规则"的二级目录视为对话；其余记入 skipped。
 * 完成后跨目录汇总回填 duplicateSessionId，并对重复 sessionId 去歧义化 id。
 */
export async function scan(root: string): Promise<ScanResult> {
  const startedMs = Date.now()
  const skipped: ScanResult['skipped'] = []

  let categoryDirs: string[]
  try {
    categoryDirs = await listSubdirs(root)
  } catch (e) {
    return {
      records: [],
      scannedDirs: 0,
      skipped: [{ path: root, reason: `库根不可读: ${e instanceof Error ? e.message : e}` }],
      tookMs: Date.now() - startedMs
    }
  }

  const candidates: string[] = []
  for (const catDir of categoryDirs) {
    let convDirs: string[]
    try {
      convDirs = await listSubdirs(catDir)
    } catch {
      skipped.push({ path: catDir, reason: '分类目录不可读' })
      continue
    }
    for (const d of convDirs) candidates.push(d)
  }

  const isConv = await mapLimit(candidates, SCAN_CONCURRENCY, async (d) => {
    const ok = parseDirName(d.split('/').pop() ?? '') !== null || (await hasMeta(d))
    if (!ok) skipped.push({ path: d, reason: '非对话目录（无 meta.json 且目录名不符）' })
    return ok
  })
  const convDirs = candidates.filter((_, i) => isConv[i])

  const indexedAt = Date.now()
  const records = await mapLimit(convDirs, SCAN_CONCURRENCY, (d) =>
    parseConversationDir(d, root, indexedAt)
  )

  markDuplicates(records)

  return {
    records,
    scannedDirs: candidates.length,
    skipped,
    tookMs: Date.now() - startedMs
  }
}

/** 同 sessionId 多目录：标记 duplicateSessionId，并对第 2 个起的 id 追加 relPath 短哈希去歧义。 */
function markDuplicates(records: ConversationRecord[]): void {
  const groups = new Map<string, ConversationRecord[]>()
  for (const r of records) {
    if (!r.sessionId) continue
    const arr = groups.get(r.sessionId) ?? []
    arr.push(r)
    groups.set(r.sessionId, arr)
  }
  for (const arr of groups.values()) {
    if (arr.length < 2) continue
    arr.forEach((r, i) => {
      r.integrity.duplicateSessionId = true
      if (i > 0) {
        const short = createHash('sha1').update(r.relPath).digest('hex').slice(0, 6)
        r.id = `${r.sessionId}#${short}`
      }
    })
  }
}
