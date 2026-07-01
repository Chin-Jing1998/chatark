import { describe, it, expect } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { transformConversationHtml } from './transform'
import { DEFAULT_LIBRARY_REL } from '@shared/constants'
import { THEME_MESSAGE, OPEN_FILE_MESSAGE } from '@shared/viewer'

describe('transformConversationHtml（合成输入，确定性）', () => {
  const sample = '<!doctype html><html lang="zh-CN" data-theme="auto"><head></head><body><a href="file:///x/y z.py">打开</a><img src="file:///a.png"></body></html>'

  it('注入 data-theme 与 embed 类', () => {
    const out = transformConversationHtml(sample, 'dark')
    expect(out).toMatch(/<html\b[^>]*\bdata-theme="dark"/i)
    expect(out).toMatch(/<html\b[^>]*\bclass="[^"]*embed/i)
  })

  it('href file:// 改为携带绝对路径的应用内打开锚点；资源 src file:// 中和', () => {
    const out = transformConversationHtml(sample, 'auto')
    expect(out.includes('href="file:')).toBe(false)
    expect(out.includes('src="file:')).toBe(false)
    // href 保留可点击 + 解码后的绝对路径（供引导脚本上抛）
    expect(out).toContain('data-open-file="/x/y z.py"')
    // 资源 src 仍中和为死链占位
    expect(out).toContain('data-deadlink="1"')
  })

  it('引导脚本经 postMessage 上抛“打开文件”请求', () => {
    const out = transformConversationHtml(sample, 'auto')
    expect(out).toContain(OPEN_FILE_MESSAGE)
    expect(out).toContain('postMessage')
    expect(out).toContain('data-open-file')
  })

  it('注入主题消息引导脚本并拦截 file: 链接', () => {
    const out = transformConversationHtml(sample, 'auto')
    expect(out).toContain(THEME_MESSAGE)
    expect(out).toMatch(/\^file:/) // 运行时拦截 file: 链接的正则
    expect(out).toMatch(/<\/body>/i)
  })

  it('injectedCss 注入到 head 末尾（对齐/背景/令牌）', () => {
    const css = 'html.embed aside.left{top:12px}html,body{background:var(--bg,#0d1117)}'
    const out = transformConversationHtml(sample, 'dark', css)
    expect(out).toContain('<style id="chatark-inject">')
    expect(out).toContain('aside.left{top:12px}')
    // 注入点在 </head> 之前
    expect(out.indexOf('chatark-inject')).toBeLessThan(out.indexOf('</head>'))
  })

  it('injectedCss 为空则不注入 style', () => {
    const out = transformConversationHtml(sample, 'dark')
    expect(out.includes('chatark-inject')).toBe(false)
  })

  it('注入实时模式复位脚本，且位于 <head> 内（早于 body 模板脚本）', () => {
    const out = transformConversationHtml(sample, 'auto')
    expect(out).toContain('chatark-live-off')
    expect(out).toContain("localStorage.setItem('cc-live','0')")
    // 复位脚本须在 </head> 之前 → 先于 <body> 末尾的模板脚本执行
    expect(out.indexOf('chatark-live-off')).toBeLessThan(out.indexOf('</head>'))
  })

  it('引导脚本支持整套配色令牌热切换', () => {
    const out = transformConversationHtml(sample, 'auto')
    expect(out).toContain('setProperty') // 令牌逐个覆盖 :root 变量
    expect(out).toContain('d.tokens')
  })

  it('引导脚本拦截内部跳转（目录/文件清单）改为钳制式即时滚动', () => {
    const out = transformConversationHtml(sample, 'auto')
    expect(out).toContain('a[data-target]')
    expect(out).toContain('window.scrollTo')
    expect(out).toContain('Math.min(top, max)')
  })
})

// 真实对话 HTML：file:// 多为运行时动态生成，故仅校验主题/embed/脚本注入（静态可见部分）
const htmlPath = join(
  homedir(),
  ...DEFAULT_LIBRARY_REL,
  '文档处理',
  '20260628_160948_对话数据导出设置_73b0f3b8',
  '对话.html'
)
const maybe = existsSync(htmlPath) ? describe : describe.skip

maybe('transformConversationHtml（真实对话 HTML）', () => {
  const raw = readFileSync(htmlPath, 'utf8')
  it('原 HTML 含 data-theme="auto" 与 embed 支持', () => {
    expect(raw).toMatch(/<html\b[^>]*data-theme="auto"/i)
  })
  it('注入后主题对齐且引导脚本就位', () => {
    const out = transformConversationHtml(raw, 'light')
    expect(out).toMatch(/<html\b[^>]*\bdata-theme="light"/i)
    expect(out).toMatch(/<html\b[^>]*\bclass="[^"]*embed/i)
    expect(out).toContain(THEME_MESSAGE)
  })
})
