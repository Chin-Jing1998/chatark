import { describe, it, expect, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import { scan } from '../fs/scan'
import { searchService } from './search'
import { resolveTestLibraryRoot } from '../../test-support/library-root'

// 库根解析：CHATARK_TEST_LIBRARY > 应用配置 > 默认路径，空库视同无库；找不到时整组跳过
const root = resolveTestLibraryRoot() ?? ''
const maybe = root ? describe : describe.skip

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

  it('增量重建：指纹未变的对话不重读磁盘', async () => {
    const r = await scan(root)
    const records = r.records.slice(0, 30)

    searchService.setSource(records)
    await searchService.query('权利要求') // 首次构建，读盘

    const readFile = vi.spyOn(fsp, 'readFile')
    try {
      // 同一批记录（指纹相同）再次注入 → 应全部复用已索引正文，一次盘都不读
      searchService.setSource(records)
      await searchService.query('权利要求')
      expect(readFile).not.toHaveBeenCalled()

      // 指纹变化的那一条必须被重读
      const changed = records.map((x, i) => (i === 0 ? { ...x, fingerprint: 'changed' } : x))
      searchService.setSource(changed)
      await searchService.query('权利要求')
      expect(readFile).toHaveBeenCalledTimes(records[0].files.md.exists ? 1 : 0)
    } finally {
      readFile.mockRestore()
    }
  })
})
