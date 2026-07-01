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
import type { RescanSummary } from '@shared/api'
import { library } from '../services/library'

/** 注册对话相关 IPC。 */
export function registerConversationsIpc(): void {
  ipcMain.handle(IPC.convList, async (_e, query: ListQuery = {}): Promise<ListResult> => {
    await library.ensureLoaded()
    return library.list(query)
  })

  ipcMain.handle(IPC.convGet, async (_e, id: string): Promise<ConversationRecord | null> => {
    await library.ensureLoaded()
    return library.get(id) ?? null
  })

  ipcMain.handle(IPC.convRescan, async (): Promise<RescanSummary> => {
    const r = await library.rescan()
    return { total: r.records.length, scannedDirs: r.scannedDirs, skipped: r.skipped.length, tookMs: r.tookMs }
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
