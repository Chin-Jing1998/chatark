import { ipcMain, dialog, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { ConfirmOptions } from '@shared/api'

/** 注册 UI 原生对话框 IPC：非阻塞确认框（替代渲染层同步 window.confirm）。 */
export function registerUiIpc(): void {
  ipcMain.handle(IPC.uiConfirm, async (e, opts: ConfirmOptions): Promise<boolean> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const config = {
      type: (opts.danger ? 'warning' : 'question') as 'warning' | 'question',
      buttons: ['取消', opts.confirmLabel ?? '确定'],
      defaultId: 1,
      cancelId: 0,
      message: opts.message,
      detail: opts.detail
    }
    const res = win
      ? await dialog.showMessageBox(win, config)
      : await dialog.showMessageBox(config)
    return res.response === 1
  })
}
