import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { findFreeTarget } from './free-path'

let root = ''
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'chatark-free-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('findFreeTarget（导入撞名不覆盖）', () => {
  it('目标空闲则原样返回', async () => {
    const t = join(root, 'X')
    expect(await findFreeTarget(t)).toBe(t)
  })

  it('X 与 X-2 都已存在 → 返回 X-3（不会落回 X-2 覆盖）', async () => {
    await fs.mkdir(join(root, 'X'))
    await fs.mkdir(join(root, 'X-2'))
    expect(await findFreeTarget(join(root, 'X'))).toBe(join(root, 'X-3'))
  })

  it('连续导入多个同名 → 依次得到独立路径', async () => {
    const base = join(root, 'X')
    const t1 = await findFreeTarget(base)
    await fs.mkdir(t1)
    const t2 = await findFreeTarget(base)
    await fs.mkdir(t2)
    const t3 = await findFreeTarget(base)
    expect(new Set([t1, t2, t3]).size).toBe(3)
    expect(t1).toBe(base)
    expect(t2).toBe(`${base}-2`)
    expect(t3).toBe(`${base}-3`)
  })
})
