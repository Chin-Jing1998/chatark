import { THEME_MESSAGE, OPEN_FILE_MESSAGE } from '@shared/viewer'

/** 自包含对话 HTML 的 CSP：仅允许内联（自带脚本/样式），禁外联与网络导航。 */
export const CONVO_CSP =
  "default-src 'none'; img-src 'self' data:; media-src 'self' data:; " +
  "style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src 'self' data:; " +
  "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'"

/**
 * 注入对话 iframe 的引导脚本：接收主题消息热切换（含整套配色令牌）+ 拦截死链点击。
 * - apply(theme, tokens)：设 data-theme；tokens 存在时按 setProperty 覆盖 :root 变量，
 *   并移除上轮设过、本轮已无的键（切回默认预设即清空覆盖）。
 * - 对话的 file:// 链接多为内联 JS 运行时动态生成，故捕获阶段拦截所有 file: 链接点击。
 */
const BOOTSTRAP = `;(function(){
  var applied = [];
  function apply(t, tokens){
    var el = document.documentElement;
    if(t){ el.setAttribute('data-theme', t); }
    if(tokens !== undefined){
      var next = tokens || {};
      for(var i=0;i<applied.length;i++){ if(!(applied[i] in next)) el.style.removeProperty(applied[i]); }
      applied = [];
      for(var k in next){ el.style.setProperty(k, next[k]); applied.push(k); }
    }
  }
  window.addEventListener('message', function(e){
    var d = e && e.data;
    if (d && d.type === ${JSON.stringify(THEME_MESSAGE)}) apply(d.theme, d.tokens);
  });
  document.addEventListener('click', function(e){
    var t = e.target;
    if (!t || !t.closest) return;
    // 内部跳转（目录·提问 / 文件清单等 a[data-target]）：钳制到最大可滚位置的即时滚动，
    // 杜绝模板 jumpTo 平滑滚动在接近底部时的过冲露白与“挪一点又回落”，并与目录落点统一。
    var jump = t.closest('a[data-target]');
    if (jump && !t.closest('.exp')){
      var id = jump.getAttribute('data-target');
      var target = id && document.getElementById(id);
      if (target){
        e.preventDefault(); e.stopPropagation();
        var max = document.documentElement.scrollHeight - window.innerHeight;
        var top = target.getBoundingClientRect().top + window.scrollY - 60;
        window.scrollTo({ top: Math.max(0, Math.min(top, max)), behavior: 'auto' });
        return;
      }
    }
    // 文件链接点击：请求父窗口在应用内新标签打开该文件（沙箱 iframe 无 fs，故经 postMessage 上抛）
    // 兼顾两类来源：静态改写的 [data-open-file]，与对话内联 JS 运行时动态生成的 file 协议链接。
    var openEl = t.closest('[data-open-file]');
    var a = t.closest('a[href]');
    var fileHref = a && /^file:/i.test(a.getAttribute('href') || '') ? a.getAttribute('href') : '';
    if (openEl || fileHref){
      e.preventDefault(); e.stopPropagation();
      var p = '';
      if (openEl){ p = openEl.getAttribute('data-open-file') || ''; }
      else { var raw = fileHref.replace(/^file:\\/\\//i, ''); try { p = decodeURIComponent(raw); } catch(_){ p = raw; } }
      if (p){ try { window.parent.postMessage({ type: ${JSON.stringify(OPEN_FILE_MESSAGE)}, path: p }, '*'); } catch(_){} }
      return;
    }
    var dead = t.closest('[data-deadlink]');
    if (dead){ e.preventDefault(); e.stopPropagation(); }
  }, true);
})();`

/** 改写 <html> 开标签：设置 data-theme，并加 embed 类（复用对话内建嵌入模式）。 */
function rewriteHtmlTag(html: string, theme: string): string {
  return html.replace(/<html\b[^>]*>/i, (tag) => {
    let next = tag
    next = /\bdata-theme\s*=\s*"[^"]*"/i.test(next)
      ? next.replace(/\bdata-theme\s*=\s*"[^"]*"/i, `data-theme="${theme}"`)
      : next.replace(/<html\b/i, `<html data-theme="${theme}"`)
    next = /\bclass\s*=\s*"[^"]*"/i.test(next)
      ? next.replace(/\bclass\s*=\s*"([^"]*)"/i, (_m, c) => `class="${c} embed"`)
      : next.replace(/<html\b/i, `<html class="embed"`)
    return next
  })
}

/** file:// URL → 本地绝对路径（逐段已 encodeURIComponent，故整体 decodeURIComponent 还原）。 */
function fileUrlToPath(fileUrl: string): string {
  let p = fileUrl.replace(/^file:\/\//i, '')
  try {
    p = decodeURIComponent(p)
  } catch {
    /* 保留原串（极少数非法编码） */
  }
  return p
}

/** HTML 属性值转义（防路径含 &"<> 破坏属性）。 */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * 处理 file:// 链接：
 * - <a href="file:..."> → `href="#" data-open-file="<绝对路径>"`（保留可点击链接文本与路径，交引导脚本上抛父窗口在应用内打开）；
 * - 资源 src="file:..." → 去除并中和（避免 iframe 内发起 file 加载）。
 */
function activateFileLinks(html: string): string {
  return html.replace(/\b(href|src)\s*=\s*"(file:[^"]*)"/gi, (_m, attr: string, url: string) => {
    if (attr.toLowerCase() === 'href') {
      return `href="#" data-open-file="${escapeAttr(fileUrlToPath(url))}"`
    }
    return 'data-deadlink="1"'
  })
}

/**
 * 首屏注入 <style>（置于 head 末，胜过模板 :root/[data-theme="x"]）：
 * 目录三栏对齐修正 + 背景兜底 + 预设整套配色令牌。injectedCss 为空则跳过。
 */
function injectHeadStyle(html: string, injectedCss: string): string {
  if (!injectedCss) return html
  const style = `<style id="chatark-inject">${injectedCss}</style>`
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${style}</head>`)
  return html.replace(/<html\b[^>]*>/i, (m) => `${m}${style}`)
}

/**
 * 复位对话内“实时模式”开关：ChatArk 展示静态导出快照，模板的实时轮询（每 10s 拉 data.js、
 * 倒序置顶、自动滚动、失败 location.reload）在此纯属干扰且会导致“查看一会儿后整页自动位移”。
 * 该脚本置于 <head>，先于 <body> 末尾的模板脚本执行 → 令模板读取到 cc-live='0'，初始化即关闭实时。
 */
const LIVE_OFF_SCRIPT = `<script id="chatark-live-off">;(function(){try{localStorage.setItem('cc-live','0')}catch(e){}})();</script>`

function injectHeadScript(html: string, script: string): string {
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (m) => `${m}${script}`)
  return html.replace(/<html\b[^>]*>/i, (m) => `${m}${script}`)
}

function injectBootstrap(html: string): string {
  const script = `<script>${BOOTSTRAP}</script>`
  return html.includes('</body>') ? html.replace('</body>', `${script}</body>`) : html + script
}

/**
 * 对自包含对话 HTML 做首屏零闪烁注入：主题 + embed + 注入样式（对齐/背景/预设令牌）+ 死链中和 + 引导脚本。
 * @param injectedCss 主进程编译的注入 CSS（对齐修正 + 背景兜底 + 当前预设令牌），可空。
 */
export function transformConversationHtml(html: string, theme: string, injectedCss = ''): string {
  let out = rewriteHtmlTag(html, theme)
  out = injectHeadScript(out, LIVE_OFF_SCRIPT)
  out = injectHeadStyle(out, injectedCss)
  out = activateFileLinks(out)
  out = injectBootstrap(out)
  return out
}
