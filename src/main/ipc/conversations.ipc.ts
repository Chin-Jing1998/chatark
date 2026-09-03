import { ipcMain, shell } from 'electron'
import { isAbsolute } from 'node:path'
import { IPC } from '@shared/ipc-channels'
import type {
  ConversationRecord,
  ConversationSummary,
  ListQuery,
  ListResult,
  OpResult,
  OrgMeta
} from '@shared/types'
import { fail, ok } from '@shared/types'
import type { RelocateResult, RescanSummary } from '@shared/api'
import { library } from '../services/library'
import { broadcastLibraryChanged } from '../watch-manager'

/** 跳过目录明细的上送上限：仅供界面提示，全量列表对渲染层无用且可能很长。 */
const MAX_SKIPPED_ITEMS = 50

/** 注册对话相关 IPC。 */
export function registerConversationsIpc(): void {
  ipcMain.handle(IPC.convList, async (_e, query: ListQuery = {}): Promise<ListResult> => {
    await library.ensureLoaded()
    // mtime 探针：库根有外部改动才重扫。探针本身出错不应让整个列表失败
    await library.refreshIfStale().catch(() => undefined)
    return library.list(query)
  })

  ipcMain.handle(IPC.convGet, async (_e, id: string): Promise<ConversationRecord | null> => {
    await library.ensureLoaded()
    return library.get(id) ?? null
  })

  ipcMain.handle(IPC.convRescan, async (): Promise<RescanSummary> => {
    const r = await library.rescan()
    return {
      total: r.records.length,
      scannedDirs: r.scannedDirs,
      skipped: r.skipped.length,
      skippedItems: r.skipped.slice(0, MAX_SKIPPED_ITEMS),
      tookMs: r.tookMs
    }
  })

  ipcMain.handle(IPC.convRelocateUncategorized, async (): Promise<OpResult<RelocateResult>> => {
    try {
      const data = await library.relocateUncategorized()
      broadcastLibraryChanged()
      return ok(data)
    } catch (e) {
      return fail('IO_ERROR', `归位失败：${e instanceof Error ? e.message : e}`)
    }
  })

  ipcMain.handle(
    IPC.convMove,
    (_e, id: string, toCategory: string): Promise<OpResult<ConversationSummary>> =>
      library.move(id, toCategory)
  )
  ipcMain.handle(IPC.convTrash, (_e, id: string): Promise<OpResult> => library.trash(id))
  ipcMain.handle(
    IPC.convRename,
    (_e, id: string, newTitle: string): Promise<OpResult<ConversationSummary>> =>
      library.rename(id, newTitle)
  )
  ipcMain.handle(
    IPC.convSetOrg,
    (_e, id: string, partial: Partial<OrgMeta>): Promise<OpResult<ConversationSummary>> =>
      library.setOrg(id, partial)
  )
  ipcMain.handle(IPC.convReveal, (_e, id: string): OpResult => library.reveal(id))
  ipcMain.handle(IPC.convOpenExternal, (_e, id: string): Promise<OpResult> => library.openExternal(id))

  // 任意绝对路径 → 在系统文件管理器中定位（应用内打开的生成文件“跳转所在文件夹”）
  ipcMain.handle(IPC.fileReveal, (_e, absPath: string): void => {
    if (typeof absPath === 'string' && isAbsolute(absPath)) shell.showItemInFolder(absPath)
  })

  ipcMain.handle(IPC.libraryGetRoot, (): string => library.getRoot())
}
