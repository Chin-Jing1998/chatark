/**
 * window.api 的契约（preload 实现、renderer 消费的单一真源）。
 * 后续里程碑在此扩展 search / settings / migration 等命名空间。
 */
import type {
  BackfillProgress,
  ConversationRecord,
  ConversationSummary,
  HookStatus,
  ImportResult,
  ListQuery,
  ListResult,
  MigrationOutcome,
  MigrationProgress,
  OpResult,
  OrgMeta,
  ReexportResult,
  SearchHit,
  UnexportedSession
} from './types'

export type ThemeMode = 'system' | 'light' | 'dark'

export interface ThemeChangedPayload {
  source: ThemeMode
  dark: boolean
}

export interface ConfirmOptions {
  message: string
  detail?: string
  confirmLabel?: string
  danger?: boolean
}

/** 扫描中被跳过的目录（非对话目录、不可读目录等）。 */
export interface SkippedItem {
  path: string
  reason: string
}

export interface RescanSummary {
  total: number
  scannedDirs: number
  skipped: number
  /** 被跳过目录的明细（主进程按 50 条截断，仅供界面提示，不作统计口径） */
  skippedItems: SkippedItem[]
  tookMs: number
}

/** 「未归类」归位失败的单条说明。 */
export interface RelocateFailure {
  title: string
  message: string
}

/** 「全部归位」的执行结果。 */
export interface RelocateResult {
  moved: number
  failed: RelocateFailure[]
}

export interface ChatArkApi {
  /** 运行平台，供渲染层做平台相关 UI 分支 */
  platform: NodeJS.Platform

  // —— 主题 ——
  /** 设置主题来源，返回当前是否暗色 */
  setThemeSource(mode: ThemeMode): Promise<boolean>
  /** 设置对话页注入令牌（预设配色，null=默认不覆盖）；供主进程在 convo:// 注入首屏 <style> */
  setThemeTokens(tokens: Record<string, string> | null): Promise<void>
  /** 订阅系统外观变化广播，返回取消订阅函数 */
  onThemeChanged(cb: (payload: ThemeChangedPayload) => void): () => void

  // —— 对话 ——
  conv: {
    list(query?: ListQuery): Promise<ListResult>
    get(id: string): Promise<ConversationRecord | null>
    rescan(): Promise<RescanSummary>
    move(id: string, toCategory: string): Promise<OpResult<ConversationSummary>>
    trash(id: string): Promise<OpResult>
    rename(id: string, newTitle: string): Promise<OpResult<ConversationSummary>>
    setOrg(id: string, partial: Partial<OrgMeta>): Promise<OpResult<ConversationSummary>>
    reveal(id: string): Promise<OpResult>
    openExternal(id: string): Promise<OpResult>
    /** 把「未归类」的对话全部移入各自 meta 记录的分类（未记录则移入「其他」） */
    relocateUncategorized(): Promise<OpResult<RelocateResult>>
  }

  // —— 任意文件 ——
  file: {
    /** 在系统文件管理器中定位任意绝对路径（应用内打开的生成文件“跳转所在文件夹”） */
    reveal(absPath: string): Promise<void>
  }

  // —— 搜索 ——
  search: {
    query(q: string, limit?: number): Promise<SearchHit[]>
  }

  // —— 库 ——
  library: {
    getRoot(): Promise<string>
    /** 弹目录选择框，返回所选路径或 null */
    pickRoot(): Promise<string | null>
    /** 更换库根并自动迁移旧根全部内容（旧根内容迁移后移入回收站） */
    setRoot(newRoot: string): Promise<OpResult<MigrationOutcome>>
  }

  // —— 补录 ——
  backfill: {
    /** 扫描从未导出过的原始会话 */
    scanRaw(): Promise<UnexportedSession[]>
    /** 对选定会话补导出并入库 */
    reexport(sessionIds: string[]): Promise<ReexportResult>
    /** 弹目录选择框选择要导入的对话文件夹 */
    pickImport(): Promise<string[]>
    /** 导入选定的对话包目录 */
    import(dirs: string[]): Promise<OpResult<ImportResult>[]>
  }

  // —— 自动导出钩子 ——
  hook: {
    status(): Promise<HookStatus>
    install(replacePython: boolean): Promise<OpResult<HookStatus>>
    uninstall(): Promise<OpResult<HookStatus>>
  }

  // —— 原生 UI 对话框 ——
  ui: {
    /** 原生非阻塞确认框，返回是否确认 */
    confirm(opts: ConfirmOptions): Promise<boolean>
  }

  /** 订阅库变更（外部磁盘改动触发重扫后），返回取消订阅函数 */
  onLibraryChanged(cb: () => void): () => void
  /** 订阅菜单加速键请求打开命令面板（⌘O/⌘K/⌘R，iframe 聚焦时仍生效），返回取消订阅函数 */
  onOpenCommand(cb: () => void): () => void
  /** 订阅迁移进度，返回取消订阅函数 */
  onMigration(cb: (p: MigrationProgress) => void): () => void
  /** 订阅补录进度，返回取消订阅函数 */
  onBackfill(cb: (p: BackfillProgress) => void): () => void
}
