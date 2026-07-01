/**
 * 纯文本工具函数集：清洗、净化文件名、按字节截断、归一工具返回内容。
 *
 * 自 chat_export/textutil.py 忠实移植。全部为无副作用纯函数，便于独立单元测试。
 */
import { Buffer } from 'node:buffer'

import type { Attachment } from './types'

// 注入式 / 命令包装类噪声前缀（过滤非用户真实输入）
const NOISE_PREFIXES: readonly string[] = [
  '<command-name>',
  '<command-message>',
  '<command-args>',
  '<local-command',
  '<system-reminder>',
  '<bash-',
  '<user-memory',
  '<example>',
  'Caveat:',
  '[Request interrupted',
  'Base directory for this skill:',
  '<task-notification>',
  'This session is being continued',
  '<user-prompt-submit-hook',
  '<session-start-hook'
]

// 文件名非法字符（Windows + Unix）+ 控制符
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g

// Claude Code 注入到用户消息里的尖括号指令块，标题清洗时整段剥离
const INJECT_BLOCK =
  /<(command-name|command-message|command-args|local-command-stdout|system-reminder|user-memory-input|task-notification)[^>]*>[\s\S]*?<\/\1>/g
const INJECT_OPEN = /<[a-z][a-z0-9-]*(?:\s[^>]*)?>/g // 残留开标签
const MD_MARKS = /[#*`>_~[\]]/g

/** 判断一段文本是否为注入式噪声（非用户真实输入）。 */
export function isNoise(text: string): boolean {
  const lt = (text || '').replace(/^\s+/, '')
  return NOISE_PREFIXES.some((p) => lt.startsWith(p))
}

/** 从 message.content 抽出纯文本，兼容字符串与 block 数组。 */
export function extractText(content: unknown): string {
  if (content === null || content === undefined) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const b of content) {
      if (b && typeof b === 'object' && (b as Record<string, unknown>).type === 'text') {
        parts.push(((b as Record<string, unknown>).text as string) || '')
      } else if (typeof b === 'string') {
        parts.push(b)
      }
    }
    return parts.join('\n')
  }
  return ''
}

/** 折叠所有空白为单空格并去首尾。 */
export function collapse(t: string): string {
  return (t || '').replace(/\s+/g, ' ').trim()
}

/** 清洗为适合做标题的单行文本：剥离注入指令块、Markdown 标记、折叠空白。 */
export function cleanInline(t: string): string {
  if (!t) return ''
  let s = t.replace(INJECT_BLOCK, ' ')
  s = s.replace(INJECT_OPEN, ' ')
  s = s.replace(MD_MARKS, '')
  return collapse(s)
}

/** 按码点切片（与 Python 的 s[:n] 字符切片一致，中文/emoji 不被腰斩）。 */
function sliceCodepoints(s: string, max: number): string {
  const arr = Array.from(s)
  return arr.length <= max ? s : arr.slice(0, max).join('')
}

/** 去除两端属于给定字符集合的字符（对应 Python str.strip(chars)）。 */
function stripChars(s: string, chars: string): string {
  let start = 0
  let end = s.length
  while (start < end && chars.includes(s[start])) start++
  while (end > start && chars.includes(s[end - 1])) end--
  return s.slice(start, end)
}

/** 仅去除右端属于给定字符集合的字符（对应 Python str.rstrip(chars)）。 */
function rstripChars(s: string, chars: string): string {
  let end = s.length
  while (end > 0 && chars.includes(s[end - 1])) end--
  return s.slice(0, end)
}

/** 把任意字符串净化为合法的文件/目录名（按字符计长，兼容中文）。 */
export function sanitizeFilename(name: string, maxLen = 50, def = '未命名'): string {
  let s = (name || '').replace(ILLEGAL, '')
  s = s.trim().replace(/\s+/g, '_')
  s = stripChars(s.replace(/_+/g, '_'), '_.')
  s = rstripChars(sliceCodepoints(s, maxLen), '_.')
  return s || def
}

/** 在合法 UTF-8 缓冲区内，按字节切片 [start,end) 并丢弃首尾不完整的多字节序列。
 *
 * 对应 Python `raw[start:end].decode("utf-8", "ignore")` 在“原本合法、仅被切断”
 * 场景下的行为：丢弃（而非以 U+FFFD 替换）切口处的残缺字节。
 */
function decodeUtf8IgnoreSlice(buf: Buffer, start: number, end: number): string {
  // 跳过开头的连续“后续字节”（0b10xxxxxx）——属于前一字符被切掉的尾巴
  let s = start
  while (s < end && (buf[s] & 0xc0) === 0x80) s++
  // 回退末尾不完整的多字节序列：找到最后一个首字节，校验其长度是否落在 end 内
  let p = end - 1
  while (p >= s && (buf[p] & 0xc0) === 0x80) p--
  let e = end
  if (p >= s) {
    const lead = buf[p]
    let len = 1
    if (lead >= 0xf0) len = 4
    else if (lead >= 0xe0) len = 3
    else if (lead >= 0xc0) len = 2
    if (p + len > end) e = p // 不完整 → 丢弃这段残缺序列
  }
  return buf.subarray(s, e).toString('utf-8')
}

/** 按 UTF-8 字节安全截断，保头 90% + 尾 10%，避免破坏多字节字符。
 *
 * 返回 [文本, 是否截断, 原始字节数, 展示字节数]。
 */
export function truncateBytes(s: string, limit: number): [string, boolean, number, number] {
  const raw = Buffer.from(s, 'utf-8')
  if (raw.length <= limit) {
    return [s, false, raw.length, raw.length]
  }
  const head = Math.floor(limit * 0.9)
  const tail = Math.max(limit - head, 0)
  const h = decodeUtf8IgnoreSlice(raw, 0, head)
  const t = tail ? decodeUtf8IgnoreSlice(raw, raw.length - tail, raw.length) : ''
  const omitted = raw.length - Buffer.byteLength(h, 'utf-8') - Buffer.byteLength(t, 'utf-8')
  const marker = `\n\n[... 已截断 ${omitted} 字节，原始共 ${raw.length} 字节 ...]\n\n`
  const out = h + marker + t
  return [out, true, raw.length, Buffer.byteLength(out, 'utf-8')]
}

/** 把 tool_result.content（str | list[block]）归一为 [纯文本, 附件占位列表]。 */
export function normalizeToolResultContent(content: unknown): [string, Attachment[]] {
  if (typeof content === 'string') {
    return [content, []]
  }
  const parts: string[] = []
  const atts: Attachment[] = []
  if (Array.isArray(content)) {
    for (const b of content) {
      if (!b || typeof b !== 'object') {
        if (typeof b === 'string') parts.push(b)
        continue
      }
      const blk = b as Record<string, unknown>
      const bt = blk.type
      if (bt === 'text') {
        parts.push((blk.text as string) || '')
      } else if (bt === 'image') {
        const src = (blk.source as Record<string, unknown>) || {}
        const data = (src.data as string) || ''
        const media = (src.media_type as string) || ''
        const att: Attachment = {
          kind: 'image',
          media_type: media,
          bytes: data.length,
          data,
          placeholder: `[图片 ${media}, base64 约 ${data.length} 字节，已省略]`
        }
        atts.push(att)
        parts.push(att.placeholder)
      } else if (bt === 'tool_reference') {
        parts.push(`[tool_reference: ${(blk.name as string) || (blk.id as string) || ''}]`)
      } else {
        // 未知块类型：尽量保留可读字段
        const txt = (blk.text as unknown) ?? (blk.content as unknown)
        if (typeof txt === 'string') parts.push(txt)
      }
    }
  }
  return [parts.filter((p) => p !== null && p !== undefined).join('\n'), atts]
}
