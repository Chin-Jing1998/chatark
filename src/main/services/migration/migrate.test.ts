import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { MigrationProgress } from '@shared/types'

// 迁移删源走 shell.trashItem（真实回收站在测试环境不可用也不该被触碰）。
// 默认实现用 fs.rm 模拟"成功移入回收站"；个别用例改写为抛错以验证失败路径。
const trashItem = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ shell: { trashItem } }))

const { runMigration } = await import('./migrate')

let base = ''
let oldRoot = ''
let newRoot = ''

beforeEach(async () => {
  trashItem.mockReset()
  trashItem.mockImplementation(async (p: string) => {
    await fs.rm(p, { recursive: true, force: true })
  })
  base = await fs.mkdtemp(join(tmpdir(), 'chatark-migrate-'))
  oldRoot = join(base, 'old')
  newRoot = join(base, 'new')
  const conv = join(oldRoot, '专利', '20260101_120000_甲_abcd1234')
  await fs.mkdir(conv, { recursive: true })
  await fs.writeFile(join(conv, 'meta.json'), '{"sessionId":"x-abcd1234"}', 'utf8')
  await fs.writeFile(join(conv, '对话.md'), '# 甲', 'utf8')
})
afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

describe('runMigration', () => {
  it('复制-校验-切换-删源，源迁移到新根', async () => {
    const events: MigrationProgress[] = []
    let switched = false
    const r = await runMigration(
      oldRoot,
      newRoot,
      (p) => events.push(p),
      () => {
        switched = true
      }
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.movedFiles).toBe(2)
      expect(r.data.sourceKept).toEqual([])
    }
    expect(switched).toBe(true)
    // 新根含迁移内容
    await expect(
      fs.access(join(newRoot, '专利', '20260101_120000_甲_abcd1234', 'meta.json'))
    ).resolves.toBeUndefined()
    // 旧根顶层已清空
    const oldEntries = await fs.readdir(oldRoot)
    expect(oldEntries.length).toBe(0)
    // 末态为 done
    expect(events.at(-1)?.phase).toBe('done')
  })

  it('删源走系统回收站而非 fs.rm（误删可恢复）', async () => {
    await runMigration(oldRoot, newRoot, () => {}, () => {})
    expect(trashItem).toHaveBeenCalledTimes(1)
    expect(trashItem).toHaveBeenCalledWith(join(oldRoot, '专利'))
  })

  it('回收站不可用 → 迁移仍算成功，但如实上报旧内容仍在原处', async () => {
    trashItem.mockRejectedValue(new Error('该卷不支持回收站'))
    const r = await runMigration(oldRoot, newRoot, () => {}, () => {})
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.sourceKept).toEqual(['专利'])
    // 新根已有完整副本，旧数据保留在原处等用户处置——两边都在，绝不静默删除
    await expect(
      fs.access(join(newRoot, '专利', '20260101_120000_甲_abcd1234', 'meta.json'))
    ).resolves.toBeUndefined()
    await expect(
      fs.access(join(oldRoot, '专利', '20260101_120000_甲_abcd1234', 'meta.json'))
    ).resolves.toBeUndefined()
  })

  it('新旧路径相同 → INVALID_INPUT', async () => {
    const r = await runMigration(oldRoot, oldRoot, () => {}, () => {})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('INVALID_INPUT')
  })

  it('新根嵌套于旧根内 → INVALID_INPUT（防删源误删目标导致数据丢失）', async () => {
    const nested = join(oldRoot, 'inside')
    let switched = false
    const r = await runMigration(nested, oldRoot, () => {}, () => {
      switched = true
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('INVALID_INPUT')
    expect(switched).toBe(false)
    // 源未被触碰
    await expect(
      fs.access(join(oldRoot, '专利', '20260101_120000_甲_abcd1234', 'meta.json'))
    ).resolves.toBeUndefined()
  })
})
