/**
 * 导出器内部类型（自 chat_export/model.py 的数据类移植）。
 *
 * 渲染器只依赖本模块的数据结构，不再触碰原始 JSON。对外共享契约仍取 @shared/types
 * 的 MetaJson；此处仅定义导出过程内部使用的 Conversation / Event 等。
 */

/** 事件类型（与 Python EventType 取值字符串完全一致）。 */
export enum EventType {
  USER_PROMPT = 'user_prompt', // 用户提问
  THINKING = 'thinking', // 助手思考
  ANSWER = 'answer', // 助手回答
  TOOL_CALL = 'tool_call', // 工具调用
  TOOL_RESULT = 'tool_result' // 工具返回
}

/** 用户/工具返回携带的附件占位（图片等，不外泄 base64 正文到结构化字段）。 */
export interface Attachment {
  kind: string
  media_type: string
  bytes: number
  data: string
  placeholder: string
}

/** 单条规范化事件。 */
export interface EventData {
  seq: number
  etype: EventType
  role: string
  timestamp: string | null
  text: string
  tool_name: string | null
  tool_use_id: string | null
  tool_input: Record<string, unknown> | null
  is_error: boolean
  truncated: boolean
  original_bytes: number
  shown_bytes: number
  paired: boolean
  attachments: Attachment[]
}

/** 一次会话的规范化中间表示。 */
export interface Conversation {
  session_id: string
  source_path: string
  cwd: string
  git_branch: string
  title: string
  category: string
  model: string | null
  started_at: string | null
  ended_at: string | null
  message_count: number
  user_prompt_count: number
  assistant_count: number
  any_truncated: boolean
  events: EventData[]
  warnings: string[]
  /** 解析统计，附在对象上供 meta 使用（对应 Python conv._parse_stats）。 */
  parse_stats: ParseStats
}

/** JSONL 解析统计（字段名与 Python 一致，供 meta.json 直接落盘）。 */
export interface ParseStats {
  total_lines: number
  bad_lines: number
  good_lines: number
}

/** 原始 JSONL 记录（任意键值；解析后即为对象）。 */
export type RawRecord = Record<string, unknown>

/** 构建 Conversation 的可选项。 */
export interface BuildOptions {
  sourcePath?: string
  dataLimit?: number
}

/** 创建一个带默认值的空事件（便于按需覆盖字段）。 */
export function makeEvent(partial: Partial<EventData> & Pick<EventData, 'seq' | 'etype' | 'role'>): EventData {
  return {
    timestamp: null,
    text: '',
    tool_name: null,
    tool_use_id: null,
    tool_input: null,
    is_error: false,
    truncated: false,
    original_bytes: 0,
    shown_bytes: 0,
    paired: true,
    attachments: [],
    ...partial
  }
}

/** 创建一个带默认值的空 Conversation。 */
export function makeConversation(sourcePath = ''): Conversation {
  return {
    session_id: '',
    source_path: String(sourcePath),
    cwd: '',
    git_branch: '',
    title: '',
    category: '',
    model: null,
    started_at: null,
    ended_at: null,
    message_count: 0,
    user_prompt_count: 0,
    assistant_count: 0,
    any_truncated: false,
    events: [],
    warnings: [],
    parse_stats: { total_lines: 0, bad_lines: 0, good_lines: 0 }
  }
}
