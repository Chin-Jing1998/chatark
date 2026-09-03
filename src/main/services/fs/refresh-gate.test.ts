import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSuppressionGate, createRescanCoalescer, DEFAULT_GRACE_MS } from './refresh-gate'

describe('createSuppressionGate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('非抑制期的通知立即回放', () => {
    const replay = vi.fn()
    const gate = createSuppressionGate(replay)

    gate.notify()

    expect(replay).toHaveBeenCalledTimes(1)
    expect(gate.isSuppressed()).toBe(false)
  })

  it('抑制期内的多次通知合并为释放后的一次回放', () => {
    const replay = vi.fn()
    const gate = createSuppressionGate(replay)

    gate.begin()
    gate.notify()
    gate.notify()
    gate.notify()
    expect(replay).not.toHaveBeenCalled()

    gate.end()
    // 宽限期内仍不回放：等回声落定
    vi.advanceTimersByTime(DEFAULT_GRACE_MS - 1)
    expect(replay).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(replay).toHaveBeenCalledTimes(1)

    // 脏标记已清零，再等多久也不会重复回放
    vi.advanceTimersByTime(10 * DEFAULT_GRACE_MS)
    expect(replay).toHaveBeenCalledTimes(1)
  })

  it('抑制期内无通知则释放后不回放', () => {
    const replay = vi.fn()
    const gate = createSuppressionGate(replay)

    gate.begin()
    gate.end()
    vi.advanceTimersByTime(10 * DEFAULT_GRACE_MS)

    expect(replay).not.toHaveBeenCalled()
  })

  it('嵌套抑制只在最外层释放后回放一次', () => {
    const replay = vi.fn()
    const gate = createSuppressionGate(replay)

    gate.begin()
    gate.begin()
    gate.notify()
    gate.end() // 内层释放：仍在抑制中
    expect(gate.isSuppressed()).toBe(true)
    vi.advanceTimersByTime(10 * DEFAULT_GRACE_MS)
    expect(replay).not.toHaveBeenCalled()

    gate.end() // 最外层释放
    vi.advanceTimersByTime(DEFAULT_GRACE_MS)
    expect(replay).toHaveBeenCalledTimes(1)
    expect(gate.isSuppressed()).toBe(false)
  })

  it('宽限期内再次进入抑制会取消待触发的回放，直到再次释放', () => {
    const replay = vi.fn()
    const gate = createSuppressionGate(replay)

    gate.begin()
    gate.notify()
    gate.end()
    vi.advanceTimersByTime(DEFAULT_GRACE_MS - 100)
    expect(gate.isSuppressed()).toBe(true)

    gate.begin() // 宽限期内又起新操作
    vi.advanceTimersByTime(10 * DEFAULT_GRACE_MS)
    expect(replay).not.toHaveBeenCalled()

    gate.end()
    vi.advanceTimersByTime(DEFAULT_GRACE_MS)
    expect(replay).toHaveBeenCalledTimes(1)
  })

  it('多余的 end 不会让计数变负而误放行', () => {
    const replay = vi.fn()
    const gate = createSuppressionGate(replay)

    gate.end()
    gate.begin()
    gate.notify()
    vi.advanceTimersByTime(10 * DEFAULT_GRACE_MS)
    expect(replay).not.toHaveBeenCalled()

    gate.end()
    vi.advanceTimersByTime(DEFAULT_GRACE_MS)
    expect(replay).toHaveBeenCalledTimes(1)
  })
})

describe('createRescanCoalescer', () => {
  it('进行中的多个请求合并为一轮后续扫描，并拿到新一轮结果', async () => {
    const resolvers: Array<(value: string) => void> = []
    let runs = 0
    const coalescer = createRescanCoalescer<string>(() => {
      runs += 1
      return new Promise<string>((resolve) => resolvers.push(resolve))
    })

    const first = coalescer.request()
    expect(runs).toBe(1)

    // 第一轮进行中的两个请求：合并为同一个 pending
    const second = coalescer.request()
    const third = coalescer.request()
    expect(runs).toBe(1)

    resolvers[0]('第一轮')
    await expect(first).resolves.toBe('第一轮')
    // 第一轮结束后自动补跑一轮，兑现排队请求
    expect(runs).toBe(2)

    resolvers[1]('第二轮')
    await expect(second).resolves.toBe('第二轮')
    await expect(third).resolves.toBe('第二轮')
    expect(runs).toBe(2)
  })

  it('空闲时的请求各自独立成轮', async () => {
    let runs = 0
    const coalescer = createRescanCoalescer(async () => {
      runs += 1
      return runs
    })

    await expect(coalescer.request()).resolves.toBe(1)
    await expect(coalescer.request()).resolves.toBe(2)
    expect(runs).toBe(2)
  })

  it('run 抛错不卡死后续请求', async () => {
    let runs = 0
    const coalescer = createRescanCoalescer(async () => {
      runs += 1
      if (runs === 1) throw new Error('扫描失败')
      return '正常'
    })

    await expect(coalescer.request()).rejects.toThrow('扫描失败')
    await expect(coalescer.request()).resolves.toBe('正常')
    expect(runs).toBe(2)
  })

  it('run 同步抛错也转成 rejection，不让合并器卡在进行中', async () => {
    let runs = 0
    const coalescer = createRescanCoalescer<string>(() => {
      runs += 1
      if (runs === 1) throw new Error('同步失败')
      return Promise.resolve('正常')
    })

    await expect(coalescer.request()).rejects.toThrow('同步失败')
    await expect(coalescer.request()).resolves.toBe('正常')
  })
})
