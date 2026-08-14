/**
 * 存量库维护：清理 haiku 主导的导出目录 + 按 LLM 主题批量重命名。
 *
 * 供 headless 模式 --library-maintain 调用（可 --dry-run / --limit 预览）。
 * 幂等：已重命名的目录标题不变 → alreadyGood；已移走的 haiku 目录不再被扫描到。
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'

import type { MetaJson } from '@shared/types'

import { renameConversation } from './fs/rename'
import { mapLimit } from './fs/paths'
import { fallbackTitle, generateTitles, type TitleSource } from './exporter/titlegen'

export interface MaintainOptions {
  dryRun?: boolean
  /** 最多处理的会话目录数（配合 dry-run 快速预览） */
  limit?: number
  /** 测试注入点：缺省用真实 titlegen.generateTitles */
  titleGen?: (items: TitleSource[]) => Promise<(string | null)[]>
  now?: Date
}

export interface MaintainReport {
  scanned: number
  haikuMoved: number
  renamed: number
  llmFailed: number
  renameFailed: number
  alreadyGood: number
  skippedNoMeta: number
  failedDirs: string[]
  haikuDirs: string[]
}

const LIBRARY_DEPTH = 2

/** 扫描库根下所有含 meta.json 的会话目录（分类目录无 meta 天然排除；深度 ≤2 与库布局对齐）。 */
export async function listConversationDirs(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue // 跳过 .trash-* 等备份目录
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (depth < LIBRARY_DEPTH) await walk(full, depth + 1)
      } else if (ent.isFile() && ent.name === 'meta.json') {
        out.push(dir)
      }
    }
  }
  await walk(root, 0)
  return out
}

/** 轻量采样 transcript.jsonl 前若干消息文本（容错坏行），供 LLM 标题输入。 */
async function sampleJsonlText(jsonlPath: string, maxChars = 1500): Promise<string> {
  let raw: string
  try {
    raw = await fsp.readFile(jsonlPath, 'utf-8')
  } catch {
    return ''
  }
  let out = ''
  for (const rawLine of raw.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    let o: Record<string, unknown>
    try {
      const parsed = JSON.parse(line)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      o = parsed as Record<string, unknown>
    } catch {
      continue
    }
    if (o['isMeta'] || o['isSidechain']) continue
    const msg = o['message']
    const content =
      msg && typeof msg === 'object' && !Array.isArray(msg) ? (msg as Record<string, unknown>)['content'] : undefined
    const text = extractText(content)
    if (!text.trim()) continue
    out += (out ? '\n' : '') + text
    if (out.length >= maxChars) return out.slice(0, maxChars)
  }
  return out
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && typeof b === 'object' && (b as Record<string, unknown>).type === 'text')
      .map((b) => String((b as Record<string, unknown>).text ?? ''))
      .join(' ')
  }
  return ''
}

function stamp(now: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
}

/** 执行存量维护：清理 haiku → LLM 批量命名 → 重命名。返回统计报告。 */
export async function runLibraryMaintain(root: string, opts: MaintainOptions = {}): Promise<MaintainReport> {
  const report: MaintainReport = {
    scanned: 0,
    haikuMoved: 0,
    renamed: 0,
    llmFailed: 0,
    renameFailed: 0,
    alreadyGood: 0,
    skippedNoMeta: 0,
    failedDirs: [],
    haikuDirs: []
  }
  const now = opts.now ?? new Date()
  const titleGen = opts.titleGen ?? generateTitles

  const dirs = await listConversationDirs(root)
  const metas: Array<{ dir: string; meta: MetaJson }> = []
  for (const dir of dirs) {
    try {
      const m = JSON.parse(await fsp.readFile(path.join(dir, 'meta.json'), 'utf-8')) as MetaJson
      metas.push({ dir, meta: m })
    } catch {
      report.skippedNoMeta += 1
    }
  }
  report.scanned = metas.length
  if (opts.limit !== undefined && opts.limit > 0) metas.splice(opts.limit)

  // 1) 清理 haiku 主导会话：移入 .trash-haiku-<ts>（同卷原子移动，可恢复）
  const keep: typeof metas = []
  for (const { dir, meta } of metas) {
    if (meta.model && meta.model.toLowerCase().includes('haiku')) {
      report.haikuDirs.push(dir)
      if (!opts.dryRun) {
        const trash = path.join(root, `.trash-haiku-${stamp(now)}`)
        await fsp.mkdir(trash, { recursive: true }).catch(() => undefined)
        try {
          await fsp.rename(dir, path.join(trash, path.basename(dir)))
          report.haikuMoved += 1
        } catch {
          report.renameFailed += 1
          report.failedDirs.push(dir)
        }
      }
    } else {
      keep.push({ dir, meta })
    }
  }
  if (opts.dryRun) report.haikuMoved = report.haikuDirs.length

  // 2) 批量 LLM 标题
  const items: TitleSource[] = keep.map(({ meta }) => ({
    cwd: meta.cwd ?? '',
    text: '',
    existingTitle: meta.title ?? ''
  }))
  // 文本采样限并发读文件，避免数百个转录同时读放大磁盘 IO
  const samples = await mapLimit(keep, 8, ({ dir }) => sampleJsonlText(path.join(dir, 'transcript.jsonl')))
  for (let i = 0; i < items.length; i++) items[i].text = samples[i]

  const titles = await titleGen(items)

  // 3) 逐目录重命名（dry-run 只统计不执行）
  for (let i = 0; i < keep.length; i++) {
    const { dir, meta } = keep[i]
    const llm = titles[i] ?? null
    if (llm === null) report.llmFailed += 1
    const t = llm ?? fallbackTitle(items[i])
    if (t === meta.title) {
      report.alreadyGood += 1
      continue
    }
    if (opts.dryRun) {
      report.renamed += 1
      continue
    }
    const res = await renameConversation(dir, t)
    if (res.ok) report.renamed += 1
    else {
      report.renameFailed += 1
      report.failedDirs.push(dir)
    }
  }

  return report
}
