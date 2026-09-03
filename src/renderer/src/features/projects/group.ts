/**
 * 「按项目」视图的纯逻辑：cwd 归一化、公共前缀提取与按项目分组。
 * 无 React / DOM 依赖，便于单测；所有函数均返回新值，不修改入参。
 */
import type { ConversationSummary } from '@shared/types'
import { sortItems } from '@renderer/features/explorer/sort'

/** cwd 缺失时的兜底组名 */
export const UNKNOWN_PROJECT = '未知项目'

/** 一个项目分组：key 即归一化后的 cwd（未知项目为空串） */
export interface ProjectGroup {
  key: string
  cwd: string
  label: string
  items: ConversationSummary[]
  /** 组内最新的 startedAt（用于组间排序），全部缺失时为空串 */
  latestStartedAt: string
}

/**
 * 归一化工作目录：去首尾空白、反斜杠统一为斜杠、去尾部分隔符。
 * caseInsensitive 为真时转小写（Windows 路径大小写不敏感）。
 * 空值与纯空白返回空串；根目录「/」保留。
 */
export function normalizeCwd(cwd: string, caseInsensitive = false): string {
  const unified = cwd.trim().replace(/\\/g, '/')
  if (!unified) return ''
  const normalized = unified.replace(/\/+$/, '') || '/'
  return caseInsensitive ? normalized.toLowerCase() : normalized
}

/**
 * 求所有路径按「/」切段后的公共前缀段。
 * 前缀长度恒小于最短路径的段数——只有一条路径时即其父目录段，
 * 从而保证任一路径去掉前缀后至少剩一段，不会被整条吞掉。
 */
export function commonPrefixSegments(cwds: string[]): string[] {
  const lists = cwds
    .map((c) => normalizeCwd(c))
    .filter((c) => c !== '')
    .map((c) => c.split('/'))
  if (lists.length === 0) return []

  const first = lists[0]
  const minLen = Math.min(...lists.map((l) => l.length))
  let n = 0
  while (n < minLen && lists.every((l) => l[n] === first[n])) n += 1
  return first.slice(0, Math.min(n, minLen - 1))
}

/**
 * 项目显示名：默认取末段目录名；末段与其它项目重名时取末两段「a/b」消歧。
 * 空 cwd 返回 UNKNOWN_PROJECT。
 */
export function projectLabel(cwd: string, allCwds: string[]): string {
  const self = normalizeCwd(cwd)
  if (!self) return UNKNOWN_PROJECT

  const parts = self.split('/').filter(Boolean)
  if (parts.length === 0) return self
  const last = parts[parts.length - 1]

  const others = new Set(allCwds.map((c) => normalizeCwd(c)).filter((c) => c !== '' && c !== self))
  const duplicated = [...others].some((o) => {
    const op = o.split('/').filter(Boolean)
    return op.length > 0 && op[op.length - 1] === last
  })
  return duplicated ? parts.slice(-2).join('/') : last
}

/**
 * 去掉公共前缀后的相对表示（组头副标题用）：前缀命中时以「…/」开头，
 * 前缀为空或不匹配时返回归一化后的完整路径；空 cwd 返回空串。
 */
export function shortenCwd(cwd: string, prefixSegments: string[]): string {
  const self = normalizeCwd(cwd)
  if (!self) return ''

  const segs = self.split('/')
  const matched =
    prefixSegments.length > 0 &&
    prefixSegments.length < segs.length &&
    prefixSegments.every((p, i) => segs[i] === p)
  return matched ? `…/${segs.slice(prefixSegments.length).join('/')}` : self
}

/** 未知项目组恒排最后，其余按组内最新会话时间降序，同时间按路径升序保稳定。 */
function compareGroups(a: ProjectGroup, b: ProjectGroup): number {
  const rank = (g: ProjectGroup): number => (g.key === '' ? 1 : 0)
  if (rank(a) !== rank(b)) return rank(a) - rank(b)
  const byTime = b.latestStartedAt.localeCompare(a.latestStartedAt)
  return byTime !== 0 ? byTime : a.key.localeCompare(b.key)
}

/**
 * 按归一化 cwd 分组：组内按开始时间降序（置顶优先，复用浏览器排序），
 * 组间按最新会话时间降序、未知项目垫底。不修改入参。
 */
export function groupByProject(
  items: ConversationSummary[],
  openedAt: Record<string, number>,
  caseInsensitive = false
): ProjectGroup[] {
  const buckets = new Map<string, ConversationSummary[]>()
  for (const s of items) {
    const key = normalizeCwd(s.cwd ?? '', caseInsensitive)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(s)
    else buckets.set(key, [s])
  }

  const allCwds = [...buckets.keys()]
  return [...buckets.entries()]
    .map(([key, list]) => {
      const sorted = sortItems(list, 'started', 'desc', openedAt)
      return {
        key,
        cwd: key,
        label: projectLabel(key, allCwds),
        items: sorted,
        // 置顶项会被排到最前，故最新时间须取最大值而非首项
        latestStartedAt: sorted.reduce((max, s) => (s.startedAt > max ? s.startedAt : max), '')
      }
    })
    .sort(compareGroups)
}
