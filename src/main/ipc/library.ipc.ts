import { ipcMain, dialog, BrowserWindow, type OpenDialogOptions } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { OpResult } from '@shared/types'
import { library } from '../services/library'
import { restartLibraryWatch } from '../watch-manager'

/** 注册库根设置与迁移 IPC。 */
export function registerLibraryIpc(): void {
  ipcMain.handle(IPC.libraryPickRoot, async (e): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择新的保存路径'
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })

  ipcMain.handle(
    IPC.librarySetRoot,
    async (e, newRoot: string): Promise<OpResult<{ movedFiles: number }>> => {
      const r = await library.setRoot(newRoot, (p) => e.sender.send(IPC.evtMigration, p))
      if (r.ok) {
        restartLibraryWatch()
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.evtLibrary)
      }
      return r
    }
  )
}
