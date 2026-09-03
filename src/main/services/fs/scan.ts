import { basename, join } from 'node:path'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import type { ConversationRecord, ScanResult } from '@shared/types'
import { UNCATEGORIZED } from '@shared/constants'
import { parseDirName, mapLimit } from './paths'
import { parseConversationDir } from './parse-dir'

const SCAN_CONCURRENCY = 8

async function listSubdirs(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => join(dir, e.name))
}

/** 目录内是否有任何非隐藏条目（文件或子目录）；空目录视为「空分类」而非垃圾目录。 */
async function hasVisibleEntries(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir)
    return entries.some((n) => !n.startsWith('.'))
  } catch {
    return false
  }
}

async function hasMeta(dir: string): Promise<boolean> {
  try {
    await fs.access(join(dir, 'meta.json'))
    return true
  } catch {
    return false
  }
}

/** 目录是否像一个对话目录：目录名符合规则，或含 meta.json。 */
async function looksLikeConversation(dir: string): Promise<boolean> {
  // 必须用 basename：Windows 的分隔符是 `\`，split('/') 会把整条路径原样返回，
  // 导致 parseDirName 恒为 null —— 缺 meta.json 但目录名规范的对话会被整个跳过。
  return parseDirName(basename(dir)) !== null || (await hasMeta(dir))
}

/**
 * 库根第一层的游离对话目录（手工拖拽丢了分类层）：物理上没有分类，归入虚拟分类「未归类」。
 * 以不可变方式覆写，不改动 parseConversationDir 的通用语义。
 */
function asUncategorized(rec: ConversationRecord): ConversationRecord {
  return {
    ...rec,
    category: UNCATEGORIZED,
    // 游离目录直接位于库根下，相对路径就是目录名
    relPath: rec.dirName,
    integrity: {
      ...rec.integrity,
      // 分类不一致以「meta 声明的分类 ≠ 实际所在分类」为准；未归类必然与任何声明冲突
      categoryMismatch: Boolean(rec.meta.category && rec.meta.category !== UNCATEGORIZED)
    }
  }
}

/**
 * 扫描库根 → 分类目录（第一层）→ 对话目录（第二层），并识别库根第一层的游离对话目录。
 * 仅把"含 meta.json 或目录名符合规则"的目录视为对话；其余记入 skipped。
 * 完成后跨目录汇总回填 duplicateSessionId，并对重复 sessionId 去歧义化 id。
 */
export async function scan(root: string): Promise<ScanResult> {
  const startedMs = Date.now()
  const skipped: ScanResult['skipped'] = []

  let topDirs: string[]
  try {
    topDirs = await listSubdirs(root)
  } catch (e) {
    return {
      records: [],
      scannedDirs: 0,
      skipped: [{ path: root, reason: `库根不可读: ${e instanceof Error ? e.message : e}` }],
      tookMs: Date.now() - startedMs
    }
  }

  const candidates: string[] = []
  const strayDirs: string[] = []
  for (const topDir of topDirs) {
    // 第一层就是对话目录 → 游离对话，不再当分类目录展开
    if (await looksLikeConversation(topDir)) {
      strayDirs.push(topDir)
      continue
    }
    let convDirs: string[]
    try {
      convDirs = await listSubdirs(topDir)
    } catch {
      skipped.push({ path: topDir, reason: '分类目录不可读' })
      continue
    }
    // 既不是对话目录、也没有任何子目录：空目录按「空分类」静默放过（新建或清空的分类很常见），
    // 只含散落文件的目录才明确报出而非静默忽略
    if (convDirs.length === 0) {
      if (await hasVisibleEntries(topDir)) {
        skipped.push({ path: topDir, reason: '非对话目录且无对话子目录' })
      }
      continue
    }
    for (const d of convDirs) candidates.push(d)
  }

  const isConv = await mapLimit(candidates, SCAN_CONCURRENCY, async (d) => {
    const ok = await looksLikeConversation(d)
    if (!ok) skipped.push({ path: d, reason: '非对话目录（无 meta.json 且目录名不符）' })
    return ok
  })
  const convDirs = candidates.filter((_, i) => isConv[i])

  const indexedAt = Date.now()
  const records = await mapLimit(convDirs, SCAN_CONCURRENCY, (d) =>
    parseConversationDir(d, root, indexedAt)
  )
  const strayRecords = await mapLimit(strayDirs, SCAN_CONCURRENCY, async (d) =>
    asUncategorized(await parseConversationDir(d, root, indexedAt))
  )
  const all = [...records, ...strayRecords]

  markDuplicates(all)

  return {
    records: all,
    scannedDirs: candidates.length + strayDirs.length,
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
