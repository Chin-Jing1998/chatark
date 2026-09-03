/**
 * 单根写入：目录命名、幂等定位、原子落盘。
 *
 * 自 chat_export/writer.py 移植。目录名 <时间戳>_<标题净化>_<sessionId末8>；
 * 落盘 .tmp + rename 原子；按 sessionId 幂等复用旧目录。
 */
import fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import path from 'node:path'

import type { MetaJson, TitleSourceKind } from '@shared/types'

import { mapLimit } from '../fs/paths'
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

/**
 * 库的目录结构固定为 <根>/<分类>/<对话>/meta.json，故只下钻两层。
 * 不限深度地递归整库，在库根被误设成大目录时会退化成遍历整块磁盘。
 */
const LIBRARY_DEPTH = 2

/**
 * 列出库内所有 meta.json 路径（异步、限深）。
 *
 * 只收 `<根>/<分类>/<对话>/meta.json`（即 depth === LIBRARY_DEPTH 处的文件）：库根第一层
 * 游离着历史上手工拖拽丢了分类层的对话目录，此前任意层匹配会让 findExisting 把新导出写回
 * 那些目录，而扫描器又不把它们计入索引，形成"永远显示未导出"的闭环。
 */
async function listMetaFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (depth < LIBRARY_DEPTH) await walk(full, depth + 1)
      } else if (ent.isFile() && ent.name === engine.META_NAME && depth === LIBRARY_DEPTH) {
        out.push(full)
      }
    }
  }
  await walk(root, 0)
  return out
}

/** 读取导出目录内的 meta.json；不存在或损坏返回 null。 */
export async function readExistingMeta(dir: string): Promise<MetaJson | null> {
  try {
    return JSON.parse(await fsp.readFile(path.join(dir, engine.META_NAME), 'utf-8')) as MetaJson
  } catch {
    return null
  }
}

/**
 * 既有导出是否已与源转录同步：转录快照存在且字节数与源一致，且不是 light 导出。
 * 转录只追加不改写，故字节数相等即可判定无新内容——据此跳过整轮重写与重新起名。
 */
export async function transcriptUnchanged(dir: string, sourceJsonl: string): Promise<boolean> {
  const meta = await readExistingMeta(dir)
  if (!meta || meta.light) return false
  try {
    const [snapshot, source] = await Promise.all([
      fsp.stat(path.join(dir, engine.TRANSCRIPT_NAME)),
      fsp.stat(sourceJsonl)
    ])
    return snapshot.isFile() && source.isFile() && snapshot.size === source.size
  } catch {
    return false
  }
}

/**
 * 按 sessionId 找已存在的导出目录，供导出复用同一目录（幂等）。
 *
 * 改为异步：此前是同步 readdirSync/readFileSync 递归全库，每次导出都要把所有 meta.json
 * 读一遍并解析——GUI 里补导出时会直接卡住主进程事件循环，且开销随库规模线性增长。
 */
export async function findExisting(root: string, sessionId: string): Promise<string | null> {
  if (!sessionId) return null
  try {
    if (!(await fsp.stat(root)).isDirectory()) return null
  } catch {
    return null
  }
  const metas = await listMetaFiles(root)
  const found = await mapLimit(metas, 8, async (metaPath) => {
    try {
      const m = JSON.parse(await fsp.readFile(metaPath, 'utf-8')) as MetaJson
      return m.sessionId === sessionId ? path.dirname(metaPath) : null
    } catch {
      return null
    }
  })
  return found.find((x): x is string => x !== null) ?? null
}

/** 临时文件名带 pid：GUI 补导出与 SessionEnd 钩子进程可能同时导出同一 session，不能撞同一个 .tmp。 */
function tmpPathFor(filePath: string): string {
  return path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`)
}

/** 原子写入字节：写 .name.<pid>.tmp（fsync）后 rename。 */
function atomicWriteBytes(filePath: string, data: Buffer): void {
  const tmp = tmpPathFor(filePath)
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
  const tmp = tmpPathFor(dst)
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
 * titleSource 记录本次落盘标题的来源，重导出据此决定是否重新起名。
 */
export function writeExport(
  conv: Conversation,
  textArts: engine.TextArtifacts,
  targetDir: string,
  transcriptSrc: string | null = null,
  light = false,
  titleSource: TitleSourceKind = 'local'
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
  meta.titleSource = titleSource
  atomicWriteText(path.join(targetDir, engine.META_NAME), JSON.stringify(meta, null, 2))

  return { dir: targetDir, meta: meta as MetaJson }
}
