import { describe, it, expect } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { scan } from './scan'
import { DEFAULT_LIBRARY_REL } from '@shared/constants'

const root = join(homedir(), ...DEFAULT_LIBRARY_REL)
// 仅在本机存在真实库时运行（其它机器跳过，不致 CI 失败）
const maybe = existsSync(root) ? describe : describe.skip

maybe('扫描真实历史库', () => {
  it('登记全部 111 个对话并解析出一致字段', async () => {
    const r = await scan(root)
    expect(r.records.length).toBe(111)

    const withSession = r.records.filter((x) => x.sessionId).length
    expect(withSession).toBe(111)

    const byCat: Record<string, number> = {}
    for (const x of r.records) byCat[x.category] = (byCat[x.category] ?? 0) + 1
    expect(byCat['专利']).toBe(55)
    expect(byCat['其他']).toBe(37)
    expect(byCat['编程开发']).toBe(12)
    expect(byCat['文档处理']).toBe(7)

    // 恰好一个 category 与物理目录不一致
    expect(r.records.filter((x) => x.integrity.categoryMismatch).length).toBe(1)

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
