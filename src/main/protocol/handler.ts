import { promises as fs } from 'node:fs'
import { join, relative, isAbsolute, extname } from 'node:path'
import { FILE_VIEW_HOST } from '@shared/viewer'
import { library } from '../services/library'
import { injectTheme, buildInjectedCss } from '../services/theme'
import { transformConversationHtml, CONVO_CSP } from './transform'
import { renderFileResponse, isPreviewable } from './file-view'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
}

/** 处理 convo://<host>/<file> 请求：html 注入主题/embed/中和死链，其它文件按需返回。 */
export async function handleConvo(request: Request): Promise<Response> {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return new Response('bad url', { status: 400 })
  }

  // 任意文件视图：convo://open-file/<encodeURIComponent(绝对路径)> → file-view 渲染
  if (url.hostname === FILE_VIEW_HOST) {
    let p: string
    try {
      p = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    } catch {
      return new Response('bad path', { status: 400 })
    }
    if (!p || !isAbsolute(p)) return new Response('bad path', { status: 400 })
    // 纵深防御：仅放行可预览类型（代码/文本/Markdown/图片/HTML），挡住无扩展名的密钥/凭证类文件
    if (!isPreviewable(p)) return new Response('文件类型不支持预览', { status: 403 })
    return renderFileResponse(p)
  }

  await library.ensureLoaded()
  const dir = library.resolveHost(url.hostname)
  if (!dir) return new Response('未找到对话', { status: 404 })

  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || '对话.html'
  const target = join(dir, rel)
  const within = relative(dir, target)
  if (within.startsWith('..') || isAbsolute(within)) {
    return new Response('forbidden', { status: 403 })
  }

  // 符号链接防护：词法校验通过后，解析真实路径再校验一次，防止目录内软链读到库外文件
  let realDir: string
  let realTarget: string
  try {
    realDir = await fs.realpath(dir)
    realTarget = await fs.realpath(target)
  } catch {
    return new Response('读取失败', { status: 404 })
  }
  const withinReal = relative(realDir, realTarget)
  if (withinReal.startsWith('..') || isAbsolute(withinReal)) {
    return new Response('forbidden', { status: 403 })
  }

  const ext = extname(realTarget).toLowerCase()
  try {
    if (ext === '.html') {
      const raw = await fs.readFile(realTarget, 'utf8')
      const html = transformConversationHtml(raw, injectTheme(), buildInjectedCss())
      return new Response(html, {
        headers: { 'content-type': CONTENT_TYPES['.html'], 'Content-Security-Policy': CONVO_CSP }
      })
    }
    const buf = await fs.readFile(realTarget)
    return new Response(new Uint8Array(buf), {
      headers: { 'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream' }
    })
  } catch {
    return new Response('读取失败', { status: 404 })
  }
}
