/**
 * 渲染 对话.md —— 完整保真的 Markdown 全文。
 *
 * 自 chat_export/render_md.py 忠实移植：标题元信息块 + 逐事件分节；工具入参以
 * json(indent=2) 围栏呈现；MARKDOWN_TOOLS 的返回按 md 直出并补全截断围栏。
 */
import * as paths from './paths'
import * as textutil from './textutil'
import * as timeutil from './timeutil'
import { EventType, type Conversation, type EventData } from './types'

const ICON: Record<EventType, string> = {
  [EventType.USER_PROMPT]: '🧑 用户提问',
  [EventType.THINKING]: '💭 Claude Code 思考',
  [EventType.ANSWER]: '🤖 Claude Code 回复',
  [EventType.TOOL_CALL]: '🔧 工具调用',
  [EventType.TOOL_RESULT]: '↩️ 工具返回'
}

/** 生成不会被内容里的反引号提前闭合的围栏代码块。 */
function fence(text: string): string {
  let longest = 0
  for (const m of (text || '').matchAll(/`+/g)) {
    longest = Math.max(longest, m[0].length)
  }
  const f = '`'.repeat(Math.max(3, longest + 1))
  return `${f}\n${text}\n${f}`
}

const FENCE_LINE = /^\s*(`{3,}|~{3,})/

/** 补全因截断而残留的未闭合代码围栏，避免污染整篇文档后续内容。 */
function balanceFences(md: string): string {
  let openMark: string | null = null
  for (const ln of (md || '').split(/\r\n|\r|\n/)) {
    const m = FENCE_LINE.exec(ln)
    if (!m) continue
    const mark = m[1]
    if (openMark === null) {
      openMark = mark
    } else if (mark[0] === openMark[0] && mark.length >= openMark.length) {
      openMark = null
    }
  }
  if (openMark !== null) {
    const sep = md && md.endsWith('\n') ? '' : '\n'
    return md + sep + openMark
  }
  return md
}

/** 对工具返回按文档阈值再截断；返回展示文本。 */
function docTruncate(ev: EventData, mdSafe = false): string {
  let [disp, wasTrunc] = textutil.truncateBytes(ev.text, paths.TRUNCATE_LIMIT_DOC)
  if (mdSafe && (wasTrunc || ev.truncated)) {
    disp = balanceFences(disp)
  }
  if (ev.truncated || wasTrunc) {
    const note = `\n\n> 注：完整返回约 ${ev.original_bytes} 字节，已截断展示。原文见 transcript.jsonl。`
    return disp + note
  }
  return disp
}

/** 渲染完整 Markdown 文本。 */
export function render(conv: Conversation): string {
  const out: string[] = []
  const title = conv.title || '未命名会话'
  out.push(`# ${title}\n`)
  out.push('> 会话元信息')
  out.push('>')
  out.push(`> - 类别：${conv.category || '其他'}`)
  out.push(`> - 会话ID：\`${conv.session_id || '未知'}\``)
  out.push(`> - 模型：${conv.model || '未知'}`)
  out.push(`> - 工作目录：\`${conv.cwd || '未知'}\``)
  out.push(`> - 开始：${timeutil.fmtFull(conv.started_at)}`)
  out.push(`> - 结束：${timeutil.fmtFull(conv.ended_at)}`)
  out.push(`> - 消息数：${conv.message_count}（提问 ${conv.user_prompt_count}）`)
  if (conv.any_truncated) {
    out.push('> - ⚠️ 含被截断的超大工具返回（完整内容见 transcript.jsonl）')
  }
  out.push(`> - 来源：\`${conv.source_path}\``)
  out.push('\n---\n')

  if (!conv.events.length) {
    out.push('_（本会话无可导出的主对话内容）_\n')
    return out.join('\n')
  }

  for (const ev of conv.events) {
    const t = timeutil.fmtTime(ev.timestamp)
    const ts = t ? ` \`${t}\`` : ''
    if (ev.etype === EventType.USER_PROMPT) {
      out.push(`## ${ICON[ev.etype]}${ts}\n`)
      out.push(ev.text.trim() || '_（空）_')
      for (const a of ev.attachments) {
        out.push(`\n> ${a.placeholder || '[附件]'}`)
      }
      out.push('')
    } else if (ev.etype === EventType.THINKING) {
      out.push(`### ${ICON[ev.etype]}${ts}\n`)
      const quoted = (ev.text || '')
        .split('\n')
        .map((ln) => '> ' + ln)
        .join('\n')
      out.push(quoted || '> _（空）_')
      out.push('')
    } else if (ev.etype === EventType.ANSWER) {
      out.push(`## ${ICON[ev.etype]}${ts}\n`)
      out.push(ev.text.trim() || '_（空）_')
      out.push('')
    } else if (ev.etype === EventType.TOOL_CALL) {
      const tail = ev.paired ? '' : '  ·（无返回，可能为后台 Agent）'
      out.push(`### ${ICON[ev.etype]} · \`${ev.tool_name || '?'}\`${ts}${tail}\n`)
      let inp: string
      try {
        inp = JSON.stringify(ev.tool_input, null, 2)
        if (inp === undefined) inp = String(ev.tool_input)
      } catch {
        inp = String(ev.tool_input)
      }
      out.push('入参：')
      out.push(fence(inp))
      out.push('')
    } else if (ev.etype === EventType.TOOL_RESULT) {
      const flag = ev.is_error ? '（错误）' : ''
      const orphan = ev.paired ? '' : '（孤立返回）'
      const name = ev.tool_name ? ` · \`${ev.tool_name}\`` : ''
      if (ev.tool_name && paths.MARKDOWN_TOOLS.includes(ev.tool_name) && ev.text.trim()) {
        // 这些"返回"实为 Claude 撰写的 Markdown（计划/子代理报告/技能正文），直接按 md 输出
        const head = ev.tool_name === 'ExitPlanMode' ? '📋 计划（已批准）' : `🔎 ${ev.tool_name} 结果`
        out.push(`### ${head}${ts}\n`)
        out.push(docTruncate(ev, true))
        out.push('')
      } else {
        out.push(`#### ${ICON[ev.etype]}${name}${flag}${orphan}${ts}\n`)
        out.push(fence(docTruncate(ev)))
        for (const a of ev.attachments) {
          out.push(`\n> ${a.placeholder || '[附件]'}`)
        }
        out.push('')
      }
    }
  }

  return out.join('\n')
}
