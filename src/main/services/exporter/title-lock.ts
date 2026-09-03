/**
 * titlegen 全局锁的回调工厂。
 *
 * 起名会拉起 claude 子进程，成批结束会话时若各进程并发起名会打满机器，故全局串行。
 * 锁参数从无头 worker 抽出到此处共享：GUI 侧补导出（backfill/scan-raw）与
 * SessionEnd 钩子链路（headless/cli）必须用同一把锁、同一组时限，否则两端各起各的名。
 */
import { join } from 'node:path'

import { locksDir } from '../app-paths'
import { releaseFileLock, waitForFileLock } from '../fs/file-lock'

/** 锁文件名（位于 `<userData>/locks/`）。 */
export const TITLE_LOCK_FILE = 'titlegen.lock'
/** 陈旧阈值：单次起名远快于此，超时即认定持有者已崩溃。 */
export const TITLE_LOCK_STALE_MS = 120_000
/** 等待上限：到期仍未拿到锁即放弃本次起名，保留本地标题。 */
export const TITLE_LOCK_WAIT_MS = 45_000
/** 轮询间隔。 */
export const TITLE_LOCK_POLL_MS = 500

/** exportSession 的起名互斥回调对。 */
export interface TitleLockCallbacks {
  acquireTitleLock: () => Promise<boolean>
  releaseTitleLock: () => void
}

/** 按 userData 目录生成一对起名锁回调，直接展开进 exportSession 的入参。 */
export function titleLockCallbacks(userData: string): TitleLockCallbacks {
  const lockPath = join(locksDir(userData), TITLE_LOCK_FILE)
  return {
    acquireTitleLock: () =>
      waitForFileLock(lockPath, {
        staleMs: TITLE_LOCK_STALE_MS,
        maxWaitMs: TITLE_LOCK_WAIT_MS,
        pollMs: TITLE_LOCK_POLL_MS
      }),
    releaseTitleLock: () => releaseFileLock(lockPath)
  }
}
