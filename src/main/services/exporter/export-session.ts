/**
 * 高层导出：先落盘、后起名。
 *
 * 旧流程把 LLM 起名放在写盘之前，起名一旦卡住（实测近 7 天 26 次超时）整场会话一个文件
 * 都写不出。现在拆成两段：
 *   fastPath —— 解析 → gate → skip → 定位既有目录 → unchanged 判定 → 以**本地标题**写五件套；
 *   titlePath —— 仅在需要时调用 LLM，成功后改名（meta.title + 目录名），失败则保留本地标题。
 * 任何阶段的失败都不影响已落盘的内容。
 */
import path from 'node:path'

import type { MetaJson, TitleSourceKind } from '@shared/types'

import { renameConversation } from '../fs/rename'
import * as classifier from './classifier'
import * as engine from './engine'
import * as gate from './gate'
import * as jsonlParser from './jsonl-parser'
import * as model from './model'
import * as titler from './titler'
import {
  fallbackTitle,
  generateTitle,
  isCoolingDown,
  isFallbackAllowed,
  isPollutedPrompt,
  sampleEventText,
  type TitleSource
} from './titlegen'
import * as writer from './writer'
import type { ParseResult } from './jsonl-parser'
import { EventType, type BuildOptions, type Conversation, type RawRecord } from './types'

export interface BuildConvOptions extends BuildOptions {
  stats?: ParseResult['stats']
}

/** 由记录列表构建完整 Conversation（已应用分类与标题，可直接渲染）。 */
export function buildConversation(records: RawRecord[], opts: BuildConvOptions = {}): Conversation {
  const conv = model.buildConversation(records, opts)
  conv.category = classifier.classify(conv)
  conv.title = titler.makeTitle(conv)
  conv.warnings = []
  const stats = opts.stats ?? { total_lines: records.length, bad_lines: 0, good_lines: records.length }
  if (stats.bad_lines) conv.warnings.push(`跳过 ${stats.bad_lines} 坏行`)
  conv.parse_stats = stats
  return conv
}

/**
 * gate 之外的入库判定：haiku 主导的一次性会话、以及自动注入 prompt 派生的会话
 * （含本应用 titlegen 起标题派生的 claude 会话——导出它会再派生 claude，无限自激）。
 * 返回跳过原因，null 表示可导出。
 */
export function skipReason(conv: Conversation): string | null {
  if (conv.model && conv.model.toLowerCase().includes('haiku')) {
    return 'haiku 模型主导的查询/摘要会话，跳过导出'
  }
  const firstPrompt = conv.events.find((e) => e.etype === EventType.USER_PROMPT)
  if (firstPrompt && isPollutedPrompt(firstPrompt.text)) {
    return '自动注入 prompt 派生的会话（如标题生成），跳过导出'
  }
  return null
}

/** 日志字段：由调用方（无头 worker）写入 auto-export.log，GUI 侧可不传。 */
export type LogFields = Record<string, string | number>

export interface ExportArgs {
  sourceJsonl: string
  historyRoot: string
  /** 'existing' = 保持现状（本地规则标题）；'llm' = 落盘后再用 claude CLI 起中文主题标题 */
  titleMode?: 'existing' | 'llm'
  /**
   * 关键节点回调，字段 result 取值：
   * read-failed | gate | skip | unchanged | written | write-failed | titled | title-failed | title-locked
   */
  onLog?: (fields: LogFields) => void
  /** titlegen 全局互斥：返回 false 表示没抢到锁，本次跳过起名（保留本地标题） */
  acquireTitleLock?: () => Promise<boolean>
  releaseTitleLock?: () => void
}

export interface ExportOutcome {
  ok: boolean
  dir?: string
  meta?: MetaJson
  reason?: string
  /** true = 因 haiku 模型主导被跳过（非错误，headless 退出码应为 0） */
  skipped?: boolean
  /** true = 既有导出与源转录一致，本次未重写任何文件 */
  unchanged?: boolean
  /** 落盘标题的来源 */
  titleSource?: TitleSourceKind
  /** true = 本次由 LLM 起名并改名成功 */
  titled?: boolean
}

/** 落盘标题决策结果。 */
interface TitleDecision {
  title: string
  source: TitleSourceKind
}

/**
 * 决定这次落盘用什么标题：
 * 新目录一律用本地规则（不等 LLM）；既有目录沿用其 meta.title（含用户手改），
 * 仅当既有标题本就无效（空 / 未命名 / 污染）时才用本地规则替换。
 */
function decideTitle(existingMeta: MetaJson | null, src: TitleSource): TitleDecision {
  if (!existingMeta) return { title: fallbackTitle(src), source: 'local' }
  const prev = existingMeta.title ?? ''
  if (isFallbackAllowed(prev)) {
    return { title: fallbackTitle({ ...src, existingTitle: prev }), source: 'local' }
  }
  // 旧 meta 无 titleSource 字段者按 'llm' 对待：它们本就是 LLM 起的名，不必重起
  return { title: prev, source: existingMeta.titleSource ?? 'llm' }
}

/**
 * 既有导出是否仍欠一次 LLM 起名：标题出自本地规则，或本就无效（空 / 未命名 / 污染）。
 * meta 读不出来时一律判否——没有 meta.json 就无从改名。
 */
function needsLlmTitle(meta: MetaJson | null): boolean {
  if (!meta) return false
  return meta.titleSource === 'local' || isFallbackAllowed(meta.title)
}

/** LLM 起名的执行结果（失败时原样回传传入值）。 */
interface TitleOutcome {
  dir: string
  meta: MetaJson | null
  titleSource: TitleSourceKind
  titled: boolean
}

/**
 * 起名段：抢全局锁 → 调 LLM → 改名（meta.title + 目录名）。
 * 任何一步失败都保留传入的目录与标题，不抛异常；锁只在真正抢到时才释放，
 * 否则会把别的进程正持有的锁文件删掉。
 */
async function applyLlmTitle(
  args: ExportArgs,
  cur: TitleOutcome,
  titleSrc: TitleSource,
  log: (fields: LogFields) => void
): Promise<TitleOutcome> {
  const out: TitleOutcome = { ...cur }
  let locked = false
  try {
    locked = args.acquireTitleLock ? await args.acquireTitleLock() : true
    if (!locked) {
      log({ result: 'title-locked', dir: out.dir })
      return out
    }
    const t = await generateTitle(titleSrc)
    if (!t) {
      log({ result: 'title-failed', dir: out.dir })
      return out
    }
    // 标题与本地结果恰好相同时目录名不变，renameConversation 只更新 meta
    // （titleSource 转为 'llm'），下次重导出便不再重复起名
    const r = await renameConversation(out.dir, t, 'llm')
    if (!r.ok) {
      log({ result: 'title-failed', dir: out.dir, reason: r.message })
      return out
    }
    out.dir = r.data.newPath
    out.titleSource = 'llm'
    out.titled = true
    out.meta = out.meta ? { ...out.meta, title: t, titleSource: 'llm' } : out.meta
    log({ result: 'titled', dir: out.dir, title: t })
    return out
  } finally {
    if (locked) args.releaseTitleLock?.()
  }
}

/**
 * 高层导出：解析 → gate → build → 定位 → 落盘五件套 → （可选）LLM 起名改目录。
 * 原子落盘到 `historyRoot/<category>/<folderName>/`；已存在同 sessionId 则复用其目录。
 */
export async function exportSession(args: ExportArgs): Promise<ExportOutcome> {
  const { sourceJsonl, historyRoot } = args
  const log = (fields: LogFields): void => args.onLog?.(fields)

  let parsed: ParseResult
  try {
    parsed = await jsonlParser.readAll(sourceJsonl)
  } catch (err) {
    const reason = `读取或解析转录失败：${(err as Error).message}`
    log({ result: 'read-failed', reason })
    return { ok: false, reason }
  }

  if (!gate.shouldExport(parsed)) {
    const reason = '未达导出门槛（助手回合或实质消息不足）'
    log({ result: 'gate', reason })
    return { ok: false, reason }
  }

  const conv = buildConversation(parsed.records, { sourcePath: sourceJsonl, stats: parsed.stats })

  const skip = skipReason(conv)
  if (skip) {
    log({ result: 'skip', reason: skip })
    return { ok: false, reason: skip, skipped: true }
  }

  const existing = await writer.findExisting(historyRoot, conv.session_id)
  const titleSrc: TitleSource = {
    cwd: conv.cwd,
    text: sampleEventText(conv.events),
    existingTitle: conv.title
  }

  // 转录未增长即无新内容：不重写五件套。但上次若因 claude 不可用而停在本地标题，
  // 这里是唯一的补起名时机——否则该对话会永远顶着本地规则标题（重导出总是走 unchanged）。
  if (existing && (await writer.transcriptUnchanged(existing, sourceJsonl))) {
    const meta = await writer.readExistingMeta(existing)
    log({ result: 'unchanged', dir: existing })
    const retitle = args.titleMode === 'llm' && needsLlmTitle(meta) && !isCoolingDown()
    if (!retitle) {
      return {
        ok: true,
        dir: existing,
        unchanged: true,
        meta: meta ?? undefined,
        titleSource: meta?.titleSource
      }
    }
    const r = await applyLlmTitle(
      args,
      { dir: existing, meta, titleSource: meta?.titleSource ?? 'local', titled: false },
      { ...titleSrc, existingTitle: meta?.title ?? conv.title },
      log
    )
    return {
      ok: true,
      dir: r.dir,
      unchanged: true,
      meta: r.meta ?? undefined,
      titleSource: r.titleSource,
      titled: r.titled
    }
  }

  const existingMeta = existing ? await writer.readExistingMeta(existing) : null
  const decided = decideTitle(existingMeta, titleSrc)
  if (decided.title) conv.title = decided.title

  const arts = engine.textArtifacts(conv, false)
  const category = conv.category || '其他'
  const targetDir = existing ?? path.join(historyRoot, category, writer.folderName(conv))

  let dir: string
  let meta: MetaJson
  try {
    const res = writer.writeExport(conv, arts, targetDir, sourceJsonl, false, decided.source)
    dir = res.dir
    meta = res.meta
  } catch (err) {
    const reason = `落盘失败：${(err as Error).message}`
    log({ result: 'write-failed', reason })
    return { ok: false, reason }
  }
  log({ result: 'written', dir, title: conv.title, titleSource: decided.source })

  const needsLlm =
    args.titleMode === 'llm' &&
    (!existing || decided.source === 'local' || isFallbackAllowed(existingMeta?.title))
  if (!needsLlm) {
    return { ok: true, dir, meta, titleSource: decided.source }
  }

  const r = await applyLlmTitle(
    args,
    { dir, meta, titleSource: decided.source, titled: false },
    { ...titleSrc, existingTitle: conv.title },
    log
  )
  return {
    ok: true,
    dir: r.dir,
    meta: r.meta ?? undefined,
    titleSource: r.titleSource,
    titled: r.titled
  }
}
