import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc-channels'
import { library } from './services/library'
import { startWatch, type LibraryWatcher } from './services/fs/watch'

let watcher: LibraryWatcher | null = null
/** 串行化 restart/close：旧 watcher 必须先关干净，否则新旧并存会各触发一次重扫。 */
let chain: Promise<void> = Promise.resolve()
/** 库变更回调只挂一次：restartLibraryWatch 会被库根变更反复调用。 */
let changeHooked = false

/** 向全部窗口广播库变更（重扫已完成，渲染层据此重新拉列表）。 */
export function broadcastLibraryChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.evtLibrary)
}

/** 以当前库根（重新）启动监听；库根变更后调用以指向新路径。 */
export function restartLibraryWatch(): void {
  if (!changeHooked) {
    library.onChange(broadcastLibraryChanged)
    changeHooked = true
  }
  chain = chain
    .then(async () => {
      await watcher?.close()
      // 事件一律交给 library 的刷新闸门：自操作期间记脏标记、释放后合并重放，
      // 不再像旧实现那样在抑制期直接丢弃（丢弃会让界面永远看不到期间的新对话）
      watcher = startWatch(library.getRoot(), () => library.notifyExternalChange())
    })
    .catch(() => undefined)
}

export function closeLibraryWatch(): void {
  chain = chain
    .then(async () => {
      await watcher?.close()
      watcher = null
    })
    .catch(() => undefined)
}
