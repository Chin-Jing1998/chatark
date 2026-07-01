import { Menu, BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { IPC } from '@shared/ipc-channels'

/**
 * 安装应用菜单：
 *  1. 保留全部标准角色（编辑/窗口/缩放/开发者工具/退出等）；
 *  2. 把「重新加载」从默认 ⌘R 迁到 ⌘⇧R，释放 ⌘R；
 *  3. 用菜单加速键承载 ⌘O/⌘K/⌘R → 请渲染层打开命令面板。
 *     关键：菜单加速键在对话 iframe 获得焦点时仍生效，而渲染层 window.keydown 不会——
 *     这样「打开对话 / 全文搜索 / 最近打开」在最常见的“正在看某个对话”状态下也可用。
 */
export function installAppMenu(): void {
  const isMac = process.platform === 'darwin'

  const openCommand = (): void => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    win?.webContents.send(IPC.evtOpenCommand)
  }

  const template: MenuItemConstructorOptions[] = []

  if (isMac) template.push({ role: 'appMenu' })

  template.push(
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: '对话',
      submenu: [
        { label: '打开对话…', accelerator: 'CmdOrCtrl+O', click: openCommand },
        { label: '全文搜索…', accelerator: 'CmdOrCtrl+K', click: openCommand },
        { label: '最近打开…', accelerator: 'CmdOrCtrl+R', click: openCommand }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', accelerator: 'CmdOrCtrl+Shift+R' },
        { role: 'forceReload', accelerator: 'CmdOrCtrl+Alt+R' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  )

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
