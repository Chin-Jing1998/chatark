/**
 * 单根写入：目录命名、幂等定位、原子落盘。
 *
 * 自 chat_export/writer.py 移植。目录名 <时间戳>_<标题净化>_<sessionId末8>；
 * 落盘 .tmp + rename 原子；按 sessionId 幂等复用旧目录。
 */
import fs from 'node:fs'
import path from 'node:path'

import type { MetaJson } from '@shared/types'

import * as engine from './engine'
import * as textutil from './textutil'
import * as timeutil from './timeutil'
import { type Conversation } from './types'

/** 仅保留字母数字与 - _（对齐 Python c.isalnum() or c in "-_"，含 Unicode 字母数字）。 */
function sidSafe(sessionId: string): string {
  const s = sessionId || ''
  let out = ''
  for (const c of s) {
    if (/[\p{L}\p{N}]/u.test(c) || c === '-' || c === '_') out += c
  }
  return out
}

/** 目录名 <时间戳>_<标题净化>_<sessionId末8位>。时间戳缺失时回退源文件 mtime。 */
export function folderName(conv: Conversation): string {
  let fallback: number | null = null
  try {
    if (conv.source_path) {
      fallback = fs.statSync(conv.source_path).mtimeMs / 1000 // 秒级，对齐 os.path.getmtime
    }
  } catch {
    fallback = null
  }
  const ts = timeutil.folderTimestamp(conv.started_at, fallback)
  const title = textutil.sanitizeFilename(conv.title || '未命名会话')
  const sid = sidSafe(conv.session_id).slice(-8)
  const suffix = sid ? `_${sid}` : ''
  return `${ts}_${title}${suffix}`
}

/** 递归列出目录下所有 meta.json 路径。 */
function* walkMeta(root: string): Generator<string> {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    const full = path.join(root, ent.name)
    if (ent.isDirectory()) {
      yield* walkMeta(full)
    } else if (ent.isFile() && ent.name === engine.META_NAME) {
      yield full
    }
  }
}

/** 按 sessionId 找已存在的导出目录（递归扫描 meta.json）。 */
export function findExisting(root: string, sessionId: string): string | null {
  if (!sessionId) return null
  let isDir = false
  try {
    isDir = fs.statSync(root).isDirectory()
  } catch {
    return null
  }
  if (!isDir) return null
  for (const metaPath of walkMeta(root)) {
    try {
      const m = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as MetaJson
      if (m.sessionId === sessionId) return path.dirname(metaPath)
    } catch {
      continue
    }
  }
  return null
}

/** 原子写入字节：写 .name.tmp（fsync）后 rename。 */
function atomicWriteBytes(filePath: string, data: Buffer): void {
  const tmp = path.join(path.dirname(filePath), '.' + path.basename(filePath) + '.tmp')
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeSync(fd, data)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, filePath)
}

function atomicWriteText(filePath: string, text: string): void {
  atomicWriteBytes(filePath, Buffer.from(text, 'utf-8'))
}

function atomicCopy(src: string, dst: string): void {
  const tmp = path.join(path.dirname(dst), '.' + path.basename(dst) + '.tmp')
  fs.copyFileSync(src, tmp)
  fs.renameSync(tmp, dst)
}

export interface WriteResult {
  dir: string
  meta: MetaJson
}

/** 把一次导出写入 targetDir（原子）。
 *
 * light=true：仅写 md/html/js/meta，跳过原始转录拷贝（增量/实时同步用）。
 */
export function writeExport(
  conv: Conversation,
  textArts: engine.TextArtifacts,
  targetDir: string,
  transcriptSrc: string | null = null,
  light = false
): WriteResult {
  fs.mkdirSync(targetDir, { recursive: true })

  // 文本产物（md/html/js，始终更新）
  for (const [name, text] of Object.entries(textArts)) {
    atomicWriteText(path.join(targetDir, name), text)
  }

  if (!light) {
    // 原始转录快照备份
    if (transcriptSrc && fs.existsSync(transcriptSrc)) {
      try {
        atomicCopy(transcriptSrc, path.join(targetDir, engine.TRANSCRIPT_NAME))
      } catch {
        // 备份失败不阻断主流程
      }
    }
  }

  const meta = engine.metaDict(conv) as Record<string, unknown>
  meta.light = Boolean(light)
  atomicWriteText(path.join(targetDir, engine.META_NAME), JSON.stringify(meta, null, 2))

  return { dir: targetDir, meta: meta as MetaJson }
}
