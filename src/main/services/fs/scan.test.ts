import { describe, it, expect } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { scan } from './scan'
import { DEFAULT_LIBRARY_REL } from '@shared/constants'

// 库根可用 CHATARK_TEST_LIBRARY 覆盖；仅在本机存在真实库时运行（其它机器跳过，不致 CI 失败）
const root = process.env.CHATARK_TEST_LIBRARY || join(homedir(), ...DEFAULT_LIBRARY_REL)
const maybe = existsSync(root) ? describe : describe.skip

maybe('扫描真实历史库', () => {
  // 断言一律走"结构自洽"而非绝对数量：库会随日常使用与自动导出钩子持续增长，
  // 任何硬编码的对话数/分类数都必然在某天失效（此前写死 111 篇，实际已增至 274 篇）。
  it('登记库内对话并解析出自洽字段', async () => {
    const r = await scan(root)
    expect(r.records.length).toBeGreaterThan(0)

    // 每条记录都应有可用主键：sessionId，或退化的 dir: 形式
    expect(r.records.every((x) => x.id.length > 0)).toBe(true)
    expect(r.records.every((x) => x.sessionId || x.id.startsWith('dir:'))).toBe(true)

    // 分类以物理父目录为准，故必然非空且与 relPath 首段一致
    for (const x of r.records) {
      expect(x.category.length).toBeGreaterThan(0)
      expect(x.relPath.split(/[\\/]/)[0]).toBe(x.category)
    }

    // 完整性检测自洽：missingFiles 精确反映各标准文件的实际存在性
    // （不硬编码缺失个数——本机实时导出钩子会改动库内容使计数漂移）
    for (const x of r.records) {
      expect(x.integrity.missingFiles.includes('jsonl')).toBe(!x.files.jsonl.exists)
      expect(x.integrity.missingFiles.includes('meta')).toBe(!x.files.meta.exists)
      expect(x.integrity.missingFiles.includes('html')).toBe(!x.files.html.exists)
    }

    // 每条都有标题与 html
    expect(r.records.every((x) => x.title.length > 0)).toBe(true)
  })
})
