/**
 * 自动导出诊断日志：一行一事件的 `k=v` 记录，供排查「会话结束后没产生记录」类问题。
 *
 * 无头启动器与后台 worker 分属两个进程且都可能并发写，故：
 * ① 一律追加写（O_APPEND，单行小于 PIPE_BUF 时内核保证不交错）；
 * ② 轮转只在启动器打开 fd 前做一次，避免 worker 写到一半被换文件；
 * ③ 任何写失败静默——日志不该成为导出失败的原因。
 */
import { appendFileSync, mkdirSync, openSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

/** 超过此大小即轮转（保留一代 `.1`）。 */
const MAX_LOG_BYTES = 1024 * 1024

/** 需要加引号的字符：空白、等号、引号、反斜杠。 */
const NEEDS_QUOTE_RE = /[\s="\\]/

function ensureDir(p: string): void {
  mkdirSync(dirname(p), { recursive: true })
}

/** 超过 maxBytes 则把当前日志改名为 `<path>.1`（覆盖上一代），失败静默。 */
export function rotateIfLarge(p: string, maxBytes = MAX_LOG_BYTES): void {
  try {
    if (statSync(p).size <= maxBytes) return
    renameSync(p, `${p}.1`)
  } catch {
    /* 文件不存在或无权限：无需轮转 */
  }
}

/** 以追加模式打开日志并返回 fd（供 spawn 的 stdio 复用）；目录缺失时先建。 */
export function openLogFd(p: string): number {
  ensureDir(p)
  return openSync(p, 'a')
}

/**
 * 值序列化：含空白/等号/引号/反斜杠或为空串时加引号并转义。
 * 换行必须转义成字面量 `\n`：日志是一行一事件，取值里的裸换行会把一条记录劈成两行，
 * 后半行不含 ts/pid，按行解析日志时无法归属。
 */
function formatValue(v: string | number): string {
  const s = String(v)
  if (s !== '' && !NEEDS_QUOTE_RE.test(s)) return s
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
  return `"${escaped}"`
}

/** 追加一行事件记录，自动补 `ts=<ISO>` 与 `pid=`；写失败静默。 */
export function appendLogLine(p: string, fields: Record<string, string | number>): void {
  const parts = [`ts=${new Date().toISOString()}`, `pid=${process.pid}`]
  for (const [k, v] of Object.entries(fields)) parts.push(`${k}=${formatValue(v)}`)
  try {
    ensureDir(p)
    appendFileSync(p, `${parts.join(' ')}\n`, 'utf8')
  } catch {
    /* 日志不可写不应阻断导出 */
  }
}
