import { ipcMain, nativeTheme, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { ThemeMode } from '@shared/api'
import { setThemeTokens } from '../services/theme'

/** 注册主题 IPC：themeSource 为唯一真源，系统外观变化广播给所有窗口。 */
export function registerThemeIpc(): void {
  ipcMain.handle(IPC.themeSet, (_e, mode: ThemeMode): boolean => {
    nativeTheme.themeSource = mode
    return nativeTheme.shouldUseDarkColors
  })

  ipcMain.handle(IPC.themeSetTokens, (_e, tokens: Record<string, string> | null): void => {
    setThemeTokens(tokens)
  })

  nativeTheme.on('updated', () => {
    const payload = {
      source: nativeTheme.themeSource as ThemeMode,
      dark: nativeTheme.shouldUseDarkColors
    }
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IPC.themeChanged, payload)
    }
  })
}
