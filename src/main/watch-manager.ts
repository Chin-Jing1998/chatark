import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc-channels'
import { library } from './services/library'
import { startWatch, type LibraryWatcher } from './services/fs/watch'

let watcher: LibraryWatcher | null = null

function broadcastLibraryChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.evtLibrary)
}

/** 以当前库根（重新）启动监听；库根变更后调用以指向新路径。 */
export function restartLibraryWatch(): void {
  void watcher?.close()
  watcher = startWatch(library.getRoot(), () => {
    if (library.isWatchSuppressed()) return
    void library.rescan().then(broadcastLibraryChanged)
  })
}

export function closeLibraryWatch(): void {
  void watcher?.close()
  watcher = null
}
