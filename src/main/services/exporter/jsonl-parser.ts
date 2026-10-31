/**
 * JSONL 转录逐行解析。坏行容错，不整体失败。
 *
 * 自 chat_export/jsonl_parser.py 移植。读全文后按行解析（Node 端一次性读取，
 * 与 Python 逐行迭代等价；空行跳过、坏行计数、仅保留对象记录）。
 */
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

import { isCodexTranscript, normalizeCodexRecords } from './codex'
import type { ParseStats, RawRecord } from './types'

export interface ParseResult {
  records: RawRecord[]
  stats: ParseStats
  sourceClient?: 'claude' | 'codex'
}

/** 把整段文本按行解析为有效记录列表（含坏行统计）。 */
export function parseText(text: string, sourcePath?: string): ParseResult {
  const records: RawRecord[] = []
  const counts = { total: 0, bad: 0 }
  // 通用换行切分（\r\n / \r / \n），对齐 Python 文件迭代的 universal newlines
  for (const rawLine of text.split(/\r\n|\r|\n/)) feedLine(rawLine, records, counts)
  const goodLines = records.length
  const isCodex = isCodexTranscript(records)
  const finalRecords = isCodex ? normalizeCodexRecords(records, { sourcePath }) : records
  return {
    records: finalRecords,
    stats: { total_lines: counts.total, bad_lines: counts.bad, good_lines: goodLines },
    sourceClient: isCodex ? 'codex' : 'claude'
  }
}

/**
 * 单行 → 累积结果。parseText 与流式 readAll 共用，杜绝两条路径的解析语义漂移。
 * 仅接受对象（与 Python isinstance(obj, dict) 一致；数组/标量计为坏行）。
 */
function feedLine(rawLine: string, records: RawRecord[], counts: { total: number; bad: number }): void {
  const line = rawLine.trim()
  if (!line) return
  counts.total += 1
  let obj: unknown
  try {
    obj = JSON.parse(line)
  } catch {
    counts.bad += 1
    return
  }
  if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
    records.push(obj as RawRecord)
  } else {
    counts.bad += 1
  }
}

/**
 * 逐行流式读取有效记录（含坏行统计）。读文件失败时抛出，由上层报错。
 *
 * 用流而非一次性 readFile：长会话的 transcript 可达数百 MB，整体读入会产生
 * 「完整字符串 + split 出的行数组」两三倍的内存峰值，极端情况直接触及 V8 字符串上限；
 * 而自动导出跑在钩子里，失败是静默的。
 */
export async function readAll(path: string): Promise<ParseResult> {
  const records: RawRecord[] = []
  const counts = { total: 0, bad: 0 }
  const stream = createReadStream(path, { encoding: 'utf-8' })
  // crlfDelay 让 \r\n 与 \r 与 \n 一致处理，对齐 parseText 的通用换行切分
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) feedLine(line, records, counts)
  } finally {
    rl.close()
    stream.destroy()
  }
  const goodLines = records.length
  const isCodex = isCodexTranscript(records)
  const finalRecords = isCodex ? normalizeCodexRecords(records, { sourcePath: path }) : records
  return {
    records: finalRecords,
    stats: { total_lines: counts.total, bad_lines: counts.bad, good_lines: goodLines },
    sourceClient: isCodex ? 'codex' : 'claude'
  }
}
