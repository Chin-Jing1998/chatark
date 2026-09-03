/**
 * 跨进程文件锁：获取与重入拒绝、陈旧锁（超时 / pid 消失 / 内容损坏）回收、
 * waitForFileLock 的超时与等待成功。全部写入临时目录。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { acquireFileLock, isFileLocked, releaseFileLock, waitForFileLock } from './file-lock'

const STALE_MS = 60_000
/** 远超系统 pid 上限，process.kill(pid, 0) 必然报错 → 判定为不存活 */
const DEAD_PID = 999_999

let root = ''
let lock = ''

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'chatark-lock-'))
  // 子目录不存在也应能建锁（locks/ 首次使用）
  lock = path.join(root, 'locks', 'session-abc.lock')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** 预置锁文件内容（绕过 acquireFileLock，模拟他人持有 / 陈旧 / 损坏）。 */
function seedLock(content: string): void {
  mkdirSync(path.dirname(lock), { recursive: true })
  writeFileSync(lock, content, 'utf8')
}

/** 把锁文件的 mtime 往前拨若干秒（模拟「不是刚刚创建的」）。 */
function ageLock(seconds: number): void {
  const t = new Date(Date.now() - seconds * 1000)
  utimesSync(lock, t, t)
}

describe('acquireFileLock / releaseFileLock', () => {
  it('首次获取成功并写入 pid，目录自动创建', () => {
    expect(acquireFileLock(lock, STALE_MS)).toBe(true)
    expect(existsSync(lock)).toBe(true)
    expect(JSON.parse(readFileSync(lock, 'utf8')).pid).toBe(process.pid)
    expect(isFileLocked(lock, STALE_MS)).toBe(true)
  })

  it('已持有时再次获取被拒（同进程重入也不放行）', () => {
    expect(acquireFileLock(lock, STALE_MS)).toBe(true)
    expect(acquireFileLock(lock, STALE_MS)).toBe(false)
  })

  it('释放后可再次获取', () => {
    acquireFileLock(lock, STALE_MS)
    releaseFileLock(lock)
    expect(existsSync(lock)).toBe(false)
    expect(acquireFileLock(lock, STALE_MS)).toBe(true)
  })

  it('不释放他人持有的锁', () => {
    const foreign = path.join(root, 'foreign.lock')
    writeFileSync(foreign, JSON.stringify({ pid: process.pid + 1, startedAt: Date.now() }), 'utf8')
    releaseFileLock(foreign)
    expect(existsSync(foreign)).toBe(true)
  })
})

describe('陈旧锁回收', () => {
  it('pid 已消失的锁被判为未加锁并清理', () => {
    seedLock(JSON.stringify({ pid: DEAD_PID, startedAt: Date.now() }))
    expect(isFileLocked(lock, STALE_MS)).toBe(false)
    expect(existsSync(lock)).toBe(false)
    expect(acquireFileLock(lock, STALE_MS)).toBe(true)
  })

  it('超过 staleMs 的锁失效，即使持有进程仍存活', () => {
    seedLock(JSON.stringify({ pid: process.pid, startedAt: Date.now() - 10_000 }))
    expect(isFileLocked(lock, 1_000)).toBe(false)
    expect(acquireFileLock(lock, 1_000)).toBe(true)
  })

  it('内容损坏且已过写入宽限期的锁视为不存在并清理', () => {
    seedLock('{not json')
    ageLock(10) // 10 秒前落地，远超 2 秒宽限
    expect(isFileLocked(lock, STALE_MS)).toBe(false)
    expect(acquireFileLock(lock, STALE_MS)).toBe(true)
  })

  it('刚落地的空锁文件按「他人正在创建」处理，不清理也不抢占', () => {
    seedLock('') // 独占创建后尚未写入 JSON 的瞬间
    expect(isFileLocked(lock, STALE_MS)).toBe(true)
    expect(acquireFileLock(lock, STALE_MS)).toBe(false)
    expect(existsSync(lock)).toBe(true)
  })

  it('空锁文件超过宽限期后可被回收', () => {
    seedLock('')
    ageLock(3)
    expect(acquireFileLock(lock, STALE_MS)).toBe(true)
    expect(JSON.parse(readFileSync(lock, 'utf8')).pid).toBe(process.pid)
  })
})

describe('waitForFileLock', () => {
  it('锁空闲时立即取得', async () => {
    await expect(waitForFileLock(lock, { staleMs: STALE_MS, maxWaitMs: 200, pollMs: 10 })).resolves.toBe(true)
  })

  it('持续被占用则到期返回 false，且不夺锁', async () => {
    seedLock(JSON.stringify({ pid: process.pid, startedAt: Date.now() }))
    const t0 = Date.now()
    const got = await waitForFileLock(lock, { staleMs: STALE_MS, maxWaitMs: 60, pollMs: 10 })
    expect(got).toBe(false)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(50)
    expect(existsSync(lock)).toBe(true)
  })

  it('等待期间被释放则取得成功', async () => {
    seedLock(JSON.stringify({ pid: process.pid, startedAt: Date.now() }))
    setTimeout(() => releaseFileLock(lock), 30)
    await expect(waitForFileLock(lock, { staleMs: STALE_MS, maxWaitMs: 1_000, pollMs: 10 })).resolves.toBe(true)
  })
})
