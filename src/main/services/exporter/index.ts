/**
 * 内置 TS 导出器对外 API（M7）。
 *
 * 自 ~/.claude/tools/chat_export（Python）忠实移植：解析 → 构建中间表示 → 分类/起标题 →
 * 渲染 md/html/js → 写 5 件套并原子落盘。供后续 M7.5 集成调用。
 */
import path from 'node:path'

import type { MetaJson } from '@shared/types'

import * as classifier from './classifier'
import * as engine from './engine'
import * as gate from './gate'
import * as jsonlParser from './jsonl-parser'
import * as model from './model'
import * as renderHtmlMod from './render-html'
import * as renderJsMod from './render-js'
import * as renderMdMod from './render-md'
import * as titler from './titler'
import * as writer from './writer'
import type { ParseResult } from './jsonl-parser'
import { type BuildOptions, type Conversation, type RawRecord } from './types'

// ---- 类型与底层模块再导出，便于集成层按需取用 ----
export * from './types'
export type { ParseResult } from './jsonl-parser'
export { build as buildFromTranscript, textArtifacts } from './engine'
export { encodeCwd, listSessions, activeSessionIds, quickInfo } from './session-locator'
export type { SessionEntry, QuickInfo } from './session-locator'

/** 解析 JSONL 转录为有效记录与统计。 */
export function parseJsonl(p: string): Promise<ParseResult> {
  return jsonlParser.readAll(p)
}

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

/** gate：是否值得导出（基于已解析记录，逻辑与 Python gate 一致）。 */
export function shouldExport(parsed: ParseResult): boolean {
  return gate.shouldExport(parsed)
}

/** 生成 meta.json 规范结构。 */
export function metaDict(conv: Conversation): MetaJson {
  return engine.metaDict(conv)
}

/** 渲染 对话.md 全文。 */
export function renderMd(conv: Conversation): string {
  return renderMdMod.render(conv)
}

/** 渲染 data.js 文件内容（含 window.CONVERSATION 包裹）。 */
export function renderJs(conv: Conversation, live = false): string {
  return renderJsMod.render(conv, live)
}

/** 渲染 data.js 的纯 JSON 负载（不含 window.CONVERSATION 包裹）。 */
export function renderJsSerialized(conv: Conversation, live = false): string {
  return renderJsMod.serialize(conv, live)
}

/** 渲染自包含 对话.html。 */
export function renderHtml(conv: Conversation, live = false): string {
  return renderHtmlMod.render(conv, live)
}

/** 计算导出目录名（不落盘）。 */
export function folderName(conv: Conversation): string {
  return writer.folderName(conv)
}

export interface ExportArgs {
  sourceJsonl: string
  historyRoot: string
}

export interface ExportOutcome {
  ok: boolean
  dir?: string
  meta?: MetaJson
  reason?: string
}

/** 高层导出：解析 → gate → build → 分类 → 渲染 → 写 5 件套，原子落盘到
 * `historyRoot/<category>/<folderName>/`；已存在同 sessionId 则覆盖其目录。
 * gate 不通过返回 { ok:false, reason }。
 */
export async function exportSession(args: ExportArgs): Promise<ExportOutcome> {
  const { sourceJsonl, historyRoot } = args
  let parsed: ParseResult
  try {
    parsed = await jsonlParser.readAll(sourceJsonl)
  } catch (err) {
    return { ok: false, reason: `读取或解析转录失败：${(err as Error).message}` }
  }

  if (!gate.shouldExport(parsed)) {
    return { ok: false, reason: '未达导出门槛（助手回合或实质消息不足）' }
  }

  const conv = buildConversation(parsed.records, { sourcePath: sourceJsonl, stats: parsed.stats })
  const arts = engine.textArtifacts(conv, false)
  const category = conv.category || '其他'
  const existing = await writer.findExisting(historyRoot, conv.session_id)
  const targetDir = existing ?? path.join(historyRoot, category, writer.folderName(conv))

  try {
    const res = writer.writeExport(conv, arts, targetDir, sourceJsonl, false)
    return { ok: true, dir: res.dir, meta: res.meta }
  } catch (err) {
    return { ok: false, reason: `落盘失败：${(err as Error).message}` }
  }
}
