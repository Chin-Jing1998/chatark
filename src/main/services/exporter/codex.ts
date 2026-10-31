/**
 * Codex rollout JSONL 转录适配层。
 * 作者：Chin_Jing1998；修订日期：2026-10-31（北京时间）。
 *
 * 将 ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl 与 ~/.codex/archived_sessions/*.jsonl
 * 的原始记录无损归一化为标准 Claude Code RawRecord[]，复用既有 gate / model / titler /
 * classifier / render 全套导出流水线。
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import * as paths from './paths'
import * as textutil from './textutil'
import type { RawRecord } from './types'

const CODEX_TOP_TYPES = new Set([
  'session_meta',
  'turn_context',
  'response_item',
  'event_msg',
  'world_state',
  'token_usage_record',
  'compacted',
  'retained_context'
])

const CODEX_SYSTEM_TAG_BLOCK =
  /<(INSTRUCTIONS|environment_context|skills_instructions|permissions instructions|collaboration_mode|apps_instructions|external_codex_apps_open_page|subagent_notification|turn_aborted)[^>]*>[\s\S]*?<\/\1>/gi

const AGENTS_HEADER_AND_BLOCK =
  /(?:^|\n)#\s*AGENTS\.md instructions[^\n]*\n*(?:<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>\s*)?/gi

const COMPACTION_SUFFIX =
  /Another language model started to solve this problem and produced a summary of its thinking process\.[\s\S]*$/

const QUESTION_REPLY_BLOCK =
  /<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>/gi

const LEADING_EMOJI_RE = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]\uFE0F?\s+/u

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

/** 判断记录列表是否为 Codex rollout JSONL 格式。 */
export function isCodexTranscript(records: readonly RawRecord[]): boolean {
  for (const r of records) {
    const t = r['type']
    if (
      (t === 'session_meta' || t === 'turn_context' || t === 'response_item') &&
      asObject(r['payload']) !== null
    ) {
      return true
    }
    if (t === 'user' || t === 'assistant' || t === 'custom-title') {
      return false
    }
    if (typeof t === 'string' && !CODEX_TOP_TYPES.has(t)) {
      return false
    }
  }
  return false
}

/** 将 `<send_user_message_question_reply>` JSON 载荷转为可读回答文本。 */
function formatQuestionReply(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      const lines: string[] = []
      for (const item of parsed) {
        const obj = asObject(item)
        if (!obj) continue
        const ans = obj['answer'] ?? obj['value'] ?? obj['selected']
        if (typeof ans === 'string' && ans.trim()) lines.push(ans.trim())
        else if (Array.isArray(ans)) lines.push(ans.map(String).join('、'))
      }
      if (lines.length > 0) return lines.join('\n')
    }
  } catch {
    // 非 JSON 则保留原文
  }
  return raw.trim()
}

/**
 * 剥离 Codex 注入在用户消息中的系统指令块（AGENTS.md、environment_context 等）
 * 以及上下文压缩自动追加的交接摘要尾巴，仅保留用户真实输入。
 */
export function stripCodexInjectedText(raw: string): string {
  if (!raw) return ''
  let s = raw.replace(AGENTS_HEADER_AND_BLOCK, '\n')
  s = s.replace(CODEX_SYSTEM_TAG_BLOCK, '\n')
  s = s.replace(COMPACTION_SUFFIX, '')
  s = s.replace(QUESTION_REPLY_BLOCK, (_, inner: string) => formatQuestionReply(inner))
  const trimmed = s.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('# AGENTS.md instructions')) return ''
  return trimmed
}

/** 判断路径是否位于本机 Codex 会话目录内。 */
function isUnderCodexRoot(filePath?: string): boolean {
  if (!filePath) return false
  const resolved = path.resolve(filePath)
  const roots = [paths.CODEX_SESSIONS_ROOT, paths.CODEX_ARCHIVED_ROOT]
  return roots.some((r) => {
    const root = path.resolve(r)
    return resolved === root || resolved.startsWith(root + path.sep)
  })
}

/** 从 ~/.codex/session_index.jsonl 查找指定 sessionId 的最新 thread_name。 */
export function lookupCodexThreadTitle(
  sessionId: string,
  indexPath = paths.CODEX_SESSION_INDEX
): string | null {
  if (!sessionId || !indexPath) return null
  let content: string
  try {
    content = fs.readFileSync(indexPath, 'utf-8')
  } catch {
    return null
  }
  let found: string | null = null
  for (const rawLine of content.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim()
    if (!line || !line.includes(sessionId)) continue
    try {
      const obj = asObject(JSON.parse(line))
      if (obj && obj['id'] === sessionId && typeof obj['thread_name'] === 'string') {
        const name = obj['thread_name'].replace(LEADING_EMOJI_RE, '').trim()
        if (name) found = name
      }
    } catch {
      continue
    }
  }
  return found
}

/** 从 Codex 文件名（如 rollout-2026-10-31T20-29-01-<uuid>.jsonl）提取 sessionId。 */
export function extractCodexSessionIdFromFilename(filePath: string): string {
  const base = path.basename(filePath).replace(/\.jsonl$/i, '')
  const m = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
  return m ? m[1] : base
}

/** 归一化 Codex 工具调用输出为 normalizeToolResultContent 可消费的字符串或块数组。 */
function normalizeCodexToolOutput(output: unknown): unknown {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) {
    const outBlocks: Array<Record<string, unknown>> = []
    for (const item of output) {
      const b = asObject(item)
      if (!b) {
        if (typeof item === 'string') outBlocks.push({ type: 'text', text: item })
        continue
      }
      const bt = b['type']
      if (bt === 'input_text' || bt === 'output_text' || bt === 'text') {
        outBlocks.push({ type: 'text', text: String(b['text'] ?? '') })
      } else if (bt === 'input_image' || bt === 'image') {
        const url = typeof b['image_url'] === 'string' ? b['image_url'] : String(b['data'] ?? '')
        outBlocks.push({
          type: 'image',
          source: { media_type: String(b['media_type'] ?? 'image/png'), data: url }
        })
      } else {
        outBlocks.push({ type: 'text', text: JSON.stringify(b) })
      }
    }
    return outBlocks
  }
  if (output !== null && output !== undefined) {
    return JSON.stringify(output, null, 2)
  }
  return ''
}

export interface CodexNormalizeOptions {
  sourcePath?: string
  /** 显式传入的会话标题；未传且 sourcePath 位于 ~/.codex 下时自动查 session_index.jsonl */
  threadTitle?: string | null
  /** 自定义 session_index.jsonl 路径（供测试注入） */
  sessionIndexPath?: string
}

/**
 * 将 Codex rollout JSONL 记录流转换为标准 Claude Code RawRecord[]。
 */
export function normalizeCodexRecords(
  records: readonly RawRecord[],
  opts: CodexNormalizeOptions = {}
): RawRecord[] {
  const out: RawRecord[] = []
  let sessionId = opts.sourcePath ? extractCodexSessionIdFromFilename(opts.sourcePath) : ''
  let cwd = ''
  let gitBranch = ''
  let model: string | null = null

  // 第一遍先收集头部的 session_meta / turn_context，确保首条消息即具备完整元数据
  for (const r of records) {
    const kind = r['type']
    const p = asObject(r['payload'])
    if (!p) continue
    if (kind === 'session_meta') {
      const sid = p['id'] ?? p['session_id']
      if (typeof sid === 'string' && sid) sessionId = sid
      if (typeof p['cwd'] === 'string' && p['cwd']) cwd = p['cwd']
      const git = asObject(p['git'])
      if (git && typeof git['branch'] === 'string' && git['branch']) {
        gitBranch = git['branch']
      }
    } else if (kind === 'turn_context') {
      if (!cwd && typeof p['cwd'] === 'string' && p['cwd']) cwd = p['cwd']
      if (!model && typeof p['model'] === 'string' && p['model']) model = p['model']
    }
  }

  // 若存在显式 threadTitle 或在 ~/.codex/session_index.jsonl 中登记了标题，注入 custom-title
  const resolvedTitle =
    opts.threadTitle !== undefined
      ? opts.threadTitle
      : opts.sessionIndexPath || isUnderCodexRoot(opts.sourcePath)
        ? lookupCodexThreadTitle(sessionId, opts.sessionIndexPath)
        : null
  if (resolvedTitle && resolvedTitle.trim()) {
    out.push({
      type: 'custom-title',
      customTitle: resolvedTitle.trim(),
      sessionId
    })
  }

  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    const kind = r['type']
    const p = asObject(r['payload'])
    if (!p) continue

    if (kind === 'session_meta') {
      const sid = p['id'] ?? p['session_id']
      if (typeof sid === 'string' && sid) sessionId = sid
      if (typeof p['cwd'] === 'string' && p['cwd']) cwd = p['cwd']
      const git = asObject(p['git'])
      if (git && typeof git['branch'] === 'string' && git['branch']) {
        gitBranch = git['branch']
      }
      continue
    }

    if (kind === 'turn_context') {
      if (typeof p['cwd'] === 'string' && p['cwd']) cwd = p['cwd']
      if (typeof p['model'] === 'string' && p['model']) model = p['model']
      continue
    }

    if (kind !== 'response_item') continue

    const ts = typeof r['timestamp'] === 'string' ? r['timestamp'] : null
    const itemType = p['type']
    let role: 'user' | 'assistant' | null = null
    const blocks: Array<Record<string, unknown>> = []

    if (itemType === 'message' && (p['role'] === 'user' || p['role'] === 'assistant')) {
      const msgRole = p['role'] as 'user' | 'assistant'
      role = msgRole
      const content = Array.isArray(p['content']) ? p['content'] : []
      for (const blkRaw of content) {
        const b = asObject(blkRaw)
        if (!b) continue
        const bt = b['type']
        if (bt === 'input_text' || bt === 'output_text' || bt === 'text') {
          const rawText = typeof b['text'] === 'string' ? b['text'] : ''
          const cleaned = msgRole === 'user' ? stripCodexInjectedText(rawText) : rawText
          if (!cleaned.trim()) continue
          if (msgRole === 'user' && textutil.isNoise(cleaned)) continue
          blocks.push({ type: 'text', text: cleaned })
        } else if (bt === 'input_image' || bt === 'image') {
          const url =
            typeof b['image_url'] === 'string' ? b['image_url'] : String(b['data'] ?? '')
          blocks.push({
            type: 'image',
            source: {
              media_type: String(b['media_type'] ?? 'image/png'),
              data: url
            }
          })
        }
      }
    } else if (itemType === 'reasoning') {
      const parts: string[] = []
      const summary = Array.isArray(p['summary']) ? p['summary'] : []
      for (const sRaw of summary) {
        const s = asObject(sRaw)
        if (s && typeof s['text'] === 'string' && s['text'].trim()) {
          parts.push(s['text'].trim())
        }
      }
      const content = Array.isArray(p['content']) ? p['content'] : []
      for (const cRaw of content) {
        const c = asObject(cRaw)
        if (c && typeof c['text'] === 'string' && c['text'].trim()) {
          parts.push(c['text'].trim())
        }
      }
      const thinking = parts.join('\n\n').trim()
      if (thinking) {
        role = 'assistant'
        blocks.push({ type: 'thinking', thinking })
      }
    } else if (
      itemType === 'function_call' ||
      itemType === 'custom_tool_call' ||
      itemType === 'tool_search_call'
    ) {
      role = 'assistant'
      const rawArgs = p['arguments'] ?? p['input'] ?? p['query'] ?? {}
      let parsedInput: Record<string, unknown>
      if (typeof rawArgs === 'string') {
        try {
          const parsed: unknown = JSON.parse(rawArgs)
          parsedInput = asObject(parsed) ?? { input: rawArgs }
        } catch {
          parsedInput = { input: rawArgs }
        }
      } else {
        parsedInput = asObject(rawArgs) ?? { input: rawArgs }
      }
      const defaultName = itemType === 'tool_search_call' ? 'tool_search' : 'tool'
      blocks.push({
        type: 'tool_use',
        id: String(p['call_id'] ?? p['id'] ?? ''),
        name: String(p['name'] ?? defaultName),
        input: parsedInput
      })
    } else if (
      itemType === 'function_call_output' ||
      itemType === 'custom_tool_call_output' ||
      itemType === 'tool_search_output'
    ) {
      role = 'user'
      blocks.push({
        type: 'tool_result',
        tool_use_id: String(p['call_id'] ?? p['id'] ?? ''),
        content: normalizeCodexToolOutput(p['output'] ?? p['tools'] ?? '')
      })
    }

    if (role && blocks.length > 0) {
      const uuid = createHash('sha256')
        .update(`${sessionId}:${i}`)
        .digest('hex')
      out.push({
        type: role,
        uuid,
        sessionId,
        cwd,
        gitBranch: gitBranch || null,
        timestamp: ts,
        message: {
          role,
          ...(role === 'assistant' && model ? { model } : {}),
          content: blocks
        }
      })
    }
  }

  // 若全文尚无任何消息携带 sessionId/cwd，但头部解析到了，注入一条轻量元数据占位供 buildConversation 取用
  if (out.length === 0 && (sessionId || cwd)) {
    out.push({
      type: 'meta',
      isMeta: true,
      sessionId,
      cwd,
      gitBranch: gitBranch || null
    })
  }

  return out
}
