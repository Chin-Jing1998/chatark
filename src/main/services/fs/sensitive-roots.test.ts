import { describe, it, expect } from 'vitest'
import { homedir } from 'node:os'
import { join, parse } from 'node:path'
import { isDangerousRoot, isWithin } from './sensitive-roots'

const HOME = homedir()

describe('isDangerousRoot（过宽根目录判定）', () => {
  it('拒绝卷根与 home 自身', () => {
    expect(isDangerousRoot(parse(HOME).root)).toBe(true)
    expect(isDangerousRoot(HOME)).toBe(true)
  })

  it('拒绝用户数据总入口与 Claude Code 数据目录', () => {
    for (const d of ['Documents', 'Desktop', 'Downloads', '.claude', '.config']) {
      expect(isDangerousRoot(join(HOME, d)), d).toBe(true)
    }
  })

  it('精确匹配而非前缀匹配：这些目录下的子目录是合法库根', () => {
    expect(isDangerousRoot(join(HOME, 'Documents', 'ChatArk库'))).toBe(false)
    expect(isDangerousRoot(join(HOME, 'claude code 编程项目研究'))).toBe(false)
  })

  it('尾部分隔符与 .. 不能绕过判定', () => {
    expect(isDangerousRoot(`${join(HOME, 'Documents')}/`)).toBe(true)
    expect(isDangerousRoot(join(HOME, 'Documents', 'x', '..'))).toBe(true)
    expect(isDangerousRoot(join(HOME, 'proj', '..'))).toBe(true) // 归约到 home
  })

  it('空串视为危险（防止调用方漏传）', () => {
    expect(isDangerousRoot('')).toBe(true)
  })
})

describe('isWithin（预览白名单的范围判定）', () => {
  const base = join(HOME, 'proj')

  it('自身与子路径落在范围内', () => {
    expect(isWithin(base, base)).toBe(true)
    expect(isWithin(base, join(base, 'src', 'a.ts'))).toBe(true)
  })

  it('拒绝越界与同前缀的兄弟目录', () => {
    expect(isWithin(base, join(HOME, 'other', 'a.ts'))).toBe(false)
    // 关键：`proj-secret` 与 `proj` 共享字符串前缀，不得被误判为范围内
    expect(isWithin(base, join(HOME, 'proj-secret', 'a.ts'))).toBe(false)
  })

  it('拒绝经 .. 归约后落到范围外的路径', () => {
    expect(isWithin(base, join(base, '..', '.claude.json'))).toBe(false)
  })
})
