/**
 * 时间解析与格式化。ISO8601(UTC) → 本地时区展示。
 *
 * 自 chat_export/timeutil.py 移植。展示一律使用运行机器本地时区（与 Python
 * datetime.astimezone() 行为一致），无时区信息的裸时间戳按 UTC 处理。
 */

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n)
}
function pad4(n: number): string {
  return String(n).padStart(4, '0')
}

/** 字符串是否带时区信息（结尾 Z 或 ±HH:MM / ±HHMM 偏移）。 */
function hasTimezone(s: string): boolean {
  return /[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)
}

/** 解析 ISO8601（含末尾 Z）为 Date；失败返回 null。
 *
 * 对齐 Python parse_iso：无时区信息的裸时间戳按 UTC 解释（JS 默认按本地，
 * 故此处显式补 Z 以避免偏差）。
 */
export function parseIso(s: unknown): Date | null {
  if (!s || typeof s !== 'string') return null
  const fixed = hasTimezone(s) ? s : s + 'Z'
  const d = new Date(fixed)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 解析并转本地时区（Date 内部即为绝对时刻，本地分量经 getXxx 读取）。 */
export function toLocal(s: unknown): Date | null {
  return parseIso(s)
}

/** 完整本地时间 YYYY-MM-DD HH:MM:SS。 */
export function fmtFull(s: unknown, fallback = '未知时间'): string {
  const dt = toLocal(s)
  if (!dt) return fallback
  return (
    `${pad4(dt.getFullYear())}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())} ` +
    `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}:${pad2(dt.getSeconds())}`
  )
}

/** 仅时分秒 HH:MM:SS。 */
export function fmtTime(s: unknown, fallback = ''): string {
  const dt = toLocal(s)
  if (!dt) return fallback
  return `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}:${pad2(dt.getSeconds())}`
}

/** 生成目录名用时间戳 YYYYMMDD_HHMMSS。fallbackEpoch 为秒级时间戳。 */
export function folderTimestamp(s: unknown, fallbackEpoch: number | null = null): string {
  let dt = toLocal(s)
  if (dt === null && fallbackEpoch !== null && fallbackEpoch !== undefined) {
    const cand = new Date(fallbackEpoch * 1000)
    dt = Number.isNaN(cand.getTime()) ? null : cand
  }
  if (!dt) return '00000000_000000'
  return (
    `${pad4(dt.getFullYear())}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}_` +
    `${pad2(dt.getHours())}${pad2(dt.getMinutes())}${pad2(dt.getSeconds())}`
  )
}

/** 当前本地时间的 ISO8601（带本地时区偏移）。对应 Python now().astimezone().isoformat()。 */
export function nowIso(): string {
  const d = new Date()
  const off = -d.getTimezoneOffset() // 分钟，东八区为 +480
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  const oh = pad2(Math.floor(abs / 60))
  const om = pad2(abs % 60)
  return (
    `${pad4(d.getFullYear())}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.` +
    `${String(d.getMilliseconds()).padStart(3, '0')}${sign}${oh}:${om}`
  )
}
