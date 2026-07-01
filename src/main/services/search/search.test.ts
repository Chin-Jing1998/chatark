import { describe, it, expect } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { scan } from '../fs/scan'
import { searchService } from './search'
import { DEFAULT_LIBRARY_REL } from '@shared/constants'

const root = join(homedir(), ...DEFAULT_LIBRARY_REL)
const maybe = existsSync(root) ? describe : describe.skip

maybe('全文搜索（真实库）', () => {
  it('能按正文/标题命中并按精确子串校验', async () => {
    const r = await scan(root)
    searchService.setSource(r.records)

    // “权利要求”在专利类对话中高频出现
    const hits = await searchService.query('权利要求', 100)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((h) => h.snippet.length > 0)).toBe(true)
    // 命中应可在记录集中找到对应 id
    const ids = new Set(r.records.map((x) => x.id))
    expect(hits.every((h) => ids.has(h.id))).toBe(true)

    // 运行时随机串保证库中不存在 → 零命中
    // （不用固定字面量：本会话可能被实时导出钩子写进库，固定串会自污染）
    const needle = `nomatch-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const none = await searchService.query(needle, 50)
    expect(none.length).toBe(0)
  })

  it('短查询（<3 字）回退子串匹配', async () => {
    const r = await scan(root)
    searchService.setSource(r.records)
    const hits = await searchService.query('专利', 200)
    expect(hits.length).toBeGreaterThan(0)
  })

  it('build 期间 setSource 不被 dirty=false 覆盖（并发不丢新数据）', async () => {
    const r = await scan(root)
    searchService.setSource(r.records.slice(0, 20)) // 有真实 md 供 build 读、能挂起
    const p = searchService.query('权利要求') // 触发 build，在 mapLimit 处让出事件循环
    searchService.setSource([]) // build 让出期间清空 sources → 应置 dirty，下次重建为空
    await p
    const hits = await searchService.query('权利要求')
    // 修复前：build 末尾 dirty=false 覆盖了上面的置脏 → 仍用旧 20 条索引 → 有命中（bug）
    // 修复后：dirty 保持 → 重建为空 sources → 零命中
    expect(hits.length).toBe(0)
  })
})
