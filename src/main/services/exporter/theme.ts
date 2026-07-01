/**
 * 共享设计令牌与主题脚手架（自 chat_export/theme.py 原样搬运，字节复用）。
 *
 * render-html 的 template.html 通过 __TOKENS__ / __GLASS__ 占位引用本模块；
 * 改色 / 改玻璃只此一处，避免查看器、外壳、Web UI 三处漂移。
 */

// 设计令牌（亮 / 暗 / 跟随系统）。改色只此一处。
export const TOKENS_CSS = `  :root, html[data-theme="light"]{
    --bg:#f4f5f7; --panel:#ffffff; --card:#ffffff; --line:#e6e9ee; --fg:#1f2328; --muted:#6b7280;
    --accent:#2563eb; --code-bg:#f6f8fa; --code-fg:#1f2328; --code-line:#d6dae0; --hover:#eef1f5;
    --th:#eaeef3; --quote:#b9c0cc;
    --user:#2563eb; --tool:#0891b2; --answer:#16a34a; --err:#dc2626; --shadow:0 1px 3px rgba(0,0,0,.06);
    /* 同心圆角 + 玻璃模糊（主题无关，定义一次全局生效） */
    --radius-lg:18px; --radius-md:12px; --radius-sm:9px; --radius-pill:999px;
    --glass-blur:20px; --glass-saturate:180%;
    /* 液态玻璃面板（亮） */
    --glass-bg:rgba(255,255,255,.60); --glass-bg-strong:rgba(255,255,255,.78);
    --glass-border:rgba(255,255,255,.55); --glass-shadow:0 10px 34px rgba(17,24,39,.12);
    --glass-highlight:inset 0 1px 0 rgba(255,255,255,.75); --glass-edge-hover:inset 0 1px 0 rgba(255,255,255,.95);
    /* Aurora 极光环境层（玻璃的折射来源；正文阅读区不受影响） */
    --app-bg:
      radial-gradient(1100px 760px at 8% -10%, color-mix(in srgb,#2563eb 16%,transparent), transparent 58%),
      radial-gradient(900px 680px at 102% 4%, color-mix(in srgb,#7c3aed 14%,transparent), transparent 55%),
      radial-gradient(820px 620px at 50% 118%, color-mix(in srgb,#06b6d4 12%,transparent), transparent 60%),
      linear-gradient(180deg,#f5f7fb,#eef1f6);
  }
  html[data-theme="dark"]{
    --bg:#0d1117; --panel:#161b22; --card:#161b22; --line:#2a313c; --fg:#e6edf3; --muted:#9198a1;
    --accent:#58a6ff; --code-bg:#0b1222; --code-fg:#d6deeb; --code-line:#2a313c; --hover:#21262d;
    --th:#21262d; --quote:#3b434e;
    --user:#58a6ff; --tool:#39c5cf; --answer:#3fb950; --err:#f85149; --shadow:0 1px 3px rgba(0,0,0,.4);
    --glass-bg:rgba(22,27,34,.55); --glass-bg-strong:rgba(22,27,34,.74);
    --glass-border:rgba(255,255,255,.10); --glass-shadow:0 12px 40px rgba(0,0,0,.50);
    --glass-highlight:inset 0 1px 0 rgba(255,255,255,.10); --glass-edge-hover:inset 0 1px 0 rgba(255,255,255,.18);
    --app-bg:
      radial-gradient(1100px 760px at 8% -10%, color-mix(in srgb,#58a6ff 22%,transparent), transparent 58%),
      radial-gradient(900px 680px at 102% 4%, color-mix(in srgb,#a371f7 18%,transparent), transparent 55%),
      radial-gradient(820px 620px at 50% 118%, color-mix(in srgb,#39c5cf 16%,transparent), transparent 60%),
      linear-gradient(180deg,#0b0f15,#0d1117);
  }
  @media (prefers-color-scheme: dark){
    html[data-theme="auto"]{
      --bg:#0d1117; --panel:#161b22; --card:#161b22; --line:#2a313c; --fg:#e6edf3; --muted:#9198a1;
      --accent:#58a6ff; --code-bg:#0b1222; --code-fg:#d6deeb; --code-line:#2a313c; --hover:#21262d;
      --th:#21262d; --quote:#3b434e;
      --user:#58a6ff; --tool:#39c5cf; --answer:#3fb950; --err:#f85149; --shadow:0 1px 3px rgba(0,0,0,.4);
      --glass-bg:rgba(22,27,34,.55); --glass-bg-strong:rgba(22,27,34,.74);
      --glass-border:rgba(255,255,255,.10); --glass-shadow:0 12px 40px rgba(0,0,0,.50);
      --glass-highlight:inset 0 1px 0 rgba(255,255,255,.10); --glass-edge-hover:inset 0 1px 0 rgba(255,255,255,.18);
      --app-bg:
        radial-gradient(1100px 760px at 8% -10%, color-mix(in srgb,#58a6ff 22%,transparent), transparent 58%),
        radial-gradient(900px 680px at 102% 4%, color-mix(in srgb,#a371f7 18%,transparent), transparent 55%),
        radial-gradient(820px 620px at 50% 118%, color-mix(in srgb,#39c5cf 16%,transparent), transparent 60%),
        linear-gradient(180deg,#0b0f15,#0d1117);
    }
  }`

// 基础排版（body / 字体 / macOS 风滚动条），仪表盘与 Web UI 复用
export const BASE_CSS = `  *{box-sizing:border-box}
  html,body{margin:0}
  body{background:var(--bg);color:var(--fg);line-height:1.6;-webkit-font-smoothing:antialiased;
       font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",Segoe UI,Roboto,sans-serif;font-size:14px}
  a{color:var(--accent)}
  ::-webkit-scrollbar{width:11px;height:11px}
  ::-webkit-scrollbar-thumb{background:rgba(142,142,150,.45);border-radius:8px;border:3px solid transparent;background-clip:content-box}
  ::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}`

// 液态玻璃工具类 + 无障碍降级（render-html / dashboard / Web UI 共用，单一来源）。
export const GLASS_CSS = `  .glass{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-lg);box-shadow:var(--shadow)}
  @supports ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
    .glass{background:var(--glass-bg);
           -webkit-backdrop-filter:blur(var(--glass-blur)) saturate(var(--glass-saturate));
           backdrop-filter:blur(var(--glass-blur)) saturate(var(--glass-saturate));
           border:1px solid var(--glass-border);
           box-shadow:var(--glass-shadow),var(--glass-highlight)}
    .glass-strong{background:var(--glass-bg-strong)}
  }
  .glass-int{transition:box-shadow .18s ease,transform .18s ease}
  .glass-int:hover{box-shadow:var(--glass-shadow),var(--glass-edge-hover)}
  .glass-int:active{transform:translateY(.5px)}
  .glass-int:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  /* 无障碍降级：降低透明 / 高对比 → 实色面板；减少动效 → 关动画 */
  @media (prefers-reduced-transparency:reduce){
    .glass,.glass-strong{background:var(--panel)!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;box-shadow:var(--shadow)!important}
    body::before{background:var(--bg)!important}
  }
  @media (prefers-contrast:more){
    .glass,.glass-strong{background:var(--panel)!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;border-color:var(--fg)!important}
    body::before{background:var(--bg)!important}
  }
  @media (prefers-reduced-motion:reduce){
    .glass-int,.toc-drawer,.toc-fab,.toc-scrim{transition:none!important;animation:none!important}
  }
  /* 手动降级钩子（应对旧内核不识别 prefers-reduced-transparency） */
  html.no-glass .glass,html.no-glass .glass-strong{background:var(--panel)!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;box-shadow:var(--shadow)!important}
  html.no-glass body::before{background:var(--bg)!important}`

// 主题初始化 JS：读 localStorage['cc-theme'] 应用 data-theme，与查看器/桌面 App 联动
export const THEME_INIT_JS = `(function(){try{var t=localStorage.getItem('cc-theme')||'auto';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`
