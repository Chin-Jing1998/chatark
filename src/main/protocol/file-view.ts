/**
 * 任意文件视图：把对话里生成的文件按类型渲染为主题化 HTML 送入 iframe。
 * - .md/.markdown → markdown-it 排版 + highlight.js 代码高亮
 * - 代码类 → highlight.js 高亮 <pre><code>
 * - .html/.htm → 原样返回（CSP 受控）
 * - 图片 → 按 content-type 直出字节
 * - 过大/二进制/未知 → 主题化占位
 * 配色复用当前预设注入令牌（currentThemeTokensCss），并随主题消息热切换。
 */
import { promises as fs } from 'node:fs'
import { basename, extname } from 'node:path'
import { nativeTheme } from 'electron'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import { THEME_MESSAGE } from '@shared/viewer'
import { injectTheme, currentThemeTokensCss } from '../services/theme'
import { CONVO_CSP } from './transform'

/** 文本渲染上限：超过则给占位，避免卡渲染。 */
const MAX_TEXT_BYTES = 3_000_000

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon'
}

/** 扩展名 → highlight.js 语言（缺省走 highlightAuto）。 */
const EXT_LANG: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'ini',
  '.ini': 'ini',
  '.sql': 'sql',
  '.diff': 'diff',
  '.patch': 'diff',
  '.dockerfile': 'dockerfile',
  '.vue': 'xml',
  '.svelte': 'xml',
  '.ipynb': 'json'
}

const TEXT_EXT = new Set<string>([
  ...Object.keys(EXT_LANG),
  '.md',
  '.markdown',
  '.txt',
  '.text',
  '.log',
  '.env',
  '.gitignore',
  '.csv',
  '.tsv'
])

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function highlightCode(code: string, ext: string): string {
  const lang = EXT_LANG[ext]
  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    }
    return hljs.highlightAuto(code).value
  } catch {
    return escapeHtml(code)
  }
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  highlight: (str, lang): string => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return (
          '<pre class="hljs"><code>' +
          hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
          '</code></pre>'
        )
      } catch {
        /* 落到默认 */
      }
    }
    return '<pre class="hljs"><code>' + escapeHtml(str) + '</code></pre>'
  }
})

/** 前 8KB 内出现 NUL 视为二进制。 */
function looksBinary(s: string): boolean {
  const n = Math.min(s.length, 8192)
  for (let i = 0; i < n; i++) if (s.charCodeAt(i) === 0) return true
  return false
}

/** 文档外壳：注入 data-theme + 主题令牌 + 排版/高亮样式 + 主题热切换脚本。 */
function shell(inner: string): string {
  const theme = injectTheme()
  const tokenCss = currentThemeTokensCss()
  return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8">
<style>${BASE_CSS}${tokenCss}</style></head>
<body><main class="fv">${inner}</main>
<script>${SHELL_BOOTSTRAP}</script></body></html>`
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'Content-Security-Policy': CONVO_CSP }
  })
}

function placeholder(title: string, detail: string): string {
  return `<div class="fv-empty"><div class="fv-empty-title">${escapeHtml(title)}</div><div class="fv-empty-detail">${escapeHtml(detail)}</div></div>`
}

/** 渲染指定绝对路径文件为 Response。 */
export async function renderFileResponse(absPath: string): Promise<Response> {
  let stat: import('node:fs').Stats
  try {
    stat = await fs.stat(absPath)
  } catch {
    return htmlResponse(shell(placeholder('文件不存在', basename(absPath))))
  }
  if (!stat.isFile()) return htmlResponse(shell(placeholder('不是文件', basename(absPath))))

  const ext = extname(absPath).toLowerCase()
  const name = basename(absPath)

  // 图片：直出字节
  if (IMAGE_TYPES[ext]) {
    try {
      const buf = await fs.readFile(absPath)
      return new Response(new Uint8Array(buf), { headers: { 'content-type': IMAGE_TYPES[ext] } })
    } catch {
      return htmlResponse(shell(placeholder('图片读取失败', name)))
    }
  }

  if (stat.size > MAX_TEXT_BYTES) {
    return htmlResponse(
      shell(placeholder('文件过大，暂不预览', `${name} · ${(stat.size / 1e6).toFixed(1)} MB`))
    )
  }

  // 原生 HTML：原样渲染
  if (ext === '.html' || ext === '.htm') {
    try {
      const raw = await fs.readFile(absPath, 'utf8')
      return new Response(raw, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'Content-Security-Policy': CONVO_CSP }
      })
    } catch {
      return htmlResponse(shell(placeholder('读取失败', name)))
    }
  }

  // 文本/代码/markdown
  let raw: string
  try {
    raw = await fs.readFile(absPath, 'utf8')
  } catch {
    return htmlResponse(shell(placeholder('读取失败', absPath)))
  }
  if (looksBinary(raw)) {
    return htmlResponse(shell(placeholder('二进制文件，无法预览', name)))
  }

  if (ext === '.md' || ext === '.markdown') {
    return htmlResponse(shell(`<article class="md">${md.render(raw)}</article>`))
  }
  // 已知代码类或通用文本 → 高亮/转义为 <pre>
  const inner =
    ext in EXT_LANG || TEXT_EXT.has(ext) || ext === ''
      ? `<pre class="hljs code"><code>${highlightCode(raw, ext)}</code></pre>`
      : `<pre class="hljs code"><code>${escapeHtml(raw)}</code></pre>`
  return htmlResponse(shell(inner))
}

/** 是否为可在应用内预览渲染的文件类型（供渲染层判断展示形态，可选用）。 */
export function isPreviewable(absPath: string): boolean {
  const ext = extname(absPath).toLowerCase()
  return Boolean(IMAGE_TYPES[ext]) || ext in EXT_LANG || TEXT_EXT.has(ext) || ext === '.html' || ext === '.htm'
}

const darkFallback = nativeTheme.shouldUseDarkColors

/** 文档基础样式：配色走令牌（含亮/暗回退）、排版、代码高亮。 */
const BASE_CSS = `
:root{
  --fv-bg: var(--bg, #f6f7f9);
  --fv-fg: var(--fg, #1f2328);
  --fv-accent: var(--accent, #6b5bd6);
  --fv-panel: var(--panel, #ffffff);
  --fv-line: var(--line, #e2e4e9);
  --fv-muted: var(--muted, #6b7280);
  --fv-code-bg: var(--codeBg, #f0f1f4);
  --fv-code-fg: var(--codeFg, #1f2328);
  --fv-quote: var(--quote, #7a828e);
}
html[data-theme="dark"]{
  --fv-bg: var(--bg, #0d1117);
  --fv-fg: var(--fg, #e6edf3);
  --fv-accent: var(--accent, #a99bff);
  --fv-panel: var(--panel, #161b22);
  --fv-line: var(--line, #2a2f37);
  --fv-muted: var(--muted, #8b949e);
  --fv-code-bg: var(--codeBg, #161b22);
  --fv-code-fg: var(--codeFg, #e6edf3);
  --fv-quote: var(--quote, #8b949e);
}
${
  darkFallback
    ? `html[data-theme="auto"]{--fv-bg:var(--bg,#0d1117);--fv-fg:var(--fg,#e6edf3);--fv-accent:var(--accent,#a99bff);--fv-panel:var(--panel,#161b22);--fv-line:var(--line,#2a2f37);--fv-muted:var(--muted,#8b949e);--fv-code-bg:var(--codeBg,#161b22);--fv-code-fg:var(--codeFg,#e6edf3);--fv-quote:var(--quote,#8b949e);}`
    : ''
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--fv-bg);color:var(--fv-fg)}
body{font:14px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.fv{max-width:900px;margin:0 auto;padding:28px 32px 60px}
.fv-empty{padding:64px 24px;text-align:center;color:var(--fv-muted)}
.fv-empty-title{font-size:15px;font-weight:600;color:var(--fv-fg);margin-bottom:6px}
.fv-empty-detail{font-size:12px;word-break:break-all}
.md h1,.md h2,.md h3,.md h4{line-height:1.3;margin:1.4em 0 .6em;font-weight:600}
.md h1{font-size:1.9em;border-bottom:1px solid var(--fv-line);padding-bottom:.3em}
.md h2{font-size:1.5em;border-bottom:1px solid var(--fv-line);padding-bottom:.25em}
.md h3{font-size:1.25em}.md h4{font-size:1.05em}
.md p{margin:.7em 0}
.md a{color:var(--fv-accent);text-decoration:none}
.md a:hover{text-decoration:underline}
.md ul,.md ol{padding-left:1.6em;margin:.6em 0}
.md li{margin:.25em 0}
.md blockquote{margin:.8em 0;padding:.2em 1em;border-left:3px solid var(--fv-line);color:var(--fv-quote)}
.md img{max-width:100%}
.md table{border-collapse:collapse;margin:.8em 0;display:block;overflow:auto}
.md th,.md td{border:1px solid var(--fv-line);padding:6px 12px}
.md th{background:var(--fv-code-bg)}
.md hr{border:none;border-top:1px solid var(--fv-line);margin:1.6em 0}
.md code:not(.hljs code),.md :not(pre)>code{background:var(--fv-code-bg);padding:.15em .4em;border-radius:4px;font-size:.9em;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
pre.hljs,.md pre{background:var(--fv-code-bg);color:var(--fv-code-fg);padding:14px 16px;border-radius:8px;overflow:auto;border:1px solid var(--fv-line)}
pre.hljs code,.md pre code{font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:none;padding:0}
pre.code{margin:0}
/* highlight.js 极简双主题（够用色板，随 data-theme 切换） */
.hljs-comment,.hljs-quote{color:#8a929c;font-style:italic}
.hljs-keyword,.hljs-selector-tag,.hljs-built_in,.hljs-name,.hljs-tag{color:#c0392b}
.hljs-string,.hljs-title,.hljs-section,.hljs-attribute,.hljs-literal,.hljs-template-tag,.hljs-template-variable,.hljs-type,.hljs-addition{color:#2e844a}
.hljs-number,.hljs-symbol,.hljs-bullet,.hljs-link,.hljs-meta,.hljs-selector-id,.hljs-selector-class{color:#8250df}
.hljs-title.function_,.hljs-function .hljs-title,.hljs-attr,.hljs-variable,.hljs-property{color:#0b66c3}
.hljs-deletion{color:#c0392b}
.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:700}
html[data-theme="dark"] .hljs-keyword,html[data-theme="dark"] .hljs-selector-tag,html[data-theme="dark"] .hljs-built_in,html[data-theme="dark"] .hljs-name,html[data-theme="dark"] .hljs-tag{color:#ff7b72}
html[data-theme="dark"] .hljs-string,html[data-theme="dark"] .hljs-title,html[data-theme="dark"] .hljs-section,html[data-theme="dark"] .hljs-attribute,html[data-theme="dark"] .hljs-literal,html[data-theme="dark"] .hljs-type,html[data-theme="dark"] .hljs-addition{color:#7ee787}
html[data-theme="dark"] .hljs-number,html[data-theme="dark"] .hljs-symbol,html[data-theme="dark"] .hljs-bullet,html[data-theme="dark"] .hljs-link,html[data-theme="dark"] .hljs-meta,html[data-theme="dark"] .hljs-selector-id,html[data-theme="dark"] .hljs-selector-class{color:#d2a8ff}
html[data-theme="dark"] .hljs-title.function_,html[data-theme="dark"] .hljs-function .hljs-title,html[data-theme="dark"] .hljs-attr,html[data-theme="dark"] .hljs-variable,html[data-theme="dark"] .hljs-property{color:#79c0ff}
html[data-theme="dark"] .hljs-comment,html[data-theme="dark"] .hljs-quote{color:#8b949e}
`

/** 文件视图内的主题热切换：接收 THEME_MESSAGE，设 data-theme 并覆盖令牌变量。 */
const SHELL_BOOTSTRAP = `;(function(){
  var applied=[];
  function apply(t,tokens){
    var el=document.documentElement;
    if(t){el.setAttribute('data-theme',t);}
    if(tokens!==undefined){
      var next=tokens||{};
      for(var i=0;i<applied.length;i++){if(!(applied[i] in next))el.style.removeProperty(applied[i]);}
      applied=[];
      for(var k in next){el.style.setProperty(k,next[k]);applied.push(k);}
    }
  }
  window.addEventListener('message',function(e){
    var d=e&&e.data;
    if(d&&d.type===${JSON.stringify(THEME_MESSAGE)})apply(d.theme,d.tokens);
  });
})();`
