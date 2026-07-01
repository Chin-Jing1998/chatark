import { ipcMain, dialog, BrowserWindow, type OpenDialogOptions } from 'electron'
import { IPC } from '@shared/ipc-channels'
import { findUnexported, reexport, type ReexportResult, type UnexportedSession } from '../services/backfill/scan-raw'
import { importPackageDir, type ImportResult } from '../services/backfill/import'
import { installHook, uninstallHook, hookStatus, type HookStatus } from '../services/hook/install'
import type { OpResult } from '@shared/types'

function broadcastLibrary(): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.evtLibrary)
}

/** 注册补录与自动导出钩子 IPC。 */
export function registerBackfillIpc(): void {
  ipcMain.handle(IPC.backfillScanRaw, (): Promise<UnexportedSession[]> => findUnexported())

  ipcMain.handle(
    IPC.backfillReexport,
    async (e, ids: string[]): Promise<ReexportResult> => {
      const res = await reexport(ids, (done, total) =>
        e.sender.send(IPC.evtBackfill, { done, total })
      )
      broadcastLibrary()
      return res
    }
  )

  ipcMain.handle(IPC.backfillPickImport, async (e): Promise<string[]> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: OpenDialogOptions = {
      properties: ['openDirectory', 'multiSelections'],
      title: '选择要导入的对话文件夹'
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? [] : r.filePaths
  })

  ipcMain.handle(IPC.backfillImport, async (_e, dirs: string[]): Promise<OpResult<ImportResult>[]> => {
    const results: OpResult<ImportResult>[] = []
    for (const d of dirs) results.push(await importPackageDir(d, 'copy'))
    broadcastLibrary()
    return results
  })

  ipcMain.handle(IPC.hookStatus, (): Promise<HookStatus> => hookStatus())
  ipcMain.handle(IPC.hookInstall, (_e, replacePython: boolean): Promise<OpResult<HookStatus>> =>
    installHook(replacePython)
  )
  ipcMain.handle(IPC.hookUninstall, (): Promise<OpResult<HookStatus>> => uninstallHook())
}
