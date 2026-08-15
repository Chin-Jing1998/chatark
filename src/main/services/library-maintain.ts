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
import { BATCH_SIZE, fallbackTitle, generateTitles, isPollutedPrompt, type TitleSource } from './exporter/titlegen'

export interface MaintainOptions {
  dryRun?: boolean
  /** 真正搬移 haiku 目录的显式确认；缺省只列出命中清单，不动盘 */
  confirm?: boolean
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
  /** 本次搬移的 trash 目录（未搬移时不设）；还原直接把子目录 mv 回原分类目录即可 */
  trashDir?: string
  /** 面向用户的提示：LLM 不可用、未确认搬移、dry-run 预估等 */
  notes: string[]
}

const LIBRARY_DEPTH = 2
/** haiku 搬移的消息数上限：长会话即使用 haiku 也可能是真实工作，不做无差别清理 */
const HAIKU_MAX_MESSAGES = 10

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

/**
 * LLM 失败后是否允许用本地回退标题改名：仅限现有标题本就无效的情形
 * （空 / 未命名会话 / 自动注入 prompt 污染）。正常标题一律保留，
 * 否则 fallbackTitle 的 12 码点截断会不可逆地毁掉全库标题。
 */
export function isFallbackAllowed(title: string | undefined): boolean {
  const t = (title ?? '').trim()
  return !t || t === '未命名会话' || isPollutedPrompt(t)
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
    haikuDirs: [],
    notes: []
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

  // 1) 清理 haiku 主导的短会话：移入 .trash-haiku-<ts>（同卷原子移动，可恢复）。
  // 仅短会话入选，且非 dry-run 必须显式 confirm——批量搬移点目录在 UI 中不可见，误搬难以察觉。
  const trash = path.join(root, `.trash-haiku-${stamp(now)}`)
  const keep: typeof metas = []
  for (const { dir, meta } of metas) {
    const isHaiku = Boolean(meta.model && meta.model.toLowerCase().includes('haiku'))
    // messageCount 缺失视为不满足：宁可漏搬，不可误搬
    const isShort = typeof meta.messageCount === 'number' && meta.messageCount <= HAIKU_MAX_MESSAGES
    if (!isHaiku || !isShort) {
      keep.push({ dir, meta })
      continue
    }
    report.haikuDirs.push(dir)
    if (opts.dryRun || !opts.confirm) continue
    await fsp.mkdir(trash, { recursive: true }).catch(() => undefined)
    try {
      await fsp.rename(dir, path.join(trash, path.basename(dir)))
      report.haikuMoved += 1
      report.trashDir = trash
    } catch {
      report.renameFailed += 1
      report.failedDirs.push(dir)
    }
  }
  if (opts.dryRun) report.haikuMoved = report.haikuDirs.length
  else if (!opts.confirm && report.haikuDirs.length > 0) {
    report.notes.push(`命中 ${report.haikuDirs.length} 个 haiku 短会话目录，未搬移；确认后加 --confirm 重跑`)
  }
  if (report.trashDir) {
    report.notes.push(`haiku 目录已移入 ${report.trashDir}；还原把其中子目录 mv 回原分类目录即可`)
  }

  // 2) 批量 LLM 标题。dry-run 不调用 LLM——预览不该产生 API 消耗与子进程副作用
  if (opts.dryRun) {
    report.renamed = keep.length
    report.notes.push(`dry-run：将发起 ${Math.ceil(keep.length / BATCH_SIZE)} 次 LLM 调用、待重命名候选 ${keep.length} 条`)
    return report
  }

  const items: TitleSource[] = keep.map(({ meta }) => ({
    cwd: meta.cwd ?? '',
    text: '',
    existingTitle: meta.title ?? ''
  }))
  // 文本采样限并发读文件，避免数百个转录同时读放大磁盘 IO
  const samples = await mapLimit(keep, 8, ({ dir }) => sampleJsonlText(path.join(dir, 'transcript.jsonl')))
  for (let i = 0; i < items.length; i++) items[i].text = samples[i]

  const titles = await titleGen(items)

  // claude 整体不可用（全量 null）时不得据本地回退批量改名：fallbackTitle 会把现有长标题
  // 截成 12 码点并连目录名一起改写，无备份不可逆
  if (keep.length > 0 && titles.every((t) => !t)) {
    report.llmFailed = keep.length
    report.notes.push(`LLM 不可用，跳过重命名 ${keep.length} 条`)
    return report
  }

  // 3) 逐目录重命名
  for (let i = 0; i < keep.length; i++) {
    const { dir, meta } = keep[i]
    const llm = titles[i] ?? null
    if (llm === null) report.llmFailed += 1
    // 单条 LLM 失败时只有本就无效的标题才允许本地回退，否则保留原标题
    const t = llm ?? (isFallbackAllowed(meta.title) ? fallbackTitle(items[i]) : (meta.title ?? ''))
    if (t === meta.title) {
      report.alreadyGood += 1
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
