import { ipcMain, dialog, BrowserWindow, type OpenDialogOptions } from 'electron'
import { promises as fs } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { IPC } from '@shared/ipc-channels'
import { fail, ok, type MigrationOutcome, type OpResult } from '@shared/types'
import { library } from '../services/library'
import { isDangerousRoot } from '../services/fs/sensitive-roots'
import { restartLibraryWatch } from '../watch-manager'

/** 目录是否为空（读失败/不存在按空处理，交后续 mkdir 兜底）。 */
async function isEmptyDir(p: string): Promise<boolean> {
  try {
    return (await fs.readdir(p)).length === 0
  } catch {
    return true
  }
}

/**
 * 换库根的前置校验——全部在主进程执行，不依赖渲染层的任何判断。
 *
 * 迁移成功后会把**旧根下全部顶层内容移入回收站**，因此这里必须挡住两类灾难：
 *  1) 新根是 home / Documents 一类总入口 → 下次再换根时会连带清空该目录；
 *  2) 当前根已经是这类目录（历史误设）→ 本次迁移就会清空它。
 */
async function validateNewRoot(newRoot: unknown, win: BrowserWindow | null): Promise<OpResult<string>> {
  if (typeof newRoot !== 'string' || !newRoot.trim() || !isAbsolute(newRoot)) {
    return fail('INVALID_INPUT', '保存路径必须是一个绝对路径')
  }
  const target = resolve(newRoot)

  if (isDangerousRoot(target)) {
    return fail(
      'INVALID_INPUT',
      '该目录是系统或个人数据的总入口，不能作为历史库根。请在其下新建一个专用子目录，例如「Documents/ChatArk 历史库」。'
    )
  }

  const current = library.getRoot()
  if (isDangerousRoot(current)) {
    return fail(
      'INVALID_INPUT',
      `当前保存路径「${current}」是系统或个人数据的总入口。迁移会清空旧路径下的全部内容，此处已阻止。请手动把历史库整理到一个专用子目录后再更换。`
    )
  }

  // 新根非空 → 迁移会与既有文件混杂，必须由用户明确确认
  if (!(await isEmptyDir(target))) {
    const opts = {
      type: 'warning' as const,
      buttons: ['取消', '仍然继续'],
      defaultId: 0,
      cancelId: 0,
      message: '目标目录不是空的',
      detail: `「${target}」下已有内容。迁移会把历史库全部文件复制进去，与既有文件混杂。\n\n迁移完成后，旧路径下的全部内容会被移入回收站。确认继续？`
    }
    const res = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
    if (res.response !== 1) return fail('INVALID_INPUT', '已取消')
  }

  return ok(target)
}

/** 注册库根设置与迁移 IPC。 */
export function registerLibraryIpc(): void {
  ipcMain.handle(IPC.libraryPickRoot, async (e): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择新的保存路径',
      // Electron 43 起 defaultPath 缺省指向"下载"而非系统记忆目录，显式给出当前库根更合用
      defaultPath: library.getRoot()
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })

  ipcMain.handle(
    IPC.librarySetRoot,
    async (e, newRoot: string): Promise<OpResult<MigrationOutcome>> => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const checked = await validateNewRoot(newRoot, win)
      if (!checked.ok) return checked

      const r = await library.setRoot(checked.data, (p) => e.sender.send(IPC.evtMigration, p))
      if (r.ok) {
        restartLibraryWatch()
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.evtLibrary)
      }
      return r
    }
  )
}
