/**
 * 渲染 data.js / 内嵌数据 —— 结构化对话数据，供查看器与程序二次开发。
 *
 * 自 chat_export/render_js.py 忠实移植。关键点：序列化须与 Python
 * json.dumps(ensure_ascii=False) 字节对齐 —— 逗号后、冒号后均带一个空格
 * （JS 原生 JSON.stringify 默认无空格），故自实现 Python 风格序列化器。
 */
import * as timeutil from './timeutil'
import { type Conversation } from './types'

/** 以 Python json.dumps(ensure_ascii=False) 的格式序列化任意值。
 *
 * 分隔符固定为 ", " 与 ": "；字符串转义沿用 JS 原生 JSON.stringify（与 Python 对
 * `"`、`\\`、控制符的处理一致，且都保留非 ASCII、`<`、`/` 与 U+2028/2029 字面量）。
 */
function pyJson(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  const t = typeof v
  if (t === 'boolean') return v ? 'true' : 'false'
  if (t === 'number') {
    const n = v as number
    if (!Number.isFinite(n)) {
      // 对齐 Python 默认 allow_nan=True 的字面量
      if (Number.isNaN(n)) return 'NaN'
      return n > 0 ? 'Infinity' : '-Infinity'
    }
    return String(n)
  }
  if (t === 'string') return JSON.stringify(v)
  if (Array.isArray(v)) {
    return '[' + v.map((x) => pyJson(x)).join(', ') + ']'
  }
  if (t === 'object') {
    const obj = v as Record<string, unknown>
    const parts: string[] = []
    for (const k of Object.keys(obj)) {
      parts.push(JSON.stringify(k) + ': ' + pyJson(obj[k]))
    }
    return '{' + parts.join(', ') + '}'
  }
  return String(v)
}

/** 构建查看器/二次开发用的结构化负载（键顺序与 Python 完全一致）。 */
export function buildPayload(conv: Conversation, live = false): Record<string, unknown> {
  const events = conv.events.map((ev) => ({
    seq: ev.seq,
    type: ev.etype as string,
    role: ev.role,
    time: timeutil.fmtTime(ev.timestamp),
    timeRaw: ev.timestamp,
    text: ev.text,
    toolName: ev.tool_name,
    toolInput: ev.tool_input,
    isError: ev.is_error,
    truncated: ev.truncated,
    originalBytes: ev.original_bytes,
    paired: ev.paired,
    attachments: ev.attachments.map((a) => ({
      kind: a.kind,
      mediaType: a.media_type,
      bytes: a.bytes,
      placeholder: a.placeholder
    }))
  }))
  return {
    meta: {
      sessionId: conv.session_id,
      title: conv.title || '未命名会话',
      category: conv.category || '其他',
      model: conv.model,
      cwd: conv.cwd,
      gitBranch: conv.git_branch,
      startedAt: conv.started_at,
      endedAt: conv.ended_at,
      startedAtLocal: timeutil.fmtFull(conv.started_at),
      endedAtLocal: timeutil.fmtFull(conv.ended_at),
      messageCount: conv.message_count,
      userPromptCount: conv.user_prompt_count,
      anyTruncated: conv.any_truncated,
      sourcePath: conv.source_path,
      // True=会话进行中(轻量同步)；False=已结束/终态，查看器据此自动停实时
      live: Boolean(live)
    },
    events
  }
}

/** 经安全转义的 JSON 字符串（不含 window.CONVERSATION 包裹）。
 *
 * `<`→< 防止内联 <script> 场景下 </script> 提前截断；
 * U+2028/U+2029 行分隔符转义，避免破坏 JS 字符串字面量。
 */
export function serialize(conv: Conversation, live = false): string {
  const body = pyJson(buildPayload(conv, live))
  const LS = String.fromCharCode(0x2028) // U+2028 行分隔符
  const PS = String.fromCharCode(0x2029) // U+2029 段分隔符
  // 用 split/join 实现纯字面量替换（对齐 Python str.replace 语义，不触发 $ 特殊处理）
  return body.split('<').join('\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029')
}

/** 渲染 data.js 文件内容。 */
export function render(conv: Conversation, live = false): string {
  return 'window.CONVERSATION = ' + serialize(conv, live) + ';\n'
}
