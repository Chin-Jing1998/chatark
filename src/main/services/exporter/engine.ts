/**
 * 导出引擎编排：transcript → Conversation → 文本产物 / 元信息。
 *
 * 自 chat_export/engine.py 移植。meta_dict 字段顺序与 @shared/types 的 MetaJson 对齐。
 */
import type { MetaJson } from '@shared/types'

import * as classifier from './classifier'
import * as jsonlParser from './jsonl-parser'
import * as model from './model'
import * as paths from './paths'
import * as renderHtml from './render-html'
import * as renderJs from './render-js'
import * as renderMd from './render-md'
import * as timeutil from './timeutil'
import * as titler from './titler'
import { EventType, type Conversation } from './types'

export const MD_NAME = paths.MD_NAME
export const HTML_NAME = paths.HTML_NAME
export const JS_NAME = paths.JS_NAME
export const META_NAME = paths.META_NAME
export const TRANSCRIPT_NAME = paths.TRANSCRIPT_NAME

/** 解析转录并构建带分类、标题的 Conversation。 */
export async function build(transcriptPath: string): Promise<Conversation> {
  const { records, stats } = await jsonlParser.readAll(transcriptPath)
  const conv = model.buildConversation(records, { sourcePath: transcriptPath })
  conv.category = classifier.classify(conv)
  conv.title = titler.makeTitle(conv)
  conv.warnings = []
  if (stats.bad_lines) {
    conv.warnings.push(`跳过 ${stats.bad_lines} 坏行`)
  }
  conv.parse_stats = stats
  return conv
}

/** 从已构建的记录列表直接构建（供调用方复用解析结果，避免二次读盘）。 */
export function buildFromRecords(
  records: ReturnType<typeof jsonlParser.parseText>['records'],
  stats: ReturnType<typeof jsonlParser.parseText>['stats'],
  sourcePath: string
): Conversation {
  const conv = model.buildConversation(records, { sourcePath })
  conv.category = classifier.classify(conv)
  conv.title = titler.makeTitle(conv)
  conv.warnings = []
  if (stats.bad_lines) {
    conv.warnings.push(`跳过 ${stats.bad_lines} 坏行`)
  }
  conv.parse_stats = stats
  return conv
}

export interface TextArtifacts {
  [name: string]: string
}

/** 生成不依赖落盘的文本产物（live=true 表示会话进行中的轻量同步）。 */
export function textArtifacts(conv: Conversation, live = false): TextArtifacts {
  return {
    [MD_NAME]: renderMd.render(conv),
    [HTML_NAME]: renderHtml.render(conv, live),
    [JS_NAME]: renderJs.render(conv, live)
  }
}

/** 生成 meta.json 的规范结构（字段顺序与 Python meta_dict 一致）。
 *
 * 注意：model / startedAt / endedAt 为空时保留 JSON null（与 Python 的 None 落盘一致），
 * 不退化为 undefined（否则键被 JSON.stringify 丢弃，造成与原始产物的字段差异）。
 */
export function metaDict(conv: Conversation): MetaJson {
  const truncatedEvents = conv.events
    .filter((e) => e.truncated)
    .map((e) => ({
      seq: e.seq,
      type: e.etype as EventType as string,
      tool: e.tool_name,
      originalBytes: e.original_bytes
    }))
  const meta: Record<string, unknown> = {
    schemaVersion: 1,
    sessionId: conv.session_id,
    title: conv.title,
    category: conv.category,
    model: conv.model,
    cwd: conv.cwd,
    gitBranch: conv.git_branch,
    startedAt: conv.started_at,
    endedAt: conv.ended_at,
    messageCount: conv.message_count,
    userPromptCount: conv.user_prompt_count,
    assistantCount: conv.assistant_count,
    anyTruncated: conv.any_truncated,
    truncatedEvents,
    sourcePath: conv.source_path,
    exportedAt: timeutil.nowIso(),
    warnings: conv.warnings,
    parseStats: conv.parse_stats
  }
  return meta as MetaJson
}
