import { describe, it, expect } from 'vitest'
import { appendCapped, bump, pickLru, MAX_TABS, type Tab } from './tabs'

const mk = (id: string): Tab => ({ id, title: id, kind: 'conversation' })

describe('bump', () => {
  it('把 id 前置并去重', () => {
    expect(bump(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
    expect(bump(['a', 'b'], 'x')).toEqual(['x', 'a', 'b'])
  })
})

describe('pickLru', () => {
  it('返回近用列表中最久未用、且非 keepId 的开着标签', () => {
    const tabs = ['a', 'b', 'c'].map(mk)
    // recency 最近在前：a 最近、c 最久
    expect(pickLru(tabs, ['a', 'b', 'c'], 'a')).toBe('c')
  })
  it('跳过已不在 tabs 中的陈旧 id', () => {
    const tabs = ['a', 'b'].map(mk)
    expect(pickLru(tabs, ['a', 'b', 'zombie'], 'a')).toBe('b')
  })
  it('近用列表缺失时回退到首个非 keepId 标签', () => {
    const tabs = ['a', 'b'].map(mk)
    expect(pickLru(tabs, [], 'a')).toBe('b')
  })
})

describe('appendCapped', () => {
  it('未达上限时直接追加', () => {
    const tabs = ['a', 'b'].map(mk)
    const out = appendCapped(tabs, ['b', 'a'], mk('c'))
    expect(out.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('达上限时淘汰最久未用者并保留新标签', () => {
    const ids = Array.from({ length: MAX_TABS }, (_, i) => `t${i}`)
    const tabs = ids.map(mk)
    // 近用列表：t0 最近 … t9 最久 → 应淘汰 t9
    const recency = [...ids] // t0 最近
    const out = appendCapped(tabs, bump(recency, 'new'), mk('new'))
    expect(out.length).toBe(MAX_TABS)
    expect(out.some((t) => t.id === 'new')).toBe(true)
    expect(out.some((t) => t.id === 't9')).toBe(false)
    expect(out.some((t) => t.id === 't0')).toBe(true)
  })

  it('绝不淘汰新打开的标签', () => {
    const ids = Array.from({ length: MAX_TABS }, (_, i) => `t${i}`)
    const tabs = ids.map(mk)
    const out = appendCapped(tabs, bump(ids, 'new'), mk('new'))
    expect(out.find((t) => t.id === 'new')).toBeTruthy()
    expect(out.length).toBe(MAX_TABS)
  })
})
