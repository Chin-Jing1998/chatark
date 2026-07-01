/**
 * textutil 单测：对照 Python chat_export.textutil 的参考输出逐字节校验。
 *
 * 重点覆盖 truncateBytes 的多字节边界丢弃（Node Buffer 与 Python decode(errors='ignore')
 * 的对齐），这是黄金回归未覆盖（库内无"截断且源仍在"样本）的高风险点。
 */
import { describe, expect, it } from 'vitest'

import { cleanInline, isNoise, normalizeToolResultContent, sanitizeFilename, truncateBytes } from './textutil'

/** 复刻 Python 截断标记格式。 */
function marker(omitted: number, orig: number): string {
  return `\n\n[... 已截断 ${omitted} 字节，原始共 ${orig} 字节 ...]\n\n`
}

describe('truncateBytes（与 Python 参考逐字节一致）', () => {
  it('未超阈值原样返回', () => {
    const [text, trunc, orig, shown] = truncateBytes('hello', 1024)
    expect(text).toBe('hello')
    expect(trunc).toBe(false)
    expect(orig).toBe(5)
    expect(shown).toBe(5)
  })

  it('纯 ASCII 截断', () => {
    const input = 'A'.repeat(100) + 'B'.repeat(100)
    const [text, trunc, orig, shown] = truncateBytes(input, 50)
    expect(text).toBe('A'.repeat(45) + marker(150, 200) + 'B'.repeat(5))
    expect(trunc).toBe(true)
    expect(orig).toBe(200)
    expect(shown).toBe(107)
  })

  it('中文（3 字节/字）切口丢弃残缺尾字节', () => {
    const input = '中'.repeat(100)
    const [text, trunc, orig, shown] = truncateBytes(input, 64)
    // head=57B=19 字；tail=7B → 保 2 字（6B），丢 1 残字节
    expect(text).toBe('中'.repeat(19) + marker(237, 300) + '中'.repeat(2))
    expect(trunc).toBe(true)
    expect(orig).toBe(300)
    expect(shown).toBe(120)
  })

  it('emoji（4 字节）边界丢弃', () => {
    const input = '😀'.repeat(60)
    const [text, trunc, orig, shown] = truncateBytes(input, 50)
    expect(text).toBe('😀'.repeat(11) + marker(192, 240) + '😀'.repeat(1))
    expect(trunc).toBe(true)
    expect(orig).toBe(240)
    expect(shown).toBe(105)
  })

  it('中英混排切口', () => {
    const input = 'héllo 世界 '.repeat(30)
    const [text, trunc, orig, shown] = truncateBytes(input, 80)
    const head = 'héllo 世界 '.repeat(5) + 'h'
    const tail = ' 世界 '
    expect(text).toBe(head + marker(341, 420) + tail)
    expect(trunc).toBe(true)
    expect(orig).toBe(420)
    expect(shown).toBe(136)
  })
})

describe('isNoise', () => {
  const cases: Array<[string, boolean]> = [
    ['<command-name>foo</command-name>', true],
    ['  <system-reminder>x', true],
    ['正常文本', false],
    ['Caveat: bla', true],
    ['This session is being continued from a prior one', true]
  ]
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${expected}`, () => {
      expect(isNoise(input)).toBe(expected)
    })
  }
})

describe('sanitizeFilename（与 Python 一致）', () => {
  const cases: Array<[string, string]> = [
    ['a/b:c*d', 'abcd'],
    ['  hello   world  ', 'hello_world'],
    ['___...', '未命名'],
    ['中文 标题/含非法<>', '中文_标题含非法']
  ]
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${expected}`, () => {
      expect(sanitizeFilename(input)).toBe(expected)
    })
  }
})

describe('cleanInline（与 Python 一致）', () => {
  it('剥离注入块 + Markdown 标记', () => {
    expect(cleanInline('<command-name>x</command-name> 你好 **粗** `code`')).toBe('你好 粗 code')
  })
  it('折叠多行与标题号', () => {
    expect(cleanInline('# 标题\n多行\n文本')).toBe('标题 多行 文本')
  })
})

describe('normalizeToolResultContent', () => {
  it('字符串直通', () => {
    expect(normalizeToolResultContent('plain')).toEqual(['plain', []])
  })
  it('文本块 + 图片块 → 文本含占位、附件单列', () => {
    const [text, atts] = normalizeToolResultContent([
      { type: 'text', text: 'hello' },
      { type: 'image', source: { media_type: 'image/png', data: 'AAAA' } }
    ])
    expect(text).toBe('hello\n[图片 image/png, base64 约 4 字节，已省略]')
    expect(atts).toHaveLength(1)
    expect(atts[0]).toMatchObject({ kind: 'image', media_type: 'image/png', bytes: 4 })
  })
})
