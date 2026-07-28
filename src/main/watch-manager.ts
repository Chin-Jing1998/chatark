import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc-channels'
import { library } from './services/library'
import { startWatch, type LibraryWatcher } from './services/fs/watch'

let watcher: LibraryWatcher | null = null
/** 串行化 restart/close：旧 watcher 必须先关干净，否则新旧并存会各触发一次重扫。 */
let chain: Promise<void> = Promise.resolve()

function broadcastLibraryChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.evtLibrary)
}

/** 以当前库根（重新）启动监听；库根变更后调用以指向新路径。 */
export function restartLibraryWatch(): void {
  chain = chain
    .then(async () => {
      await watcher?.close()
      watcher = startWatch(library.getRoot(), () => {
        if (library.isWatchSuppressed()) return
        void library.rescan().then(broadcastLibraryChanged)
      })
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
