import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// install.ts 在模块加载时就据 homedir() 定下 SETTINGS 路径，故 mock 必须在导入之前生效。
const fakeHome = vi.hoisted(() => ({ dir: '' }))
vi.mock('node:os', async (orig) => {
  const actual = await orig<typeof import('node:os')>()
  return { ...actual, default: { ...actual, homedir: () => fakeHome.dir }, homedir: () => fakeHome.dir }
})
vi.mock('electron', () => ({ app: { isPackaged: true } }))

fakeHome.dir = await fs.mkdtemp(join(tmpdir(), 'chatark-hook-home-'))
const { installHook, uninstallHook, hookStatus } = await import('./install')

const settingsPath = (): string => join(fakeHome.dir, '.claude', 'settings.json')

async function writeSettings(raw: string): Promise<void> {
  await fs.mkdir(join(fakeHome.dir, '.claude'), { recursive: true })
  await fs.writeFile(settingsPath(), raw, 'utf8')
}

beforeEach(async () => {
  await fs.rm(join(fakeHome.dir, '.claude'), { recursive: true, force: true })
})
afterEach(async () => {
  await fs.rm(join(fakeHome.dir, '.claude'), { recursive: true, force: true })
})

describe('settings.json 写入安全', () => {
  it('解析失败时拒绝写入，原文件一字不改', async () => {
    const broken = '{ "permissions": { "allow": ["Bash"] },, }' // 多一个逗号
    await writeSettings(broken)

    const r = await installHook(false)

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('PARSE_ERROR')
    expect(await fs.readFile(settingsPath(), 'utf8')).toBe(broken)
  })

  it('顶层是数组等非对象 JSON 也算损坏，不覆盖', async () => {
    await writeSettings('["not", "an", "object"]')
    const r = await installHook(false)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('PARSE_ERROR')
    expect(await fs.readFile(settingsPath(), 'utf8')).toBe('["not", "an", "object"]')
  })

  it('卸载遇到损坏文件同样拒绝写入', async () => {
    await writeSettings('{ broken')
    const r = await uninstallHook()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('PARSE_ERROR')
    expect(await fs.readFile(settingsPath(), 'utf8')).toBe('{ broken')
  })

  it('正常安装保留既有配置，只增补 SessionEnd 钩子', async () => {
    await writeSettings(
      JSON.stringify({ permissions: { allow: ['Bash'] }, env: { FOO: 'bar' } }, null, 2)
    )

    const r = await installHook(false)

    expect(r.ok).toBe(true)
    const after = JSON.parse(await fs.readFile(settingsPath(), 'utf8'))
    expect(after.permissions).toEqual({ allow: ['Bash'] }) // 既有配置未被吞掉
    expect(after.env).toEqual({ FOO: 'bar' })
    expect(after.hooks.SessionEnd).toHaveLength(1)
    expect(await hookStatus()).toMatchObject({ installed: true })
  })

  it('文件不存在时可正常安装（absent 与 corrupt 区分对待）', async () => {
    const r = await installHook(false)
    expect(r.ok).toBe(true)
    const after = JSON.parse(await fs.readFile(settingsPath(), 'utf8'))
    expect(after.hooks.SessionEnd).toHaveLength(1)
  })

  it('反复开关只保留最近 5 个备份', async () => {
    await writeSettings(JSON.stringify({ env: {} }))
    for (let i = 0; i < 8; i++) {
      await installHook(false)
      await uninstallHook()
    }
    const baks = (await fs.readdir(join(fakeHome.dir, '.claude'))).filter((n) =>
      n.startsWith('settings.json.bak-')
    )
    expect(baks.length).toBeLessThanOrEqual(5)
  })
})
