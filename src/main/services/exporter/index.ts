/**
 * 内置 TS 导出器对外 API（M7）。
 *
 * 自 ~/.claude/tools/chat_export（Python）忠实移植：解析 → 构建中间表示 → 分类/起标题 →
 * 渲染 md/html/js → 写 5 件套并原子落盘。供后续 M7.5 集成调用。
 */
import type { MetaJson } from '@shared/types'

import * as engine from './engine'
import * as gate from './gate'
import * as jsonlParser from './jsonl-parser'
import * as renderHtmlMod from './render-html'
import * as renderJsMod from './render-js'
import * as renderMdMod from './render-md'
import * as writer from './writer'
import type { ParseResult } from './jsonl-parser'
import { type Conversation } from './types'

// ---- 类型与底层模块再导出，便于集成层按需取用 ----
export * from './types'
export type { ParseResult } from './jsonl-parser'
export { build as buildFromTranscript, textArtifacts } from './engine'
export { encodeCwd, listSessions, activeSessionIds, quickInfo } from './session-locator'
export type { SessionEntry, QuickInfo } from './session-locator'
export {
  extractCodexSessionIdFromFilename,
  isCodexTranscript,
  lookupCodexThreadTitle,
  normalizeCodexRecords,
  stripCodexInjectedText
} from './codex'

// ---- 导出主流程（先落盘后起名，实现见 export-session.ts）----
export { buildConversation, exportSession, skipReason } from './export-session'
export type { BuildConvOptions, ExportArgs, ExportOutcome, LogFields } from './export-session'

/** 解析 JSONL 转录为有效记录与统计。 */
export function parseJsonl(p: string): Promise<ParseResult> {
  return jsonlParser.readAll(p)
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
