/**
 * 渲染 对话.html —— 自包含单文件离线查看器（数据内嵌、JS 内联）。
 *
 * 自 chat_export/render_html.py 移植。HTML/CSS/JS 模板（含查看器脚本）原样抽出为
 * template.html 字节复用，本模块仅负责"数据构建 + 占位符注入"，杜绝渲染漂移。
 */
import * as renderJs from './render-js'
import templateHtml from './template.html?raw'
import { GLASS_CSS, TOKENS_CSS } from './theme'
import { type Conversation } from './types'

/** HTML 转义（对齐 Python html.escape(quote=True)）。 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/** 纯字面量全量替换（对齐 Python str.replace，避免 $ 特殊处理）。 */
function replaceAllLiteral(src: string, find: string, repl: string): string {
  return src.split(find).join(repl)
}

/** 在第一个分隔符处切成两段（对齐 Python str.split(sep, 1)）。 */
function splitOnce(src: string, sep: string): [string, string] {
  const idx = src.indexOf(sep)
  if (idx < 0) return [src, '']
  return [src.slice(0, idx), src.slice(idx + sep.length)]
}

/** 渲染完整 HTML（template.html 已内联查看器脚本，仅余 4 个运行期占位符）。 */
export function render(conv: Conversation, live = false): string {
  const title = escapeHtml(conv.title || '对话记录')
  const data = renderJs.serialize(conv, live)
  // 先按 __DATA__ 切分：__TITLE__/__TOKENS__/__GLASS__ 均在数据脚本之前的头部段
  const [headTpl, tailTpl] = splitOnce(templateHtml, '__DATA__')
  let head = replaceAllLiteral(headTpl, '__TITLE__', title)
  head = replaceAllLiteral(head, '__TOKENS__', TOKENS_CSS)
  head = replaceAllLiteral(head, '__GLASS__', GLASS_CSS)
  return head + data + tailTpl
}
