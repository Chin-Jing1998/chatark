import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { moveToCategory } from './move'
import { renameConversation } from './rename'
import { sanitizeTitleForDir } from './paths'
import { updateOrg, readOrg } from '../org/sidecar'

let root = ''
const DIR = '20260101_120000_测试标题_abcd1234'

async function makeConv(category: string): Promise<string> {
  const dir = join(root, category, DIR)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    join(dir, 'meta.json'),
    JSON.stringify({ sessionId: 'aa-bb-cc-abcd1234', title: '测试标题', category }, null, 2),
    'utf8'
  )
  await fs.writeFile(join(dir, '对话.html'), '<html data-theme="auto"></html>', 'utf8')
  await fs.writeFile(join(dir, '对话.md'), '# 测试标题', 'utf8')
  return dir
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'chatark-manage-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('管理动作 FS 服务', () => {
  it('moveToCategory 移动目录到目标分类', async () => {
    const dir = await makeConv('其他')
    const r = await moveToCategory(dir, '专利', root)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.newPath).toBe(join(root, '专利', DIR))
      await expect(fs.access(r.data.newPath)).resolves.toBeUndefined()
      await expect(fs.access(dir)).rejects.toBeDefined() // 原位置已不存在
    }
  })

  it('moveToCategory 目标已存在同名 → NAME_COLLISION', async () => {
    const dir = await makeConv('其他')
    await fs.mkdir(join(root, '专利', DIR), { recursive: true })
    const r = await moveToCategory(dir, '专利', root)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('NAME_COLLISION')
  })

  it('moveToCategory 分类名含 ../ 路径穿越 → INVALID_INPUT，且不移出库根', async () => {
    const dir = await makeConv('其他')
    const r = await moveToCategory(dir, '../../escape', root)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('INVALID_INPUT')
    // 源目录仍在原位、未被移出库根
    await expect(fs.access(dir)).resolves.toBeUndefined()
  })

  it('renameConversation 改 meta.title 与目录名标题段，保留 ts/hash，来源默认 user', async () => {
    const dir = await makeConv('其他')
    const r = await renameConversation(dir, '全新标题')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.newPath).toBe(join(root, '其他', '20260101_120000_全新标题_abcd1234'))
      const meta = JSON.parse(await fs.readFile(join(r.data.newPath, 'meta.json'), 'utf8'))
      expect(meta.title).toBe('全新标题')
      // 缺省即用户手改：重导出据此沿用标题，不再被自动命名覆盖
      expect(meta.titleSource).toBe('user')
      // html 快照不被改写
      const html = await fs.readFile(join(r.data.newPath, '对话.html'), 'utf8')
      expect(html).toContain('data-theme="auto"')
      // 原子写的临时文件已 rename 掉，且命名带 pid（并发改名不互相覆盖）
      const names = await fs.readdir(r.data.newPath)
      expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([])
    }
  })

  it('updateOrg 合并并持久化 sidecar', async () => {
    const dir = await makeConv('其他')
    const a = await updateOrg(dir, { pinned: true })
    expect(a.pinned).toBe(true)
    const b = await updateOrg(dir, { favorite: true })
    expect(b.pinned).toBe(true) // 合并保留
    expect(b.favorite).toBe(true)
    const read = await readOrg(dir)
    expect(read).toEqual({ pinned: true, favorite: true, archived: false, tags: [] })
  })
})

describe('sanitizeTitleForDir', () => {
  it('去非法字符、保留连字符与 CJK、限长', () => {
    expect(sanitizeTitleForDir('a/b:c*d')).toBe('abcd')
    expect(sanitizeTitleForDir('CN123-一种装置-新申请')).toBe('CN123-一种装置-新申请')
    expect(sanitizeTitleForDir('   ')).toBe('未命名会话')
    expect(sanitizeTitleForDir('x'.repeat(200)).length).toBeLessThanOrEqual(80)
  })
})
