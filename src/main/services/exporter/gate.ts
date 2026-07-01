/**
 * 导出阈值：统计后跳过琐碎/空会话。
 *
 * 自 chat_export/gate.py 移植。计数口径与 model.buildConversation 对齐：助手回合只要含
 * text/thinking/tool_use 任一块即记为一次实质助手动作。
 */
import * as paths from './paths'
import * as textutil from './textutil'
import type { ParseResult } from './jsonl-parser'

const ASSIST_BLOCKS = ['text', 'thinking', 'tool_use']

function assistantSubstantive(content: unknown): boolean {
  if (typeof content === 'string') return Boolean(content.trim())
  if (Array.isArray(content)) {
    return content.some(
      (b) => b && typeof b === 'object' && ASSIST_BLOCKS.includes((b as Record<string, unknown>).type as string)
    )
  }
  return false
}

/** 是否为真实用户提问（区别于纯工具结果回传）。 */
function userPrompt(content: unknown): boolean {
  if (typeof content === 'string') {
    return Boolean(content.trim()) && !textutil.isNoise(content)
  }
  if (Array.isArray(content)) {
    const hasPromptBlock = content.some(
      (b) =>
        typeof b === 'string' ||
        (b && typeof b === 'object' && ['text', 'image'].includes((b as Record<string, unknown>).type as string))
    )
    if (!hasPromptBlock) return false
    const texts = content
      .filter(
        (b) => typeof b === 'string' || (b && typeof b === 'object' && (b as Record<string, unknown>).type === 'text')
      )
      .map((b) => (typeof b === 'string' ? b : ((b as Record<string, unknown>).text as string) || ''))
      .join('\n')
    // 纯图片提问（无文本）也算一次实质提问
    if (!texts.trim()) {
      return content.some((b) => b && typeof b === 'object' && (b as Record<string, unknown>).type === 'image')
    }
    return !textutil.isNoise(texts)
  }
  return false
}

/** 统计 (assistant 实质回合数, 实质消息数)。接受已解析的记录列表。 */
export function stats(parsed: ParseResult): [number, number] {
  let assistants = 0
  let substantive = 0
  for (const o of parsed.records) {
    if (o['isSidechain'] || o['isMeta']) continue
    const t = o['type']
    const msg = o['message']
    const content =
      msg && typeof msg === 'object' && !Array.isArray(msg) ? (msg as Record<string, unknown>)['content'] : undefined
    if (t === 'assistant' && assistantSubstantive(content)) {
      assistants += 1
      substantive += 1
    } else if (t === 'user' && userPrompt(content)) {
      substantive += 1
    }
  }
  return [assistants, substantive]
}

/** 是否应导出：≥1 助手实质回合 且 ≥2 实质消息。 */
export function shouldExport(parsed: ParseResult): boolean {
  const [a, s] = stats(parsed)
  return a >= paths.MIN_ASSISTANT && s >= paths.MIN_SUBSTANTIVE
}
