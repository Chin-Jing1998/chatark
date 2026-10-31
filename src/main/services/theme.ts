import { nativeTheme } from 'electron'
import type { ThemeMode } from '@shared/api'

/**
 * 注入对话 HTML 的 data-theme 值：
 * - system → 'auto'（让对话走自身 prefers-color-scheme，随 nativeTheme 翻转）
 * - light / dark → 强制对齐
 */
export function injectTheme(): 'auto' | 'light' | 'dark' {
  const src = nativeTheme.themeSource as ThemeMode
  return src === 'system' ? 'auto' : src
}

/** 当前预设注入的对话令牌（null=默认，不覆盖）。由渲染层经 IPC 更新，供 convo:// 首屏注入。 */
let currentTokens: Record<string, string> | null = null

export function setThemeTokens(tokens: Record<string, string> | null): void {
  currentTokens = tokens && Object.keys(tokens).length > 0 ? tokens : null
}

/**
 * 当前令牌编译为注入 CSS（高优先级 `html[data-theme]{}`，置于 head 末尾，胜过模板 `:root`/`[data-theme="x"]`）。
 * 默认预设返回空串。
 */
/** 令牌值防注入：即便未来开放自定义主题，也不让值含 </style> 破坏注入的样式标签。 */
function safeForStyleTag(s: string): string {
  return s.replace(/<\/style>/gi, '<\\/style>')
}

/**
 * 令牌名白名单：只接受 CSS 自定义属性形态（--foo-bar）。
 * 键此前未做任何处理，一个形如 `}html{...` 的键即可闭合选择器、注入任意规则；
 * 值再怎么转义也拦不住。当前键均来自内置预设，此为防止后续开放自定义主题时留下缺口。
 */
const TOKEN_KEY_RE = /^--[A-Za-z0-9-]+$/

export function currentThemeTokensCss(): string {
  if (!currentTokens) return ''
  const decls = Object.entries(currentTokens)
    .filter(([k, v]) => TOKEN_KEY_RE.test(k) && typeof v === 'string')
    .map(([k, v]) => `${k}:${safeForStyleTag(v)}`)
    .join(';')
  if (!decls) return ''
  return `html[data-theme]{${decls}}`
}

/** 注入对话 HTML 的静态修正（与预设无关，恒定注入）。 */
const EMBED_FIX_CSS =
  // 目录·提问栏与右栏顶部对齐（模板 embed 仅调了 aside.right）
  'html.embed aside.left{top:12px;max-height:calc(100vh - 24px)}' +
  // 使存量库既有 对话.html 同步响应 A(M3E)/B(档案)/C(液态玻璃) 三套方案的容器圆角、底色与阴影变量
  'html.embed aside{border-radius:var(--aside-radius,14px)!important;box-shadow:var(--msg-shadow,var(--shadow))}' +
  'html.embed .msg{border-radius:var(--msg-radius,14px)!important;border-left-width:var(--msg-left-w,3px)!important;padding:var(--msg-pad,13px 16px)!important;box-shadow:var(--msg-shadow,var(--shadow))!important}' +
  'html.embed .msg.user_prompt{background:var(--user-card,var(--card))!important}' +
  'html.embed .msg.tool_call,html.embed .msg.tool_result{background:var(--tool-card,var(--card))!important}' +
  'html.embed pre.code,html.embed .prose pre code{border-radius:var(--code-radius,10px)!important}' +
  // 进度条过渡去抖，消除目录跳转时“顶部错位/慢恢复”的视觉
  'html.embed .prog-bar>i{transition:none!important}' +
  // 隐藏“实时”切换按钮：静态导出快照无需轮询/倒序，避免误触触发整页自动位移
  'html.embed #live{display:none!important}' +
  // 窄屏仍保留三栏（默认 iframe≈997px 卡在模板 1000px 塌缩阈值内 → 目录/会话信息本会被收起）
  '@media (min-width:640px) and (max-width:1000px){' +
  'html.embed .layout{grid-template-columns:var(--lw,208px) var(--lr,10px) minmax(0,1fr) var(--rr,10px) var(--rw,236px)!important}' +
  'html.embed .resizer{display:block!important}' +
  'html.embed aside.left{display:block!important;grid-column:1!important}' +
  'html.embed .feed{grid-column:3!important}' +
  'html.embed aside.right{display:block!important;position:sticky!important;grid-column:5!important;top:12px;max-height:calc(100vh - 24px)}' +
  '}'

/**
 * 编译注入对话 HTML 的 CSS：
 *  - 目录/正文/会话信息三栏顶部对齐 + 窄屏保留三栏 + 进度条去过渡（EMBED_FIX_CSS）；
 *  - 背景兜底（含按当前明暗的 --bg 回退值，根治旧模板对话“发灰”）；
 *  - 当前预设的整套配色令牌覆盖。
 */
export function buildInjectedCss(): string {
  const fallbackBg = nativeTheme.shouldUseDarkColors ? '#0d1117' : '#f4f5f7'
  return EMBED_FIX_CSS + `html,body{background:var(--bg,${fallbackBg})}` + currentThemeTokensCss()
}
