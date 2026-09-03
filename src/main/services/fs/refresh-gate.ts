/**
 * 库刷新的两个纯逻辑闸门：自操作抑制（脏标记重放）与重扫合并。
 *
 * 独立成模块的理由：二者只依赖计时器，不碰文件系统与 electron，
 * 可用假计时器完整覆盖时序分支；library 只负责把它们接到真实的扫描与广播上。
 */

/** 抑制释放后的宽限期：吸收 chokidar 对自操作的回声，避免刚结束就被自己触发一次重扫。 */
export const DEFAULT_GRACE_MS = 1500

export interface SuppressionGate {
  /** 进入抑制（引用计数，支持嵌套操作）。 */
  begin(): void
  /** 退出一层抑制；最外层退出时起宽限计时，到期若有脏标记则重放一次。 */
  end(graceMs?: number): void
  /** 抑制中（含宽限期）。 */
  isSuppressed(): boolean
  /** 收到外部变更信号：抑制中只置脏标记，否则立即回放。 */
  notify(): void
}

/**
 * 自操作抑制闸门。
 *
 * 旧实现是「时间戳窗口 + 直接丢弃事件」，长操作期间的外部变更被永久丢弃，
 * 界面只能靠手动重扫恢复。此处改为脏标记：抑制期内的变更一律记账，
 * 释放并过宽限期后合并成一次回放，既不丢事件也不放大扫描次数。
 */
export function createSuppressionGate(onReplay: () => void): SuppressionGate {
  let depth = 0
  let dirty = false
  let graceTimer: ReturnType<typeof setTimeout> | null = null

  const clearGrace = (): void => {
    if (graceTimer === null) return
    clearTimeout(graceTimer)
    graceTimer = null
  }

  const suppressed = (): boolean => depth > 0 || graceTimer !== null

  return {
    begin(): void {
      clearGrace() // 宽限期内又起新操作：取消待触发的回放，等新操作结束后统一处理
      depth += 1
    },

    end(graceMs = DEFAULT_GRACE_MS): void {
      if (depth === 0) return // 多余的 end：忽略，不让计数变负
      depth -= 1
      if (depth > 0) return
      clearGrace()
      graceTimer = setTimeout(() => {
        graceTimer = null
        if (!dirty) return
        dirty = false
        onReplay()
      }, graceMs)
    },

    isSuppressed: suppressed,

    notify(): void {
      if (suppressed()) {
        dirty = true
        return
      }
      onReplay()
    }
  }
}

export interface RescanCoalescer<T> {
  /** 请求一轮扫描；保证拿到的结果不早于本次请求时刻。 */
  request(): Promise<T>
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * 重扫合并器。
 *
 * 旧实现是「进行中就复用同一次扫描」，请求方可能拿到早于自己发起时刻的快照——
 * 监听事件触发的重扫恰好赶上进行中的一轮时，新目录就此漏登记。此处改为：
 * 进行中的请求合并成一个 pending，等当前轮结束后另起一轮兑现，快照必然不早于请求时刻。
 */
export function createRescanCoalescer<T>(run: () => Promise<T>): RescanCoalescer<T> {
  let running = false
  let queued: Deferred<T> | null = null

  const startRound = (target: Deferred<T>): void => {
    running = true
    // 以 async 包一层：run 同步抛错也转成 rejection，不至于让 running 永远卡在 true
    void (async () => run())().then(
      (value) => settle(() => target.resolve(value)),
      (reason) => settle(() => target.reject(reason))
    )
  }

  const settle = (fulfill: () => void): void => {
    running = false
    const next = queued
    queued = null
    fulfill()
    if (next) startRound(next)
  }

  return {
    request(): Promise<T> {
      if (!running) {
        const d = deferred<T>()
        startRound(d)
        return d.promise
      }
      if (!queued) queued = deferred<T>()
      return queued.promise
    }
  }
}
