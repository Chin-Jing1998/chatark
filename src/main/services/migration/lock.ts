/**
 * 迁移期间的**跨进程**互斥锁。
 *
 * 必要性：library.suppressWatch 只压住 GUI 进程自己的文件监听，对 SessionEnd 钩子拉起的
 * 独立导出进程（`--export-stdin`）完全无效。迁移是"walk 快照 → 复制 → 删源"，期间若钩子
 * 往旧根写入新会话，该会话不在快照内 → 不被复制、却会被删源一并清掉，数据静默丢失。
 *
 * 锁文件落在 userData（GUI 与 headless 同一路径），内容记 pid 与起始时间；
 * 进程崩溃遗留的陈旧锁按"超时或 pid 已消失"自动失效，不会永久挡住自动导出。
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 超过此时长的锁视为陈旧（迁移再慢也不该超过；大库跨卷复制留足余量）。 */
const STALE_MS = 30 * 60 * 1000

interface LockData {
  pid: number
  startedAt: number
}

function lockPath(): string {
  return join(app.getPath('userData'), 'migration.lock')
}

/** 进程是否仍存活（signal 0 只做存在性探测，不实际发信号）。 */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM 表示进程存在但无权限发信号 → 仍算存活
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function removeQuietly(p: string): void {
  try {
    rmSync(p, { force: true })
  } catch {
    /* 权限等问题：留待陈旧判定下次再试 */
  }
}

/** 读取锁；不存在、损坏、或已陈旧则返回 null（并顺手清掉陈旧锁）。 */
function readActiveLock(): LockData | null {
  const p = lockPath()
  if (!existsSync(p)) return null
  let data: LockData
  try {
    data = JSON.parse(readFileSync(p, 'utf8')) as LockData
  } catch {
    removeQuietly(p)
    return null
  }
  const stale =
    typeof data.pid !== 'number' ||
    typeof data.startedAt !== 'number' ||
    Date.now() - data.startedAt > STALE_MS ||
    !pidAlive(data.pid)
  if (stale) {
    removeQuietly(p)
    return null
  }
  return data
}

/**
 * 迁移是否正在进行（供 headless 导出判断是否该让路）。
 * 任何异常都按"未加锁"处理：锁只是防并发的优化，不该让它本身成为导出失败的原因。
 */
export function isMigrationLocked(): boolean {
  try {
    return readActiveLock() !== null
  } catch {
    return false
  }
}

/** 取得迁移锁。已被其他存活进程持有则返回 false。 */
export function acquireMigrationLock(): boolean {
  if (readActiveLock()) return false
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    const data: LockData = { pid: process.pid, startedAt: Date.now() }
    writeFileSync(lockPath(), JSON.stringify(data), 'utf8')
    return true
  } catch {
    return false
  }
}

/** 释放迁移锁（仅释放本进程持有的，避免误删他人的锁）。 */
export function releaseMigrationLock(): void {
  const cur = readActiveLock()
  if (cur && cur.pid !== process.pid) return
  try {
    rmSync(lockPath(), { force: true })
  } catch {
    /* 释放失败留待陈旧判定兜底 */
  }
}
