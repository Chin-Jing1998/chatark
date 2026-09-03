/**
 * 补导出列表的展示判定：只列导出后真能入库的会话。
 *
 * 回归背景：起名调用曾在 ~/.claude/projects 留下 264 个一问一答的派生会话，
 * 它们必然被 skipReason 拒之门外，却长期占满补录列表（实测一次列出 272 条）。
 */
import { describe, expect, it } from 'vitest'

import { isOfferable } from './scan-raw'

const base = { title: '重构导出流程', turns: 12, model: 'claude-fable-5-1' }

describe('isOfferable', () => {
  it('正常会话可列出', () => {
    expect(isOfferable(base)).toBe(true)
  })

  it('haiku 主导的会话不列出', () => {
    expect(isOfferable({ ...base, model: 'claude-haiku-4-5-20251001' })).toBe(false)
  })

  it('起名派生的会话不列出', () => {
    expect(isOfferable({ ...base, title: '你是对话标题生成器。根据下面的项目路径与对话内容' })).toBe(false)
    expect(isOfferable({ ...base, title: '为下面 12 个对话各生成一个中文主题标题' })).toBe(false)
    expect(isOfferable({ ...base, title: 'Below is a conversation log from a coding session' })).toBe(false)
  })

  it('实质消息不足的空壳会话不列出', () => {
    expect(isOfferable({ ...base, turns: 0 })).toBe(false)
    expect(isOfferable({ ...base, turns: 1 })).toBe(false)
    expect(isOfferable({ ...base, turns: 2 })).toBe(true)
  })

  it('读不出信息时不擅自隐藏', () => {
    expect(isOfferable(null)).toBe(true)
  })

  it('模型字段缺失不影响判定', () => {
    expect(isOfferable({ ...base, model: null })).toBe(true)
  })
})
