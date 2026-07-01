import { basename, dirname, join, relative } from 'node:path'
import { promises as fs } from 'node:fs'
import { FILE_NAMES } from '@shared/constants'
import type {
  ConversationFiles,
  ConversationRecord,
  FileKind,
  FilePresence,
  Integrity,
  MetaJson
} from '@shared/types'
import { fingerprintOf, parseDirName } from './paths'
import { readOrg } from '../org/sidecar'

const FILE_KEYS: FileKind[] = ['html', 'jsonl', 'dataJs', 'md', 'meta']
const ABSENT: FilePresence = { exists: false, sizeBytes: 0, mtimeMs: 0 }

async function statFile(path: string): Promise<FilePresence> {
  try {
    const s = await fs.stat(path)
    return { exists: true, sizeBytes: s.size, mtimeMs: s.mtimeMs }
  } catch {
    return { ...ABSENT }
  }
}

async function readMeta(path: string): Promise<{ meta: MetaJson; error?: string }> {
  try {
    const raw = await fs.readFile(path, 'utf8')
    return { meta: JSON.parse(raw) as MetaJson }
  } catch (e) {
    return { meta: {}, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 解析单个对话目录为统一记录。容错：meta 缺失/损坏时回退目录名解析。
 * 不读取 html/jsonl/md 正文（仅 stat），正文交索引阶段惰性处理。
 */
export async function parseConversationDir(
  absDir: string,
  root: string,
  indexedAt: number
): Promise<ConversationRecord> {
  const dirName = basename(absDir)
  const category = basename(dirname(absDir))
  const relPath = relative(root, absDir)

  // 对话文件夹磁盘创建时间（birthtime）：用于“创建时间”排序；取不到则退化为 0
  const createdAtMs = await fs
    .stat(absDir)
    .then((s) => s.birthtimeMs || s.ctimeMs || 0)
    .catch(() => 0)

  const presences = await Promise.all(FILE_KEYS.map((k) => statFile(join(absDir, FILE_NAMES[k]))))
  const files = Object.fromEntries(
    FILE_KEYS.map((k, i) => [k, presences[i]])
  ) as ConversationFiles

  const metaRes = files.meta.exists
    ? await readMeta(join(absDir, FILE_NAMES.meta))
    : { meta: {} as MetaJson, error: 'meta.json 缺失' }
  const meta = metaRes.meta

  const parsedName = parseDirName(dirName)
  const title = meta.title?.trim() || parsedName?.title || dirName
  const sessionId = meta.sessionId?.trim() || ''
  const id = sessionId || `dir:${relPath}`

  const missingFiles = FILE_KEYS.filter((k) => !files[k].exists)
  const integrity: Integrity = {
    missingFiles,
    categoryMismatch: Boolean(meta.category && meta.category !== category),
    duplicateSessionId: false, // 由 scan 跨目录汇总后回填
    metaParseError: metaRes.error
  }

  const totalSizeBytes = presences.reduce((sum, p) => sum + p.sizeBytes, 0)
  const fingerprint = fingerprintOf([files.meta, files.md, files.html])
  const org = await readOrg(absDir)

  return {
    id,
    sessionId,
    dirName,
    absPath: absDir,
    relPath,
    category,
    title,
    model: meta.model ?? '',
    startedAt: meta.startedAt ?? '',
    endedAt: meta.endedAt ?? '',
    messageCount: meta.messageCount ?? 0,
    userPromptCount: meta.userPromptCount ?? 0,
    assistantCount: meta.assistantCount ?? 0,
    anyTruncated: Boolean(meta.anyTruncated),
    meta,
    files,
    totalSizeBytes,
    fingerprint,
    integrity,
    org,
    createdAtMs,
    indexedAt
  }
}
