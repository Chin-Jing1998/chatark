/**
 * 标题推导：custom-title 优先 → 首条有效提问 → 兜底。
 *
 * 自 chat_export/titler.py 移植。按字符（码点）计长，中文不被腰斩。
 */
import * as textutil from './textutil'
import { EventType, type Conversation } from './types'

const DEFAULT_TITLE = '未命名会话'

/** 按码点切片到 maxLen（对齐 Python t[:max_len]）。 */
function sliceCodepoints(s: string, max: number): string {
  const arr = Array.from(s)
  return arr.length <= max ? s : arr.slice(0, max).join('')
}

/** 返回清洗后的标题。 */
export function makeTitle(conv: Conversation, maxLen = 30): string {
  if (conv.title && conv.title.trim()) {
    const t = textutil.cleanInline(conv.title)
    if (t) return sliceCodepoints(t, maxLen)
  }

  for (const e of conv.events) {
    if (e.etype === EventType.USER_PROMPT && e.text.trim()) {
      const t = textutil.cleanInline(e.text)
      if (t) return sliceCodepoints(t, maxLen)
    }
  }

  return DEFAULT_TITLE
}
