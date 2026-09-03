import { describe, it, expect } from 'vitest'
import type { ConversationSummary } from '@shared/types'
import {
  UNKNOWN_PROJECT,
  commonPrefixSegments,
  groupByProject,
  normalizeCwd,
  projectLabel,
  shortenCwd
} from './group'

function mk(p: Partial<ConversationSummary> & { id: string }): ConversationSummary {
  return {
    id: p.id,
    sessionId: p.id,
    title: p.title ?? p.id,
    category: p.category ?? '其他',
    relPath: p.relPath ?? `其他/${p.id}`,
    model: p.model ?? 'opus',
    startedAt: p.startedAt ?? '',
    endedAt: p.endedAt ?? '',
    exportedAt: p.exportedAt ?? '',
    cwd: p.cwd ?? '',
    createdAtMs: p.createdAtMs ?? 0,
    messageCount: p.messageCount ?? 0,
    totalSizeBytes: p.totalSizeBytes ?? 0,
    org: p.org ?? { pinned: false, favorite: false, archived: false, tags: [] },
    integrity: p.integrity ?? {
      missingFiles: [],
      categoryMismatch: false,
      duplicateSessionId: false
    }
  }
}

describe('normalizeCwd', () => {
  it('去首尾空白并统一反斜杠为斜杠', () => {
    expect(normalizeCwd('  C:\\work\\app  ')).toBe('C:/work/app')
  })

  it('去掉尾部分隔符，根目录保留为 /', () => {
    expect(normalizeCwd('/Users/me/app///')).toBe('/Users/me/app')
    expect(normalizeCwd('/')).toBe('/')
  })

  it('空值与纯空白归一化为空串', () => {
    expect(normalizeCwd('')).toBe('')
    expect(normalizeCwd('   ')).toBe('')
  })

  it('caseInsensitive 为真时转小写', () => {
    expect(normalizeCwd('/Users/Foo/App', true)).toBe('/users/foo/app')
    expect(normalizeCwd('/Users/Foo/App')).toBe('/Users/Foo/App')
  })
})

describe('commonPrefixSegments', () => {
  it('单条路径返回其父目录段，不吞掉整条路径', () => {
    expect(commonPrefixSegments(['/Users/me/work/app'])).toEqual(['', 'Users', 'me', 'work'])
  })

  it('多条路径返回公共前缀段', () => {
    expect(commonPrefixSegments(['/Users/me/work/a', '/Users/me/work/b'])).toEqual([
      '',
      'Users',
      'me',
      'work'
    ])
  })

  it('公共前缀恒短于最短路径，避免其相对表示为空', () => {
    expect(commonPrefixSegments(['/a/b', '/a/b/c'])).toEqual(['', 'a'])
  })

  it('无公共前缀或输入为空时返回空数组', () => {
    expect(commonPrefixSegments(['/a/b', 'D:/x/y'])).toEqual([])
    expect(commonPrefixSegments([])).toEqual([])
    expect(commonPrefixSegments(['', '  '])).toEqual([])
  })
})

describe('shortenCwd', () => {
  it('命中前缀时以 …/ 开头', () => {
    expect(shortenCwd('/Users/me/work/app', ['', 'Users', 'me', 'work'])).toBe('…/app')
  })

  it('前缀为空或不匹配时返回归一化后的完整路径', () => {
    expect(shortenCwd('/Users/me/app', [])).toBe('/Users/me/app')
    expect(shortenCwd('/Users/me/app', ['', 'other'])).toBe('/Users/me/app')
    expect(shortenCwd('/Users/me/app/', ['', 'Users', 'me', 'app'])).toBe('/Users/me/app')
  })

  it('空 cwd 返回空串', () => {
    expect(shortenCwd('', ['', 'Users'])).toBe('')
  })
})

describe('projectLabel', () => {
  it('默认取末段目录名', () => {
    expect(projectLabel('/Users/me/work/chatark', ['/Users/me/work/chatark'])).toBe('chatark')
  })

  it('末段与其它项目重名时取末两段消歧', () => {
    const all = ['/Users/me/x/app', '/Users/me/y/app', '/Users/me/solo']
    expect(projectLabel('/Users/me/x/app', all)).toBe('x/app')
    expect(projectLabel('/Users/me/y/app', all)).toBe('y/app')
    expect(projectLabel('/Users/me/solo', all)).toBe('solo')
  })

  it('空 cwd 返回未知项目', () => {
    expect(projectLabel('', ['/a/b'])).toBe(UNKNOWN_PROJECT)
    expect(UNKNOWN_PROJECT).toBe('未知项目')
  })
})

describe('groupByProject', () => {
  it('按归一化 cwd 分组并给出各组条数', () => {
    const items = [
      mk({ id: 'a', cwd: '/w/p1', startedAt: '2026-01-01' }),
      mk({ id: 'b', cwd: '/w/p1/', startedAt: '2026-01-02' }),
      mk({ id: 'c', cwd: '/w/p2', startedAt: '2026-01-03' })
    ]
    const groups = groupByProject(items, {})
    expect(groups.map((g) => [g.key, g.items.length])).toEqual([
      ['/w/p2', 1],
      ['/w/p1', 2]
    ])
  })

  it('空 cwd 归入未知项目且恒排最后（即便其会话最新）', () => {
    const items = [
      mk({ id: 'a', cwd: '/w/p1', startedAt: '2026-01-01' }),
      mk({ id: 'u1', cwd: '', startedAt: '2026-09-01' }),
      mk({ id: 'u2', cwd: '   ', startedAt: '2026-08-01' })
    ]
    const groups = groupByProject(items, {})
    const last = groups[groups.length - 1]
    expect(groups).toHaveLength(2)
    expect(last.key).toBe('')
    expect(last.label).toBe(UNKNOWN_PROJECT)
    expect(last.items.map((s) => s.id)).toEqual(['u1', 'u2'])
  })

  it('末段重名的两个项目各自取末两段作为显示名', () => {
    const items = [
      mk({ id: 'a', cwd: '/w/x/app', startedAt: '2026-01-01' }),
      mk({ id: 'b', cwd: '/w/y/app', startedAt: '2026-01-02' })
    ]
    const labels = groupByProject(items, {}).map((g) => g.label)
    expect(labels).toEqual(['y/app', 'x/app'])
  })

  it('caseInsensitive 为真时大小写不同的同一路径合并为一组', () => {
    const items = [
      mk({ id: 'a', cwd: '/Users/Foo/App', startedAt: '2026-01-01' }),
      mk({ id: 'b', cwd: '/users/foo/app', startedAt: '2026-01-02' })
    ]
    expect(groupByProject(items, {}, true)).toHaveLength(1)
    expect(groupByProject(items, {}, true)[0].key).toBe('/users/foo/app')
    expect(groupByProject(items, {})).toHaveLength(2)
  })

  it('组间按最新会话时间降序，组内按开始时间降序且置顶优先', () => {
    const pinnedOld = mk({
      id: 'pin',
      cwd: '/w/alpha',
      startedAt: '2025-01-01',
      org: { pinned: true, favorite: false, archived: false, tags: [] }
    })
    const items = [
      mk({ id: 'a1', cwd: '/w/alpha', startedAt: '2026-01-01' }),
      mk({ id: 'b1', cwd: '/w/beta', startedAt: '2026-03-01' }),
      pinnedOld,
      mk({ id: 'a2', cwd: '/w/alpha', startedAt: '2026-02-01' })
    ]
    const groups = groupByProject(items, {})
    expect(groups.map((g) => g.key)).toEqual(['/w/beta', '/w/alpha'])
    expect(groups[1].items.map((s) => s.id)).toEqual(['pin', 'a2', 'a1'])
    // 置顶项排在最前，但组的最新时间仍取组内最大值
    expect(groups[1].latestStartedAt).toBe('2026-02-01')
  })

  it('不修改入参数组与其中的元素', () => {
    const items = [
      mk({ id: 'a', cwd: '/w/p1', startedAt: '2026-01-01' }),
      mk({ id: 'b', cwd: '/w/p2', startedAt: '2026-03-01' }),
      mk({ id: 'c', cwd: '/w/p1', startedAt: '2026-02-01' })
    ]
    const before = JSON.parse(JSON.stringify(items))
    const openedAt = { a: 1 }
    groupByProject(items, openedAt)
    expect(items.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(items).toEqual(before)
    expect(openedAt).toEqual({ a: 1 })
  })
})
