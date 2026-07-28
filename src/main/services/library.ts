import { shell } from 'electron'
import { isAbsolute, join, resolve } from 'node:path'
import type {
  ConversationRecord,
  ConversationSummary,
  ListQuery,
  ListResult,
  MigrationOutcome,
  OpResult,
  OrgMeta,
  ScanResult
} from '@shared/types'
import { fail, ok, toSummary } from '@shared/types'
import { viewerHost } from '@shared/viewer'
import { FILE_NAMES } from '@shared/constants'
import { scan } from './fs/scan'
import { parseConversationDir } from './fs/parse-dir'
import { moveToCategory } from './fs/move'
import { trashConversationDir } from './fs/trash'
import { renameConversation } from './fs/rename'
import { updateOrg } from './org/sidecar'
import { isDangerousRoot } from './fs/sensitive-roots'
import { getLibraryRoot, setLibraryRoot } from './settings/store'
import { searchService } from './search/search'
import { runMigration, type MigrationProgress } from './migration/migrate'
import { acquireMigrationLock, releaseMigrationLock } from './migration/lock'

/** 主进程内的对话库内存态（M5 会叠加 SQLite 索引，但磁盘始终为真相）。 */
class Library {
  private records = new Map<string, ConversationRecord>()
  private hostIndex = new Map<string, string>() // viewerHost -> 对话目录绝对路径
  private lastScan: ScanResult | null = null
  private suppressUntil = 0
  private scanning: Promise<ScanResult> | null = null

  getRoot(): string {
    return getLibraryRoot()
  }

  /** 自操作抑制：mutation 前调用，使文件监听短时间内忽略由本程序造成的变更回声。 */
  suppressWatch(ms = 2000): void {
    this.suppressUntil = Date.now() + ms
  }
  isWatchSuppressed(): boolean {
    return Date.now() < this.suppressUntil
  }

  /** convo:// host → 对话目录绝对路径（查看器协议用）。 */
  resolveHost(host: string): string | undefined {
    return this.hostIndex.get(host)
  }

  /**
   * 「应用内打开任意文件」（convo://open-file）允许的根目录集合：库根 + 各对话的 cwd。
   *
   * 必须过滤过宽根：若用户曾在 ~ 或 ~/Documents 下跑过 Claude Code，其 meta.cwd 就是该目录，
   * 不过滤则整个 home 被放行、白名单形同虚设。代价是此类对话的文件预览失效——这是正确的取舍。
   */
  allowedFileRoots(): string[] {
    const roots = new Set<string>()
    const libRoot = this.getRoot()
    if (libRoot && !isDangerousRoot(libRoot)) roots.add(resolve(libRoot))
    for (const r of this.records.values()) {
      const cwd = r.meta.cwd?.trim()
      if (!cwd || !isAbsolute(cwd) || isDangerousRoot(cwd)) continue
      roots.add(resolve(cwd))
    }
    return [...roots]
  }

  /**
   * 全量重扫并重建内存态。
   *
   * 加互斥：文件监听回调、convRescan IPC、导入/补导出后的重扫都可能并发，
   * 大库单次重扫耗时可观，重叠时后完成者会覆盖先完成者的结果。进行中则复用同一次扫描。
   */
  rescan(): Promise<ScanResult> {
    if (this.scanning) return this.scanning
    this.scanning = this.doRescan().finally(() => (this.scanning = null))
    return this.scanning
  }

  private async doRescan(): Promise<ScanResult> {
    const result = await scan(this.getRoot())
    this.records = new Map(result.records.map((r) => [r.id, r]))
    this.hostIndex = new Map(result.records.map((r) => [viewerHost(r.id), r.absPath]))
    searchService.setSource(result.records)
    this.lastScan = result
    return result
  }

  /** 确保已扫描过（首次访问时懒扫描）。 */
  async ensureLoaded(): Promise<void> {
    if (!this.lastScan) await this.rescan()
  }

  get(id: string): ConversationRecord | undefined {
    return this.records.get(id)
  }

  /** 库内全部已登记的 sessionId（补导出判定"已导出"集合用）。 */
  allSessionIds(): Set<string> {
    const set = new Set<string>()
    for (const r of this.records.values()) if (r.sessionId) set.add(r.sessionId)
    return set
  }

  // —— 管理动作 ——

  /**
   * 抑制窗口覆盖整个 mutation 生命周期：进入时长抑制（含跨卷 cp+rm 可历时数十秒），
   * 完成后（含 refreshRecord）再置短窗吸收 chokidar 回声，避免长操作期间 rescan 覆盖内存态。
   */
  private async withSuppression<T>(fn: () => Promise<T>): Promise<T> {
    this.suppressWatch(10 * 60 * 1000)
    try {
      return await fn()
    } finally {
      this.suppressWatch(2000)
    }
  }

  async move(id: string, toCategory: string): Promise<OpResult<ConversationSummary>> {
    return this.withSuppression(async () => {
      const rec = this.records.get(id)
      if (!rec) return fail('NOT_FOUND', '对话不存在')
      const r = await moveToCategory(rec.absPath, toCategory, this.getRoot())
      if (!r.ok) return r
      return ok(await this.refreshRecord(id, r.data.newPath))
    })
  }

  async trash(id: string): Promise<OpResult> {
    return this.withSuppression(async () => {
      const rec = this.records.get(id)
      if (!rec) return fail('NOT_FOUND', '对话不存在')
      const r = await trashConversationDir(rec.absPath)
      if (!r.ok) return r
      this.records.delete(id)
      this.hostIndex.delete(viewerHost(id))
      this.refreshSearch()
      return ok(undefined)
    })
  }

  async rename(id: string, newTitle: string): Promise<OpResult<ConversationSummary>> {
    return this.withSuppression(async () => {
      const rec = this.records.get(id)
      if (!rec) return fail('NOT_FOUND', '对话不存在')
      const r = await renameConversation(rec.absPath, newTitle)
      if (!r.ok) return r
      return ok(await this.refreshRecord(id, r.data.newPath))
    })
  }

  async setOrg(id: string, partial: Partial<OrgMeta>): Promise<OpResult<ConversationSummary>> {
    return this.withSuppression(async () => {
      const rec = this.records.get(id)
      if (!rec) return fail('NOT_FOUND', '对话不存在')
      try {
        const org = await updateOrg(rec.absPath, partial)
        const updated = { ...rec, org }
        this.records.set(id, updated)
        this.refreshSearch()
        return ok(toSummary(updated))
      } catch (e) {
        return fail('IO_ERROR', `写入组织元数据失败：${e instanceof Error ? e.message : e}`)
      }
    })
  }

  reveal(id: string): OpResult {
    const rec = this.records.get(id)
    if (!rec) return fail('NOT_FOUND', '对话不存在')
    shell.showItemInFolder(rec.absPath)
    return ok(undefined)
  }

  async openExternal(id: string): Promise<OpResult> {
    const rec = this.records.get(id)
    if (!rec) return fail('NOT_FOUND', '对话不存在')
    const err = await shell.openPath(join(rec.absPath, FILE_NAMES.html))
    return err ? fail('IO_ERROR', err) : ok(undefined)
  }

  /**
   * 更换库根并把旧根全部内容自动迁移到新根（复制-校验-切换-删源）。
   * 迁移期间长抑制监听；成功后以新根重扫。调用方负责迁移后重启监听。
   */
  async setRoot(
    newRoot: string,
    onProgress: (p: MigrationProgress) => void
  ): Promise<OpResult<MigrationOutcome>> {
    const oldRoot = this.getRoot()
    // 规范化后比较：尾部分隔符、`.`/`..` 不应被当成"换了个路径"而触发一次完整迁移+删源
    if (resolve(oldRoot) === resolve(newRoot)) {
      setLibraryRoot(newRoot)
      await this.rescan()
      return ok({ movedFiles: 0, sourceKept: [] })
    }

    // 跨进程锁：迁移期间让 SessionEnd 钩子的独立导出进程让路，
    // 否则新写入旧根的会话不在 walk 快照内、会被删源一并清掉
    if (!acquireMigrationLock()) {
      return fail('CONFLICT', '已有迁移正在进行，请等待其完成后再试')
    }
    this.suppressWatch(10 * 60 * 1000) // 迁移期间长抑制
    try {
      const r = await runMigration(oldRoot, newRoot, onProgress, () => setLibraryRoot(newRoot))
      if (!r.ok) return r
      await this.rescan() // 新根重建内存态 + 搜索源
      return r
    } finally {
      this.suppressWatch(0)
      releaseMigrationLock()
    }
  }

  /** 操作后用新路径重解析并替换内存记录与索引。 */
  private async refreshRecord(oldId: string, newAbsPath: string): Promise<ConversationSummary> {
    const fresh = await parseConversationDir(newAbsPath, this.getRoot(), Date.now())
    this.records.delete(oldId)
    this.records.set(fresh.id, fresh)
    this.hostIndex.delete(viewerHost(oldId))
    this.hostIndex.set(viewerHost(fresh.id), fresh.absPath)
    this.refreshSearch()
    return toSummary(fresh)
  }

  private refreshSearch(): void {
    searchService.setSource([...this.records.values()])
  }

  list(query: ListQuery = {}): ListResult {
    const all = [...this.records.values()]

    const byCategory: Record<string, number> = {}
    for (const r of all) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1

    let items = query.category ? all.filter((r) => r.category === query.category) : all
    items = sortRecords(items, query.sort ?? 'started_desc')

    return {
      items: items.map(toSummary),
      total: items.length,
      byCategory
    }
  }
}

function sortRecords(records: ConversationRecord[], sort: NonNullable<ListQuery['sort']>): ConversationRecord[] {
  const copy = [...records]
  switch (sort) {
    case 'started_asc':
      return copy.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    case 'title':
      return copy.sort((a, b) => a.title.localeCompare(b.title, 'zh'))
    case 'size_desc':
      return copy.sort((a, b) => b.totalSizeBytes - a.totalSizeBytes)
    case 'started_desc':
    default:
      return copy.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }
}

export const library = new Library()
