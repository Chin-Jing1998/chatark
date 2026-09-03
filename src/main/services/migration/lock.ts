/**
 * 迁移期间的**跨进程**互斥锁。
 *
 * 必要性：library.suppressWatch 只压住 GUI 进程自己的文件监听，对 SessionEnd 钩子拉起的
 * 独立导出进程（`--export-stdin`）完全无效。迁移是"walk 快照 → 复制 → 删源"，期间若钩子
 * 往旧根写入新会话，该会话不在快照内 → 不被复制、却会被删源一并清掉，数据静默丢失。
 *
 * 锁文件落在 userData（GUI 与 headless 同一路径），通用语义由 fs/file-lock 提供：
 * 内容记 pid 与起始时间，进程崩溃遗留的陈旧锁按"超时或 pid 已消失"自动失效。
 */
import { join } from 'node:path'

import { resolveUserDataDir } from '../app-paths'
import { acquireFileLock, isFileLocked, releaseFileLock } from '../fs/file-lock'

/** 超过此时长的锁视为陈旧（迁移再慢也不该超过；大库跨卷复制留足余量）。 */
const STALE_MS = 30 * 60 * 1000

function lockPath(): string {
  return join(resolveUserDataDir(), 'migration.lock')
}

/**
 * 迁移是否正在进行（供 headless 导出判断是否该让路）。
 * 任何异常都按"未加锁"处理：锁只是防并发的优化，不该让它本身成为导出失败的原因。
 */
export function isMigrationLocked(): boolean {
  return isFileLocked(lockPath(), STALE_MS)
}

/** 取得迁移锁。已被其他存活进程持有则返回 false。 */
export function acquireMigrationLock(): boolean {
  return acquireFileLock(lockPath(), STALE_MS)
}

/** 释放迁移锁（仅释放本进程持有的，避免误删他人的锁）。 */
export function releaseMigrationLock(): void {
  releaseFileLock(lockPath())
}
