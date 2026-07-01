import { describe, it, expect } from 'vitest'
import { viewerHost, viewerUrl } from './viewer'

describe('viewerHost（唯一且合法 host）', () => {
  it('输出 16 位十六进制、确定性', () => {
    const h = viewerHost('abc-123')
    expect(h).toMatch(/^[0-9a-f]{16}$/)
    expect(viewerHost('abc-123')).toBe(h) // 确定性
  })

  it('不同 id 不同 host（含中文 dir: 回退 id，旧实现会碰撞）', () => {
    // 旧实现剥掉中文后二者都塌缩成 dir20240115 → 碰撞；新哈希应区分
    const a = viewerHost('dir:专利/2024-01-15 专利检索')
    const b = viewerHost('dir:编程开发/2024-01-15 编程项目')
    expect(a).not.toBe(b)
    // sessionId 形态也应各不相同
    expect(viewerHost('e923fa9b-2eb4-4b17-882c-9c145fa9fd82')).not.toBe(
      viewerHost('f44f9f18-31dc-4da2-acb4-354a73b0f3b8')
    )
  })

  it('viewerUrl 使用 host 且对文件名转义', () => {
    const url = viewerUrl('abc')
    expect(url.startsWith(`convo://${viewerHost('abc')}/`)).toBe(true)
    expect(url).toContain(encodeURIComponent('对话.html'))
  })
})
