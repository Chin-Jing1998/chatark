/**
 * 跨进程共享的数据契约（main / preload / renderer 共用，单一真源）。
 */

/** 已知分类（用于排序与图标）；category 本身开放为任意字符串。 */
export const KNOWN_CATEGORIES = ['专利', '编程开发', '文档处理', '检索调研', '学术', '其他'] as const
export type Category = string

/** 导出包内的 5 个标准文件键 */
export type FileKind = 'html' | 'jsonl' | 'dataJs' | 'md' | 'meta'

/** 单文件的存在性与基本属性 */
export interface FilePresence {
  exists: boolean
  sizeBytes: number
  mtimeMs: number
}

export type ConversationFiles = Record<FileKind, FilePresence>

/**
 * 标题来源：'llm' = claude 生成的主题标题；'local' = 本地规则回退（LLM 未跑或失败）；
 * 'user' = 用户手动改名。重导出时只重试 'local'，'user' 与 'llm' 一律沿用。
 * 旧 meta 无此字段时按 'llm' 对待（仅在标题污染或未命名时才重起）。
 */
export type TitleSourceKind = 'llm' | 'local' | 'user'

/** meta.json 的规范结构（schemaVersion=1）；导入残缺包时字段可能缺失，故除核心外均可选。 */
export interface MetaJson {
  schemaVersion?: number
  sessionId?: string
  title?: string
  titleSource?: TitleSourceKind
  category?: string
  model?: string
  cwd?: string
  gitBranch?: string
  startedAt?: string
  endedAt?: string
  messageCount?: number
  userPromptCount?: number
  assistantCount?: number
  anyTruncated?: boolean
  truncatedEvents?: unknown[]
  sourcePath?: string
  exportedAt?: string
  warnings?: string[]
  parseStats?: { total_lines: number; bad_lines: number; good_lines: number }
  light?: boolean
}

/** 完整性诊断 */
export interface Integrity {
  missingFiles: FileKind[]
  categoryMismatch: boolean
  duplicateSessionId: boolean
  metaParseError?: string
}

/** 组织元数据（置顶/收藏/归档/标签），存对话目录内 chatark.json sidecar。 */
export interface OrgMeta {
  pinned: boolean
  favorite: boolean
  archived: boolean
  tags: string[]
}

/** 单个对话的内部统一表示 */
export interface ConversationRecord {
  /** 逻辑主键：sessionId（move/rename 不变）；无法确定时退化为 `dir:relPath` */
  id: string
  sessionId: string
  /** 当前目录名（截断标题版，展示辅助用） */
  dirName: string
  /** 当前绝对路径 */
  absPath: string
  /** 相对库根路径 */
  relPath: string
  /** 当前类别（以实际物理父目录为准） */
  category: Category
  /** 规范化后的 meta（展示一律取此处字段） */
  title: string
  model: string
  startedAt: string
  endedAt: string
  messageCount: number
  userPromptCount: number
  assistantCount: number
  anyTruncated: boolean
  /** 原始 meta.json 全量（用于详情/调试） */
  meta: MetaJson
  files: ConversationFiles
  totalSizeBytes: number
  /** 基于关键文件 size:mtime 的快速指纹，用于索引一致性 */
  fingerprint: string
  integrity: Integrity
  org: OrgMeta
  /** 对话文件夹在磁盘上的创建时间（毫秒，birthtime）；用于“创建时间”排序 */
  createdAtMs: number
  /** 解析时间戳（毫秒），由调用方注入（避免在纯函数里取时间） */
  indexedAt: number
}

/** 列表视图用的精简子集（不含正文/原始 meta，传输轻量） */
export interface ConversationSummary {
  id: string
  sessionId: string
  title: string
  category: Category
  /** 相对库根路径（分类/文件夹名），用于搜索/收藏/标签视图区分同名对话 */
  relPath: string
  model: string
  startedAt: string
  endedAt: string
  /** 导出时间（meta.exportedAt，ISO 字符串）；用于“导出时间”排序 */
  exportedAt: string
  /** 会话工作目录（meta.cwd）；用于“按项目”视图分组，缺失时为空串 */
  cwd: string
  /** 对话文件夹磁盘创建时间（毫秒，birthtime）；用于“创建时间”排序 */
  createdAtMs: number
  messageCount: number
  totalSizeBytes: number
  org: OrgMeta
  integrity: Integrity
}

export function toSummary(rec: ConversationRecord): ConversationSummary {
  return {
    id: rec.id,
    sessionId: rec.sessionId,
    title: rec.title,
    category: rec.category,
    relPath: rec.relPath,
    model: rec.model,
    startedAt: rec.startedAt,
    endedAt: rec.endedAt,
    exportedAt: rec.meta.exportedAt ?? '',
    cwd: rec.meta.cwd ?? '',
    createdAtMs: rec.createdAtMs,
    messageCount: rec.messageCount,
    totalSizeBytes: rec.totalSizeBytes,
    org: rec.org,
    integrity: rec.integrity
  }
}

/** 统一写操作返回信封 */
export type OpResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string; recoverable?: boolean }

export type ErrorCode =
  | 'NOT_FOUND'
  | 'NAME_COLLISION'
  | 'PARSE_ERROR'
  | 'IO_ERROR'
  | 'NO_TRASH'
  | 'INVALID_INPUT'
  | 'NO_SPACE'
  | 'PERMISSION'
  | 'CONFLICT'
  | 'UNKNOWN'

export function ok<T>(data: T): OpResult<T> {
  return { ok: true, data }
}
export function fail(code: ErrorCode, message: string, recoverable = false): OpResult<never> {
  return { ok: false, code, message, recoverable }
}

/** 扫描结果 */
export interface ScanResult {
  records: ConversationRecord[]
  scannedDirs: number
  skipped: Array<{ path: string; reason: string }>
  tookMs: number
}

/** 路径迁移结果 */
export interface MigrationOutcome {
  movedFiles: number
  /** 未能移入回收站、仍留在旧库根下的顶层条目名（正常情况下为空） */
  sourceKept: string[]
}

/** 路径迁移进度 */
export interface MigrationProgress {
  phase: 'plan' | 'copying' | 'verifying' | 'switching' | 'done' | 'error'
  copiedBytes: number
  totalBytes: number
  copiedFiles: number
  totalFiles: number
  message?: string
}

/** 未导出的原始会话（补导出候选） */
export interface UnexportedSession {
  sessionId: string
  path: string
  title: string
  cwd: string
  turns: number
  /** 主导模型（quickInfo 众数），haiku 主导会话已过滤不展示 */
  model?: string
  mtimeMs: number
}

/** 补导出结果 */
export interface ReexportResult {
  exported: number
  skipped: number
  failed: number
}

/** 导入单个包的结果 */
export interface ImportResult {
  status: 'imported' | 'skipped-duplicate' | 'invalid'
  sessionId?: string
  dir?: string
  message?: string
}

/** 自动导出钩子状态 */
export interface HookStatus {
  installed: boolean
  pythonHookPresent: boolean
  /** 已安装的我方条目与当前版本期望形态不一致（命令、timeout 或 async），需重新安装 */
  needsUpdate: boolean
  /** 自动导出诊断日志的绝对路径 */
  logPath: string
  /** 该日志文件当前是否存在（不存在时「打开日志」不可用） */
  logExists: boolean
}

/** 补录进度 */
export interface BackfillProgress {
  done: number
  total: number
}

/** 搜索命中 */
export interface SearchHit {
  id: string
  title: string
  category: Category
  score: number
  snippet: string
}

/** 列表查询参数与返回 */
export interface ListQuery {
  category?: Category
  sort?: 'started_desc' | 'started_asc' | 'title' | 'size_desc'
}
export interface ListResult {
  items: ConversationSummary[]
  total: number
  byCategory: Record<string, number>
}
