/**
 * 会话分类：cwd 路径规则优先 → 提问关键词 → 兜底。规则表可扩展。
 *
 * 自 chat_export/classifier.py 移植，规则表与判定顺序完全一致。
 */
import { EventType, type Conversation } from './types'

// 每条规则：[类别, cwd 正则源列表, 提问关键词正则源列表]
const CATEGORY_RULES: ReadonlyArray<[string, string[], string[]]> = [
  ['专利', ['CN\\d+', 'patent', '专利'], ['权利要求', '专利', '\\bOA\\b', '无效', '侵权', '交底书', '复审']],
  ['学术', ['academic', 'paper', '论文', 'thesis', 'sciverse'], ['论文', '文献', '综述', '引用', '期刊', '投稿']],
  [
    '编程开发',
    ['\\.git(/|$)', '/src/', '/code/', '\\brepos?\\b', 'claude.?code', '项目研究'],
    ['代码', '函数', '\\bbug\\b', '重构', '报错', '脚本', '调试', '编译']
  ],
  ['文档处理', ['docx', 'pandoc', '文档', '\\bword\\b', 'templates'], ['转换', '排版', '导出', '格式', '\\bword\\b', 'pdf']],
  ['检索调研', ['web-archive', 'research', '调研'], ['检索', '调研', '查证', '市场', '新闻', '事实核查']]
]
const DEFAULT_CATEGORY = '其他'

/** 任一正则（不区分大小写）命中目标串。 */
function anyMatch(patterns: string[], target: string): boolean {
  return patterns.some((p) => new RegExp(p, 'i').test(target))
}

/** 返回类别名。优先按 cwd，其次按提问文本关键词，最后兜底。 */
export function classify(conv: Conversation): string {
  const cwd = (conv.cwd || '').toLowerCase()
  if (cwd) {
    for (const [cat, cwdPats] of CATEGORY_RULES) {
      if (anyMatch(cwdPats, cwd)) return cat
    }
  }

  const sample = conv.events
    .filter((e) => e.etype === EventType.USER_PROMPT)
    .map((e) => e.text)
    .join(' ')
    .slice(0, 4000)
    .toLowerCase()
  if (sample) {
    for (const [cat, , kwPats] of CATEGORY_RULES) {
      if (anyMatch(kwPats, sample)) return cat
    }
  }

  return DEFAULT_CATEGORY
}
