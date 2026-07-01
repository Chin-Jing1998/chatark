import chokidar, { type FSWatcher } from 'chokidar'

export interface LibraryWatcher {
  close(): Promise<void>
}

const DEBOUNCE_MS = 400

/**
 * 监听库根（仅下钻两层），外部变更去抖后回调一次。
 * 导出多文件写入用 awaitWriteFinish 等写完，避免半成品触发。
 */
export function startWatch(root: string, onChange: () => void): LibraryWatcher {
  let timer: ReturnType<typeof setTimeout> | null = null
  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(onChange, DEBOUNCE_MS)
  }

  const watcher: FSWatcher = chokidar.watch(root, {
    depth: 2,
    ignoreInitial: true,
    ignored: /(^|[/\\])\../, // 忽略隐藏文件/目录
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
  })

  watcher.on('add', schedule)
  watcher.on('unlink', schedule)
  watcher.on('addDir', schedule)
  watcher.on('unlinkDir', schedule)
  watcher.on('change', schedule)

  return {
    close: async () => {
      if (timer) clearTimeout(timer)
      await watcher.close()
    }
  }
}
