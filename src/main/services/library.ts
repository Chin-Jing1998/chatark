import { shell } from 'electron'
import { promises as fsp } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
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
import type { RelocateResult } from '@shared/api'
import { viewerHost } from '@shared/viewer'
import { FILE_NAMES } from '@shared/constants'
import { scan } from './fs/scan'
import { createRescanCoalescer, createSuppressionGate } from './fs/refresh-gate'
import { mapLimit } from './fs/paths'
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

/** 探针并发上限：只 stat 库根与一级子目录，几十次调用足够。 */
const PROBE_CONCURRENCY = 8

/**
 * 两次 mtime 探针的最小间隔。conv:list 与窗口聚焦都会触发 refreshIfStale，
 * 用户快速切换标签页时会在同一秒内连打十几次，每次都要 stat 库根与全部分类目录。
 * 一秒内的重复调用直接返回 false：真有变化也会被下一次调用或文件监听接住。
 */
const REFRESH_PROBE_MIN_MS = 1000

/** 库根 mtime 快照的库根自身键（子目录以目录名为键，不会与之冲突）。 */
const ROOT_KEY = ''

/** meta 未记录分类时的归位目标。 */
const FALLBACK_CATEGORY = '其他'

type MtimeSnapshot = Map<string, number>

/**
 * 采样库根与其一级子目录的 mtime。
 *
 * 只取一层：新对话目录的落盘会改写其父目录（分类目录或库根）的 mtime，
 * 一层即可覆盖"新增/删除/改名对话目录"这类需要重扫的变化，代价是几十次 stat。
 * 库根不可读返回 null（调用方据此放弃判定，不做无谓重扫）。
 */
async function probeDirMtimes(root: string): Promise<MtimeSnapshot | null> {
  let rootMtimeMs: number
  let entries: string[]
  try {
    rootMtimeMs = (await fsp.stat(root)).mtimeMs
    entries = await fsp.readdir(root)
  } catch {
    return null
  }
  const names = entries.filter((n) => !n.startsWith('.'))
  const snapshot: MtimeSnapshot = new Map([[ROOT_KEY, rootMtimeMs]])
  await mapLimit(names, PROBE_CONCURRENCY, async (name) => {
    try {
      const s = await fsp.stat(join(root, name))
      if (s.isDirectory()) snapshot.set(name, s.mtimeMs)
    } catch {
      // 采样期间条目消失：不记录，与上一次快照比对时自然体现为差异
    }
  })
  return snapshot
}

function sameSnapshot(a: MtimeSnapshot, b: MtimeSnapshot): boolean {
  if (a.size !== b.size) return false
  for (const [key, mtimeMs] of a) if (b.get(key) !== mtimeMs) return false
  return true
}

/** 主进程内的对话库内存态（M5 会叠加 SQLite 索引，但磁盘始终为真相）。 */
class Library {
  private records = new Map<string, ConversationRecord>()
  private hostIndex = new Map<string, string>() // viewerHost -> 对话目录绝对路径
  private lastScan: ScanResult | null = null
  /** 上一轮扫描开始前的目录 mtime 快照，供 refreshIfStale 判定是否有外部改动。 */
  private lastProbe: MtimeSnapshot | null = null
  /** 上次执行 mtime 探针的时刻（节流用）；每次重扫后归零，重扫后允许立即再探。 */
  private lastProbeAt = 0
  private listeners = new Set<() => void>()
  /** 自操作抑制闸门：期间的外部变更记脏标记，释放并过宽限后合并成一次重扫 + 广播。 */
  private gate = createSuppressionGate(() => {
    void this.rescan()
      .then(() => this.emitChange())
      .catch(() => undefined)
  })
  private coalescer = createRescanCoalescer<ScanResult>(() => this.doRescan())

  getRoot(): string {
    return getLibraryRoot()
  }

  /** 注册库变更回调（重扫完成后触发），返回取消注册函数。 */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emitChange(): void {
    for (const cb of this.listeners) cb()
  }

  /** 文件监听收到外部变更：交由闸门决定立即重放还是记脏标记。 */
  notifyExternalChange(): void {
    this.gate.notify()
  }

  /**
   * 在自操作抑制下执行：期间本程序造成的监听回声不触发重扫，
   * 期间发生的外部变更记脏标记，结束后由闸门统一重放一次。
   */
  async runSuppressed<T>(fn: () => Promise<T>): Promise<T> {
    this.gate.begin()
    try {
      return await fn()
    } finally {
      this.gate.end()
    }
  }

  /**
   * mtime 探针：库根或其一级子目录变过才重扫，未变则零成本返回。
   * 供 conv:list 与窗口聚焦调用，兜住监听失灵（网络卷、监听数超限）的场景。
   * 返回是否确实重扫过。
   */
  async refreshIfStale(): Promise<boolean> {
    // 自操作进行中：磁盘处于中间态，重扫无意义；结束后由脏标记重放统一刷新
    if (this.gate.isSuppressed()) return false
    const now = Date.now()
    if (now - this.lastProbeAt < REFRESH_PROBE_MIN_MS) return false
    this.lastProbeAt = now
    const probe = await probeDirMtimes(this.getRoot())
    if (!probe) return false
    if (this.lastProbe && sameSnapshot(this.lastProbe, probe)) return false
    await this.rescan()
    return true
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
   * 合并并发请求：文件监听回调、convRescan IPC、导入/补导出后的重扫都可能并发，
   * 大库单次重扫耗时可观。进行中的请求不复用当前快照（可能早于请求时刻、漏掉刚落盘的目录），
   * 而是合并成一轮后续扫描统一兑现。
   */
  rescan(): Promise<ScanResult> {
    return this.coalescer.request()
  }

  private async doRescan(): Promise<ScanResult> {
    const root = this.getRoot()
    // 快照必须在扫描前采样：扫描期间的新增若被算进快照，下次探针就发现不了它
    this.lastProbe = await probeDirMtimes(root)
    // 刚重扫过，快照即最新：解除探针节流，让紧随其后的 refreshIfStale 能立即核对
    this.lastProbeAt = 0
    const result = await scan(root)
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

  async move(id: string, toCategory: string): Promise<OpResult<ConversationSummary>> {
    return this.runSuppressed(async () => {
      const rec = this.records.get(id)
      if (!rec) return fail('NOT_FOUND', '对话不存在')
      const r = await moveToCategory(rec.absPath, toCategory, this.getRoot())
      if (!r.ok) return r
      return ok(await this.refreshRecord(id, r.data.newPath))
    })
  }

  async trash(id: string): Promise<OpResult> {
    return this.runSuppressed(async () => {
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
    return this.runSuppressed(async () => {
      const rec = this.records.get(id)
      if (!rec) return fail('NOT_FOUND', '对话不存在')
      const r = await renameConversation(rec.absPath, newTitle)
      if (!r.ok) return r
      return ok(await this.refreshRecord(id, r.data.newPath))
    })
  }

  async setOrg(id: string, partial: Partial<OrgMeta>): Promise<OpResult<ConversationSummary>> {
    return this.runSuppressed(async () => {
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
    // 迁移期间抑制监听：半迁移状态下的重扫毫无意义，且会用中间态覆盖内存
    return this.runSuppressed(async () => {
      try {
        const r = await runMigration(oldRoot, newRoot, onProgress, () => setLibraryRoot(newRoot))
        if (!r.ok) return r
        await this.rescan() // 新根重建内存态 + 搜索源
        return r
      } finally {
        releaseMigrationLock()
      }
    })
  }

  /**
   * 把「未归类」（库根第一层的游离对话目录）全部移入各自 meta 记录的分类，
   * meta 未记录分类的移入「其他」。目标分类不存在时由 moveToCategory 创建；
   * 同名冲突等失败逐条收集，不中断其余条目。
   */
  async relocateUncategorized(): Promise<RelocateResult> {
    return this.runSuppressed(async () => {
      const root = this.getRoot()
      const rootResolved = resolve(root)
      const strays = [...this.records.values()].filter(
        (r) => resolve(dirname(r.absPath)) === rootResolved
      )
      const failed: RelocateResult['failed'] = []
      let moved = 0
      for (const rec of strays) {
        const target = rec.meta.category?.trim() || FALLBACK_CATEGORY
        const r = await moveToCategory(rec.absPath, target, root)
        if (r.ok) moved += 1
        else failed.push({ title: rec.title, message: r.message })
      }
      await this.rescan()
      return { moved, failed }
    })
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
