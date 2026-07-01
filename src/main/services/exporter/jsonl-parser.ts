/**
 * JSONL 转录逐行解析。坏行容错，不整体失败。
 *
 * 自 chat_export/jsonl_parser.py 移植。读全文后按行解析（Node 端一次性读取，
 * 与 Python 逐行迭代等价；空行跳过、坏行计数、仅保留对象记录）。
 */
import { promises as fs } from 'node:fs'

import type { ParseStats, RawRecord } from './types'

export interface ParseResult {
  records: RawRecord[]
  stats: ParseStats
}

/** 把整段文本按行解析为有效记录列表（含坏行统计）。 */
export function parseText(text: string): ParseResult {
  const records: RawRecord[] = []
  let total = 0
  let bad = 0
  // 通用换行切分（\r\n / \r / \n），对齐 Python 文件迭代的 universal newlines
  const lines = text.split(/\r\n|\r|\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    total += 1
    let obj: unknown
    try {
      obj = JSON.parse(line)
    } catch {
      bad += 1
      continue
    }
    // 仅接受对象（与 Python isinstance(obj, dict) 一致；数组/标量计为坏行）
    if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
      records.push(obj as RawRecord)
    } else {
      bad += 1
    }
  }
  return { records, stats: { total_lines: total, bad_lines: bad, good_lines: records.length } }
}

/** 读全部有效记录为列表（含坏行统计）。读文件失败时按空处理后由上层报错。 */
export async function readAll(path: string): Promise<ParseResult> {
  const text = await fs.readFile(path, 'utf-8')
  return parseText(text)
}
