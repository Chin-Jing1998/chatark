/**
 * 规范化中间表示：把原始 JSONL 记录流转成 Conversation / Event。
 *
 * 自 chat_export/model.py 的 build_conversation 忠实移植。渲染器只依赖本模块产出的
 * 数据结构，不再触碰原始 JSON。
 */
import { isCodexTranscript, normalizeCodexRecords } from './codex'
import * as paths from './paths'
import * as textutil from './textutil'
import * as timeutil from './timeutil'
import {
  EventType,
  makeConversation,
  makeEvent,
  type Attachment,
  type BuildOptions,
  type Conversation,
  type EventData,
  type RawRecord
} from './types'

/** 时间戳排序键：能解析则 [0, 毫秒] 比较，否则 [1, 原串] 并排到末尾。 */
type SortKey = [number, number | string]

function tsSortKey(ts: string | null): SortKey {
  const dt = timeutil.parseIso(ts)
  return dt ? [0, dt.getTime()] : [1, ts || '']
}

/** 比较两个排序键：<0 表示 a 在前。对应 Python 元组比较语义。 */
function cmpKey(a: SortKey, b: SortKey): number {
  if (a[0] !== b[0]) return a[0] - b[0]
  if (a[0] === 0) return (a[1] as number) - (b[1] as number)
  const as = a[1] as string
  const bs = b[1] as string
  return as < bs ? -1 : as > bs ? 1 : 0
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** 按出现次数挑选最常见的非 "<synthetic>" 模型；并列时取最先出现者。 */
function pickModel(modelOrder: string[], counts: Map<string, number>): string | null {
  // 稳定排序：按计数降序，并列保持插入顺序（对齐 Counter.most_common）
  const ranked = [...modelOrder].sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0))
  for (const m of ranked) {
    if (m !== '<synthetic>') return m
  }
  return null
}

/** 把记录列表归一为 Conversation。 */
export function buildConversation(records: RawRecord[], opts: BuildOptions = {}): Conversation {
  const normalized = isCodexTranscript(records)
    ? normalizeCodexRecords(records, { sourcePath: opts.sourcePath })
    : records
  const dataLimit = opts.dataLimit ?? paths.TRUNCATE_LIMIT_DATA
  const conv = makeConversation(opts.sourcePath ?? '')

  let seq = 0
  const nextSeq = (): number => ++seq
  const pending = new Map<string, EventData>() // tool_use_id -> TOOL_CALL Event
  let customTitle: string | null = null
  const modelCounts = new Map<string, number>()
  const modelOrder: string[] = []

  for (const rec of normalized) {
    const rtype = rec['type']

    if (!conv.session_id && rec['sessionId']) conv.session_id = String(rec['sessionId'])
    if (!conv.cwd && rec['cwd']) conv.cwd = String(rec['cwd'])
    if (!conv.git_branch && rec['gitBranch']) conv.git_branch = String(rec['gitBranch'])

    if (rtype === 'custom-title' && rec['customTitle']) {
      customTitle = String(rec['customTitle'])
      continue
    }

    // 过滤：主对话不含 meta 与子代理记录
    if (rec['isMeta'] || rec['isSidechain']) continue

    // 时间戳仅取出备用，起止时间在循环末尾按"真正产生事件的记录"统计
    const ts = (rec['timestamp'] as string) ?? null

    const msg = asObject(rec['message'])
    if (rtype === 'assistant' && msg) {
      const mdl = msg['model']
      if (mdl) {
        const key = String(mdl)
        if (!modelCounts.has(key)) modelOrder.push(key)
        modelCounts.set(key, (modelCounts.get(key) || 0) + 1)
      }
      const content = msg['content']
      if (Array.isArray(content)) {
        for (const blkRaw of content) {
          const blk = asObject(blkRaw)
          if (!blk) continue
          const bt = blk['type']
          if (bt === 'thinking') {
            // Claude Code 通常只存加密 signature、thinking 明文为空；空思考块跳过
            const tt = (blk['thinking'] as string) || ''
            if (tt.trim()) {
              conv.events.push(
                makeEvent({ seq: nextSeq(), etype: EventType.THINKING, role: 'assistant', timestamp: ts, text: tt })
              )
            }
          } else if (bt === 'text') {
            const txt = (blk['text'] as string) || ''
            if (txt.trim()) {
              conv.events.push(
                makeEvent({ seq: nextSeq(), etype: EventType.ANSWER, role: 'assistant', timestamp: ts, text: txt })
              )
            }
          } else if (bt === 'tool_use') {
            const inputObj = asObject(blk['input'])
            const ev = makeEvent({
              seq: nextSeq(),
              etype: EventType.TOOL_CALL,
              role: 'assistant',
              timestamp: ts,
              tool_name: (blk['name'] as string) || '',
              tool_use_id: (blk['id'] as string) || '',
              tool_input: inputObj !== null ? inputObj : { _raw: blk['input'] ?? null },
              paired: false
            })
            conv.events.push(ev)
            if (ev.tool_use_id) pending.set(ev.tool_use_id, ev)
          }
        }
      } else if (typeof content === 'string' && content.trim()) {
        conv.events.push(
          makeEvent({ seq: nextSeq(), etype: EventType.ANSWER, role: 'assistant', timestamp: ts, text: content })
        )
      }
    } else if (rtype === 'user' && msg) {
      const content = msg['content']
      if (typeof content === 'string') {
        if (content.trim() && !textutil.isNoise(content)) {
          conv.events.push(
            makeEvent({ seq: nextSeq(), etype: EventType.USER_PROMPT, role: 'user', timestamp: ts, text: content })
          )
        }
      } else if (Array.isArray(content)) {
        const bufText: string[] = []
        const bufAtts: Attachment[] = []
        for (const blkRaw of content) {
          const blk = asObject(blkRaw)
          if (!blk) {
            if (typeof blkRaw === 'string') bufText.push(blkRaw)
            continue
          }
          const bt = blk['type']
          if (bt === 'tool_result') {
            const tuid = (blk['tool_use_id'] as string) || ''
            const [rawText, atts] = textutil.normalizeToolResultContent(blk['content'])
            const [text, trunc, orig, shown] = textutil.truncateBytes(rawText, dataLimit)
            const call = pending.get(tuid)
            if (call) {
              pending.delete(tuid)
              call.paired = true
            }
            const toolName = call ? call.tool_name : null
            conv.events.push(
              makeEvent({
                seq: nextSeq(),
                etype: EventType.TOOL_RESULT,
                role: 'user',
                timestamp: ts,
                text,
                tool_name: toolName,
                tool_use_id: tuid,
                is_error: Boolean(blk['is_error']),
                truncated: trunc,
                original_bytes: orig,
                shown_bytes: shown,
                paired: Boolean(call),
                attachments: atts
              })
            )
          } else if (bt === 'text') {
            bufText.push((blk['text'] as string) || '')
          } else if (bt === 'image') {
            const src = asObject(blk['source']) || {}
            const data = (src['data'] as string) || ''
            const media = (src['media_type'] as string) || ''
            bufAtts.push({
              kind: 'image',
              media_type: media,
              bytes: data.length,
              data,
              placeholder: `[用户图片 ${media}]`
            })
          }
        }
        const joined = bufText.filter((t) => t).join('\n')
        if ((joined.trim() || bufAtts.length) && !textutil.isNoise(joined)) {
          conv.events.push(
            makeEvent({
              seq: nextSeq(),
              etype: EventType.USER_PROMPT,
              role: 'user',
              timestamp: ts,
              text: joined,
              attachments: bufAtts
            })
          )
        }
      }
    }
  }

  // 起止时间：只取真正产生了 Event 的记录时间戳，对乱序输入取 min/max
  const eventTs = conv.events.map((e) => e.timestamp).filter((t): t is string => Boolean(t))
  if (eventTs.length) {
    let minTs = eventTs[0]
    let maxTs = eventTs[0]
    let minK = tsSortKey(minTs)
    let maxK = tsSortKey(maxTs)
    for (let i = 1; i < eventTs.length; i++) {
      const k = tsSortKey(eventTs[i])
      if (cmpKey(k, minK) < 0) {
        minK = k
        minTs = eventTs[i]
      }
      if (cmpKey(k, maxK) > 0) {
        maxK = k
        maxTs = eventTs[i]
      }
    }
    conv.started_at = minTs
    conv.ended_at = maxTs
  }

  // 标题先放 custom-title，交 titler 决定兜底
  conv.title = customTitle || ''
  // 模型取出现最多的非合成模型
  conv.model = pickModel(modelOrder, modelCounts)
  conv.message_count = conv.events.length
  conv.user_prompt_count = conv.events.filter((e) => e.etype === EventType.USER_PROMPT).length
  // 助手回合计数与 gate 对齐：含 ANSWER/THINKING/TOOL_CALL
  conv.assistant_count = conv.events.filter(
    (e) => e.etype === EventType.ANSWER || e.etype === EventType.THINKING || e.etype === EventType.TOOL_CALL
  ).length
  conv.any_truncated = conv.events.some((e) => e.truncated)
  return conv
}
