/**
 * 通用跨进程文件锁（自 migration/lock.ts 泛化）。
 *
 * 用途：GUI 与 SessionEnd 钩子拉起的无头进程之间互斥——迁移期间挡住导出、
 * 同一会话重复触发只允许一个 worker 落盘、titlegen 全局串行。
 *
 * 锁内容记 `{pid, startedAt}`；进程崩溃遗留的陈旧锁按「超时或 pid 已消失」自动失效，
 * 不会永久挡住后续操作。锁只是防并发的优化，任何异常一律按「未加锁」处理。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface FileLockData {
  pid: number
  startedAt: number
}

/** waitForFileLock 的默认轮询间隔。 */
const DEFAULT_POLL_MS = 200

/**
 * 锁文件「正在创建」的宽限期：`wx` 独占创建与写入 JSON 之间存在窗口，
 * 此刻另一进程读到的是空文件。宽限期内解析失败一律按「他人持有」处理，
 * 既不清理也不抢占，否则两个进程会同时认为自己拿到了锁。
 */
const LOCK_WRITE_GRACE_MS = 2000

/** 宽限期占位锁的 pid：非真实进程号，releaseFileLock 因而不会误删它。 */
const PLACEHOLDER_PID = 0

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

/** 文件 mtime（毫秒）；取不到返回 null。 */
function mtimeMsOf(p: string): number | null {
  try {
    return statSync(p).mtimeMs
  } catch {
    return null
  }
}

/** 读取锁；不存在、损坏、或已陈旧则返回 null（并顺手清掉无效锁文件）。 */
export function readActiveLock(p: string, staleMs: number): FileLockData | null {
  if (!existsSync(p)) return null
  let data: FileLockData
  try {
    data = JSON.parse(readFileSync(p, 'utf8')) as FileLockData
  } catch {
    // 刚落地的空/半截文件当作「他人正在创建」，超过宽限期才认定为损坏残留
    const mtimeMs = mtimeMsOf(p)
    if (mtimeMs !== null && Date.now() - mtimeMs < LOCK_WRITE_GRACE_MS) {
      return { pid: PLACEHOLDER_PID, startedAt: mtimeMs }
    }
    removeQuietly(p)
    return null
  }
  const stale =
    typeof data.pid !== 'number' ||
    typeof data.startedAt !== 'number' ||
    Date.now() - data.startedAt > staleMs ||
    !pidAlive(data.pid)
  if (stale) {
    removeQuietly(p)
    return null
  }
  return data
}

/** 锁是否被其他存活进程持有。 */
export function isFileLocked(p: string, staleMs: number): boolean {
  try {
    return readActiveLock(p, staleMs) !== null
  } catch {
    return false
  }
}

/**
 * 取得锁。已被存活进程持有（含本进程已持有）则返回 false。
 * 写入用 'wx' 独占创建，避免「读—写」间隙被另一进程抢先。
 */
export function acquireFileLock(p: string, staleMs: number): boolean {
  if (readActiveLock(p, staleMs)) return false
  try {
    mkdirSync(dirname(p), { recursive: true })
    const data: FileLockData = { pid: process.pid, startedAt: Date.now() }
    writeFileSync(p, JSON.stringify(data), { encoding: 'utf8', flag: 'wx' })
    return true
  } catch {
    return false
  }
}

/** 释放锁（仅释放本进程持有的，避免误删他人的锁）。 */
export function releaseFileLock(p: string): void {
  let cur: FileLockData | null = null
  try {
    cur = JSON.parse(readFileSync(p, 'utf8')) as FileLockData
  } catch {
    cur = null
  }
  if (cur && cur.pid !== process.pid) return
  removeQuietly(p)
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * 轮询等待并取得锁；到期仍未拿到返回 false（调用方据此降级，不应阻断主流程）。
 * 返回 true 表示本进程已持有锁，调用方负责 releaseFileLock。
 */
export async function waitForFileLock(
  p: string,
  opts: { staleMs: number; maxWaitMs: number; pollMs?: number }
): Promise<boolean> {
  const poll = opts.pollMs ?? DEFAULT_POLL_MS
  const deadline = Date.now() + opts.maxWaitMs
  for (;;) {
    if (acquireFileLock(p, opts.staleMs)) return true
    const left = deadline - Date.now()
    if (left <= 0) return false
    await sleep(Math.min(poll, left))
  }
}
