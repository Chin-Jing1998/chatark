import { join } from 'node:path'
import { app, shell, BrowserWindow, nativeTheme, protocol } from 'electron'
import { CONVO_SCHEME } from '@shared/viewer'
import { registerIpc } from './ipc'
import { registerConvoScheme } from './protocol/register'
import { handleConvo } from './protocol/handler'
import { restartLibraryWatch, closeLibraryWatch } from './watch-manager'
import { parseHeadlessArgs, runHeadlessExport, runHeadlessMaintain } from './export-headless'
import { installAppMenu } from './app-menu'
import { pruneStaleTmp } from './services/hook/install'

const headless = parseHeadlessArgs(process.argv)

// 必须在 app ready 之前注册自定义协议为 privileged（仅 GUI 模式需要）
if (!headless) registerConvoScheme()

// 窗口最小尺寸与默认尺寸（命名常量，禁硬编码散落）
const WINDOW_DEFAULT = { width: 1320, height: 860, minWidth: 960, minHeight: 620 }

const isMac = process.platform === 'darwin'

/** 是否为可交给系统浏览器打开的安全外链（仅 http/https/mailto）。 */
function isExternallyOpenable(url: string): boolean {
  try {
    const scheme = new URL(url).protocol
    return scheme === 'http:' || scheme === 'https:' || scheme === 'mailto:'
  } catch {
    return false // 非法 URL：不外开
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...WINDOW_DEFAULT,
    show: false,
    // 无边框标题栏：macOS 保留红绿灯并内嵌；其它平台用 Window Controls Overlay 保留原生最小化/最大化/关闭
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 16, y: 13 } : undefined,
    titleBarOverlay: isMac ? undefined : { height: 40 },
    // 液态玻璃：macOS 用原生 vibrancy（窗口透明、桌面透过磨砂）；其它平台退回纯色底 + CSS 磨砂
    backgroundColor: isMac ? '#00000000' : '#101418',
    vibrancy: isMac ? 'under-window' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // 外链交系统浏览器，渲染进程绝不被导航离开；仅放行安全协议，拦截 file:/javascript: 等
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternallyOpenable(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 顶层导航一律拦截：渲染层只应加载本地打包页面，任何离开都视为异常（拖入链接、脚本改 location）。
  // http(s) 交系统浏览器，其余（file:/javascript:/data: 等）直接丢弃。
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return // 同页刷新
    event.preventDefault()
    if (isExternallyOpenable(url)) void shell.openExternal(url)
  })

  // webviewTag 已关闭，此处再兜一层：即便未来误开也不允许附加 webview
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  // 无界面模式（自动导出钩子 / 脚本 / 存量库维护）：跑完即退，不开窗
  if (headless) {
    if (headless.mode === 'maintain') void runHeadlessMaintain(headless)
    else void runHeadlessExport(headless)
    return
  }

  // Windows：设定 AppUserModelID（与 appId 一致），令任务栏图标/通知正确归属本应用
  app.setAppUserModelId('com.chatark.app')

  // 主题真源：默认跟随系统
  nativeTheme.themeSource = 'system'

  protocol.handle(CONVO_SCHEME, handleConvo)
  registerIpc()
  installAppMenu()
  createWindow()

  // 监听库根的外部变更：去抖后重扫并通知渲染层（自操作回声已被抑制）
  restartLibraryWatch()

  // 清理历次崩溃在 ~/.claude 留下的原子写残骸（不阻塞启动）
  void pruneStaleTmp()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})

app.on('before-quit', () => {
  closeLibraryWatch()
})
