import { createHash } from 'node:crypto'
import { DIR_NAME_RE } from '@shared/constants'

/** 并发受限的 map（默认上限 8），避免 stat/读取风暴。 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

/** 由关键文件的 size:mtime 拼出快速指纹。 */
export function fingerprintOf(parts: Array<{ sizeBytes: number; mtimeMs: number }>): string {
  const raw = parts.map((p) => `${p.sizeBytes}:${Math.round(p.mtimeMs)}`).join('|')
  return createHash('sha1').update(raw).digest('hex').slice(0, 16)
}

/** 解析对话目录名 `YYYYMMDD_HHMMSS_标题_哈希8`，失败返回 null。 */
export function parseDirName(
  dirName: string
): { ts: string; time: string; title: string; hash8: string } | null {
  const m = DIR_NAME_RE.exec(dirName)
  if (!m) return null
  return { ts: m[1], time: m[2], title: m[3], hash8: m[4] }
}

/** 提取 sessionId 末 8 位（先过滤为字母数字/-/_），用于与目录哈希比对。 */
export function sessionHash8(sessionId: string): string {
  const cleaned = [...sessionId].filter((c) => /[A-Za-z0-9_-]/.test(c)).join('')
  return cleaned.slice(-8)
}

const MAX_TITLE_SEG = 80
// 文件系统非法字符（Windows/macOS 并集）；保留连字符、空格、CJK、字母数字
const ILLEGAL_CHARS = new Set('<>:"/\\|?*')

/** 把标题净化为可用于目录名的片段：去非法字符与控制符、压空白、去尾部点/空格，限长。 */
export function sanitizeTitleForDir(title: string): string {
  let t = [...title]
    .filter((ch) => !ILLEGAL_CHARS.has(ch) && ch.charCodeAt(0) >= 0x20)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  if (t.length > MAX_TITLE_SEG) t = t.slice(0, MAX_TITLE_SEG)
  return t || '未命名会话'
}
