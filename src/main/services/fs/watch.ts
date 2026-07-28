import chokidar, { type FSWatcher } from 'chokidar'
import { relative, sep } from 'node:path'

export interface LibraryWatcher {
  close(): Promise<void>
}

const DEBOUNCE_MS = 400
/** 监听出错后重建的等待时长（EMFILE 等瞬时故障需要缓一缓再试）。 */
const REBUILD_DELAY_MS = 5000

/**
 * 监听库根（仅下钻两层），外部变更去抖后回调一次。
 * 导出多文件写入用 awaitWriteFinish 等写完，避免半成品触发。
 */
export function startWatch(root: string, onChange: () => void): LibraryWatcher {
  let timer: ReturnType<typeof setTimeout> | null = null
  let rebuildTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  let watcher: FSWatcher | null = null

  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(onChange, DEBOUNCE_MS)
  }

  /**
   * 隐藏文件过滤只针对**库根之内的相对路径**。
   * 用绝对路径匹配会误伤整个库：库根本身若位于任一隐藏目录下（如 ~/.local/share/…），
   * 整棵树都会被判为忽略，监听静默失效、外部变更再也刷新不出来。
   */
  const ignored = (p: string): boolean => {
    const rel = relative(root, p)
    if (!rel || rel.startsWith('..')) return false // 库根自身不过滤
    return rel.split(sep).some((seg) => seg.startsWith('.'))
  }

  const build = (): void => {
    if (closed) return
    const w = chokidar.watch(root, {
      depth: 2,
      ignoreInitial: true,
      ignored,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
    })
    for (const ev of ['add', 'unlink', 'addDir', 'unlinkDir', 'change'] as const) {
      w.on(ev, schedule)
    }
    // 必须监听 error：EventEmitter 在无 'error' 监听器时会直接 throw，
    // 而库根被外部删除/改名、句柄耗尽（EMFILE）都会触发它 —— 那将击穿主进程。
    w.on('error', () => {
      void w.close().catch(() => undefined)
      watcher = null
      if (closed || rebuildTimer) return
      rebuildTimer = setTimeout(() => {
        rebuildTimer = null
        build()
        schedule() // 重建期间可能漏掉变更，主动刷一次
      }, REBUILD_DELAY_MS)
    })
    watcher = w
  }

  build()

  return {
    close: async () => {
      closed = true
      if (timer) clearTimeout(timer)
      if (rebuildTimer) clearTimeout(rebuildTimer)
      await watcher?.close().catch(() => undefined)
      watcher = null
    }
  }
}
