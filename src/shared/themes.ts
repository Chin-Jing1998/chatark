/**
 * 风格主题预设（外壳 + 对话正文一体融合，参考 Obsidian 社区主题）。
 * - `brand`：喂给渲染层 globals.css 的 `--brand`/`--ring`（HSL 三元组，无 hsl() 包裹）。
 * - `flow`：外壳七彩流光四色。
 * - `light`/`dark`：对话正文整套配色（键名对齐 exporter/theme.ts 的 CSS 变量）。
 *
 * 主进程与渲染层共用：渲染层据此设外壳变量 + 广播给 iframe；主进程据此在 convo:// 注入首屏令牌。
 */

export interface Palette {
  bg: string
  panel: string
  card: string
  line: string
  fg: string
  muted: string
  accent: string
  user: string
  tool: string
  answer: string
  err: string
  codeBg: string
  codeFg: string
  codeLine: string
  hover: string
  th: string
  quote: string
}

export interface ThemePreset {
  id: string
  name: string
  /** 外壳强调色（HSL 三元组，如 '254 82% 60%'） */
  brand: { light: string; dark: string }
  /** 七彩流光四色（任意 CSS 颜色） */
  flow: [string, string, string, string]
  light: Palette
  dark: Palette
}

/**
 * 界面骨架与阅读器视觉方案（现状基线 + A / B / C 共四套完整保留，支持实时切换）：
 * - classic：现状基线 · Obsidian 经典（双顶栏 + 48px 窄图标栏 + 单行树叶 + 3px 左色条阅读卡片）
 * - m3e：方案 A · M3E 色调容器工作台（内嵌圆角舞台合流头 + 胶囊活动栏 + 无左粗线色调容器阅读页）
 * - archive：方案 B · 高密度档案检索台（与侧栏分界对齐的 40px 顶部状态栏 + 侧栏内嵌五视图分段栏 + 等宽编年索引）
 * - glass：方案 C · 精致层叠液态玻璃（悬浮磨砂胶囊岛 + 1px 内高光分层玻璃侧栏 + 6 套预设实时色点 + 内高光阅读卡片）
 */
export type UiScheme = 'classic' | 'm3e' | 'archive' | 'glass'

export interface UiSchemeSpec {
  id: UiScheme
  code: '基线' | 'A' | 'B' | 'C'
  name: string
  shortName: string
  desc: string
  /** 切换该方案时默认匹配的主题色板 id */
  defaultPresetId: string
}

export const UI_SCHEMES: UiSchemeSpec[] = [
  {
    id: 'classic',
    code: '基线',
    name: '现状基线 · Obsidian 经典',
    shortName: '基线 · 经典',
    desc: '保留原版双顶栏、48px 窄活动栏、紧凑单行树叶与 3px 左色条对话卡片',
    defaultPresetId: 'default'
  },
  {
    id: 'm3e',
    code: 'A',
    name: '方案 A · M3E 色调容器',
    shortName: 'A · M3E 容器',
    desc: '内嵌圆角舞台合流顶栏、左侧胶囊活动栏与无左粗线色调容器阅读页',
    defaultPresetId: 'm3e-tonal'
  },
  {
    id: 'archive',
    code: 'B',
    name: '方案 B · 档案检索台',
    shortName: 'B · 档案检索',
    desc: '侧栏分界对齐的 40px 顶部状态栏、内嵌五视图分段栏与等宽数字索引',
    defaultPresetId: 'archive-paper'
  },
  {
    id: 'glass',
    code: 'C',
    name: '方案 C · 液态玻璃',
    shortName: 'C · 液态玻璃',
    desc: '悬浮磨砂胶囊岛、1px 顶部内高光玻璃侧栏与预设快速色点切换',
    defaultPresetId: 'liquid-glass'
  }
]

export const DEFAULT_UI_SCHEME: UiScheme = 'm3e'

export function normalizeUiScheme(v: string | null | undefined): UiScheme {
  return v === 'classic' || v === 'm3e' || v === 'archive' || v === 'glass'
    ? v
    : DEFAULT_UI_SCHEME
}

/* ---------- 颜色工具 ---------- */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const v = parseInt(n, 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${a})`
}

/** hex → globals.css 的 HSL 三元组字符串（"H S% L%"，无 hsl() 包裹）。 */
function hexToHsl(hex: string): string {
  const [r0, g0, b0] = hexToRgb(hex)
  const r = r0 / 255
  const g = g0 / 255
  const b = b0 / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

/** 由三主色 + 底色合成 Aurora 环境渐变（沿用 exporter/theme.ts 的四层结构） */
function aurora(p: Palette, dark: boolean): string {
  const a = dark ? [22, 18, 16] : [16, 14, 12]
  const bottom = `color-mix(in srgb, ${p.bg} 88%, ${dark ? '#000' : '#ffffff'})`
  return [
    `radial-gradient(1100px 760px at 8% -10%, color-mix(in srgb,${p.accent} ${a[0]}%,transparent), transparent 58%)`,
    `radial-gradient(900px 680px at 102% 4%, color-mix(in srgb,${p.user} ${a[1]}%,transparent), transparent 55%)`,
    `radial-gradient(820px 620px at 50% 118%, color-mix(in srgb,${p.tool} ${a[2]}%,transparent), transparent 60%)`,
    `linear-gradient(180deg,${p.bg},${bottom})`
  ].join(',')
}

/** 调色板 → 对话页 CSS 变量覆盖对象（含派生的玻璃底与 Aurora） */
export function paletteToTokens(
  p: Palette,
  dark: boolean,
  scheme: UiScheme = DEFAULT_UI_SCHEME
): Record<string, string> {
  const schemeTokens: Record<string, string> =
    scheme === 'classic'
      ? {
          '--msg-radius': '12px',
          '--msg-left-w': '3px',
          '--msg-pad': '12px 15px',
          '--msg-shadow': 'var(--shadow)',
          '--user-card': p.card,
          '--tool-card': p.card,
          '--aside-radius': '12px',
          '--code-radius': '8px'
        }
      : scheme === 'm3e'
        ? {
          '--msg-radius': '18px',
          '--msg-left-w': '0px',
          '--msg-pad': '14px 18px',
          '--msg-shadow': dark ? '0 4px 16px rgba(0,0,0,.32)' : '0 2px 10px rgba(24,20,52,.05)',
          '--user-card': `color-mix(in srgb, ${p.user} ${dark ? '16%' : '9%'}, ${p.card})`,
          '--tool-card': `color-mix(in srgb, ${p.tool} ${dark ? '12%' : '6%'}, ${p.card})`,
          '--aside-radius': '18px',
          '--code-radius': '12px'
        }
      : scheme === 'archive'
        ? {
            '--msg-radius': '10px',
            '--msg-left-w': '3px',
            '--msg-pad': '11px 15px',
            '--msg-shadow': 'none',
            '--user-card': p.card,
            '--tool-card': `color-mix(in srgb, ${p.hover} 68%, ${p.card})`,
            '--aside-radius': '10px',
            '--code-radius': '8px'
          }
        : {
            '--msg-radius': '16px',
            '--msg-left-w': '3px',
            '--msg-pad': '14px 16px',
            '--msg-shadow': dark
              ? 'inset 0 1px 0 rgba(255,255,255,.12), 0 8px 24px rgba(0,0,0,.35)'
              : 'inset 0 1px 0 rgba(255,255,255,.82), 0 8px 24px rgba(15,23,42,.06)',
            '--user-card': rgba(p.card, dark ? 0.84 : 0.9),
            '--tool-card': rgba(p.card, dark ? 0.78 : 0.85),
            '--aside-radius': '16px',
            '--code-radius': '10px'
          }
  return {
    '--bg': p.bg,
    '--panel': p.panel,
    '--card': p.card,
    '--line': p.line,
    '--fg': p.fg,
    '--muted': p.muted,
    '--accent': p.accent,
    '--user': p.user,
    '--tool': p.tool,
    '--answer': p.answer,
    '--err': p.err,
    '--code-bg': p.codeBg,
    '--code-fg': p.codeFg,
    '--code-line': p.codeLine,
    '--hover': p.hover,
    '--th': p.th,
    '--quote': p.quote,
    '--glass-bg': rgba(p.panel, dark ? 0.55 : 0.62),
    '--glass-bg-strong': rgba(p.panel, dark ? 0.74 : 0.8),
    '--app-bg': aurora(p, dark),
    ...schemeTokens
  }
}

/** 取预设在指定明暗下的对话令牌（每个预设都有亮/暗两版，一律显式应用）。 */
export function presetConversationTokens(
  preset: ThemePreset,
  dark: boolean,
  scheme: UiScheme = DEFAULT_UI_SCHEME
): Record<string, string> {
  return paletteToTokens(dark ? preset.dark : preset.light, dark, scheme)
}

/** 调色板 → 外壳 CSS 令牌覆盖（HSL 三元组，喂给渲染层 documentElement，使整壳随主题变色）。 */
export function paletteToChromeVars(p: Palette): Record<string, string> {
  const bg = hexToHsl(p.bg)
  const fg = hexToHsl(p.fg)
  const panel = hexToHsl(p.panel)
  const hover = hexToHsl(p.hover)
  const muted = hexToHsl(p.muted)
  const line = hexToHsl(p.line)
  const err = hexToHsl(p.err)
  return {
    '--background': bg,
    '--foreground': fg,
    '--card': panel,
    '--card-foreground': fg,
    '--popover': panel,
    '--popover-foreground': fg,
    '--primary': fg,
    '--primary-foreground': bg,
    '--secondary': hover,
    '--secondary-foreground': fg,
    '--muted': hover,
    '--muted-foreground': muted,
    '--accent': hover,
    '--accent-foreground': fg,
    '--destructive': err,
    '--destructive-foreground': '0 0% 98%',
    '--border': line,
    '--input': line,
    '--sidebar': panel,
    '--sidebar-foreground': fg,
    '--rail': bg
  }
}

/* ---------- 预设清单 ---------- */

export const PRESETS: ThemePreset[] = [
  {
    id: 'default',
    name: '基线 · 极光蓝紫',
    brand: { light: '254 82% 60%', dark: '254 84% 74%' },
    flow: ['#7c6ff2', '#2563eb', '#06b6d4', '#ec4899'],
    light: {
      bg: '#f4f5f7', panel: '#ffffff', card: '#ffffff', line: '#e6e9ee', fg: '#1f2328', muted: '#6b7280',
      accent: '#2563eb', user: '#2563eb', tool: '#0891b2', answer: '#16a34a', err: '#dc2626',
      codeBg: '#f6f8fa', codeFg: '#1f2328', codeLine: '#d6dae0', hover: '#eef1f5', th: '#eaeef3', quote: '#b9c0cc'
    },
    dark: {
      bg: '#0d1117', panel: '#161b22', card: '#161b22', line: '#2a313c', fg: '#e6edf3', muted: '#9198a1',
      accent: '#58a6ff', user: '#58a6ff', tool: '#39c5cf', answer: '#3fb950', err: '#f85149',
      codeBg: '#0b1222', codeFg: '#d6deeb', codeLine: '#2a313c', hover: '#21262d', th: '#21262d', quote: '#3b434e'
    }
  },
  {
    id: 'm3e-tonal',
    name: '方案 A · M3E 色调容器',
    brand: { light: '246 65% 53%', dark: '258 100% 87%' },
    flow: ['#5b4ce8', '#7c6ff2', '#a78bfa', '#ec4899'],
    light: {
      bg: '#f6f4fa', panel: '#eae6f3', card: '#ffffff', line: '#dcd6ea', fg: '#1d1b24', muted: '#575267',
      accent: '#4838d4', user: '#4838d4', tool: '#b45309', answer: '#047857', err: '#b3261e',
      codeBg: '#f3f0fa', codeFg: '#1d1b24', codeLine: '#dcd6ea', hover: '#ede8ff', th: '#eae6f3', quote: '#c8bfe0'
    },
    dark: {
      bg: '#131218', panel: '#1e1c26', card: '#22202c', line: '#312e3f', fg: '#ece9f4', muted: '#a8a2b8',
      accent: '#d0bcff', user: '#d0bcff', tool: '#fbbf24', answer: '#34d399', err: '#f2b8b5',
      codeBg: '#121118', codeFg: '#ece9f4', codeLine: '#312e3f', hover: '#3a2e63', th: '#252232', quote: '#464159'
    }
  },
  {
    id: 'archive-paper',
    name: '方案 B · 档案暖纸石墨',
    brand: { light: '23 89% 29%', dark: '199 95% 60%' },
    flow: ['#8c3b08', '#d97706', '#065f46', '#52525b'],
    light: {
      bg: '#f8f7f4', panel: '#f0eee9', card: '#ffffff', line: '#dcd8ce', fg: '#18181b', muted: '#52525b',
      accent: '#8c3b08', user: '#8c3b08', tool: '#b45309', answer: '#065f46', err: '#b91c1c',
      codeBg: '#f3f1ec', codeFg: '#18181b', codeLine: '#dcd8ce', hover: '#e7e4dc', th: '#f0eee9', quote: '#beb8a8'
    },
    dark: {
      bg: '#0c0d10', panel: '#13151a', card: '#181b22', line: '#262934', fg: '#e4e4e7', muted: '#a1a1aa',
      accent: '#38bdf8', user: '#38bdf8', tool: '#fbbf24', answer: '#34d399', err: '#f87171',
      codeBg: '#090a0d', codeFg: '#e4e4e7', codeLine: '#262934', hover: '#1f2430', th: '#13151a', quote: '#3a3f4d'
    }
  },
  {
    id: 'liquid-glass',
    name: '方案 C · 液态冰晶玻璃',
    brand: { light: '243 80% 62%', dark: '234 89% 74%' },
    flow: ['#5850ec', '#0ea5e9', '#ec4899', '#10b981'],
    light: {
      bg: '#eef1f8', panel: '#ffffff', card: '#ffffff', line: '#dce3f0', fg: '#0f172a', muted: '#475569',
      accent: '#5850ec', user: '#2563eb', tool: '#d97706', answer: '#059669', err: '#dc2626',
      codeBg: '#f1f5f9', codeFg: '#0f172a', codeLine: '#dce3f0', hover: '#e2e8f0', th: '#e8eef7', quote: '#94a3b8'
    },
    dark: {
      bg: '#0b0f17', panel: '#141a26', card: '#1a2130', line: '#263044', fg: '#f1f5f9', muted: '#94a3b8',
      accent: '#818cf8', user: '#60a5fa', tool: '#fbbf24', answer: '#34d399', err: '#f87171',
      codeBg: '#090d14', codeFg: '#f1f5f9', codeLine: '#263044', hover: '#222b3d', th: '#141a26', quote: '#475569'
    }
  },
  {
    id: 'nord',
    name: 'Nord · 北欧冷蓝',
    brand: { light: '213 32% 52%', dark: '193 43% 67%' },
    flow: ['#5e81ac', '#81a1c1', '#8fbcbb', '#b48ead'],
    light: {
      bg: '#eceff4', panel: '#e5e9f0', card: '#e5e9f0', line: '#d8dee9', fg: '#2e3440', muted: '#4c566a',
      accent: '#5e81ac', user: '#5e81ac', tool: '#8fbcbb', answer: '#a3be8c', err: '#bf616a',
      codeBg: '#e5e9f0', codeFg: '#2e3440', codeLine: '#d8dee9', hover: '#dfe4ee', th: '#e5e9f0', quote: '#aeb7c6'
    },
    dark: {
      bg: '#2e3440', panel: '#3b4252', card: '#3b4252', line: '#434c5e', fg: '#eceff4', muted: '#8b93a5',
      accent: '#88c0d0', user: '#81a1c1', tool: '#8fbcbb', answer: '#a3be8c', err: '#bf616a',
      codeBg: '#292e39', codeFg: '#d8dee9', codeLine: '#434c5e', hover: '#434c5e', th: '#3b4252', quote: '#4c566a'
    }
  },
  {
    id: 'solarized',
    name: 'Solarized · 日光暖',
    brand: { light: '205 69% 49%', dark: '205 69% 49%' },
    flow: ['#268bd2', '#2aa198', '#859900', '#b58900'],
    light: {
      bg: '#fdf6e3', panel: '#eee8d5', card: '#eee8d5', line: '#e0dbc8', fg: '#586e75', muted: '#93a1a1',
      accent: '#268bd2', user: '#268bd2', tool: '#2aa198', answer: '#859900', err: '#dc322f',
      codeBg: '#eee8d5', codeFg: '#586e75', codeLine: '#ded8c5', hover: '#e9e2cd', th: '#eee8d5', quote: '#93a1a1'
    },
    dark: {
      bg: '#002b36', panel: '#073642', card: '#073642', line: '#0d4a58', fg: '#93a1a1', muted: '#657b83',
      accent: '#268bd2', user: '#268bd2', tool: '#2aa198', answer: '#859900', err: '#dc322f',
      codeBg: '#04222b', codeFg: '#93a1a1', codeLine: '#0d4a58', hover: '#073642', th: '#073642', quote: '#586e75'
    }
  },
  {
    id: 'dracula',
    name: 'Dracula · 暗夜紫',
    brand: { light: '265 100% 64%', dark: '265 89% 78%' },
    flow: ['#bd93f9', '#ff79c6', '#8be9fd', '#50fa7b'],
    light: {
      bg: '#f8f8f2', panel: '#ffffff', card: '#ffffff', line: '#e3e3dd', fg: '#282a36', muted: '#6c6c76',
      accent: '#9146ff', user: '#9146ff', tool: '#036a96', answer: '#14710a', err: '#cb3a2a',
      codeBg: '#f1f1eb', codeFg: '#282a36', codeLine: '#dedcd0', hover: '#efefe9', th: '#efefe9', quote: '#b0b0a8'
    },
    dark: {
      bg: '#282a36', panel: '#343746', card: '#343746', line: '#44475a', fg: '#f8f8f2', muted: '#7a83a8',
      accent: '#bd93f9', user: '#bd93f9', tool: '#8be9fd', answer: '#50fa7b', err: '#ff5555',
      codeBg: '#21222c', codeFg: '#f8f8f2', codeLine: '#44475a', hover: '#44475a', th: '#343746', quote: '#6272a4'
    }
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine · 玫瑰',
    brand: { light: '2 55% 63%', dark: '267 57% 78%' },
    flow: ['#c4a7e7', '#ebbcba', '#9ccfd8', '#f6c177'],
    light: {
      bg: '#faf4ed', panel: '#fffaf3', card: '#fffaf3', line: '#f2e9e1', fg: '#575279', muted: '#797593',
      accent: '#d7827e', user: '#907aa9', tool: '#56949f', answer: '#286983', err: '#b4637a',
      codeBg: '#fffaf3', codeFg: '#575279', codeLine: '#f2e9e1', hover: '#f4ede8', th: '#f4ede8', quote: '#9893a5'
    },
    dark: {
      bg: '#191724', panel: '#1f1d2e', card: '#1f1d2e', line: '#26233a', fg: '#e0def4', muted: '#908caa',
      accent: '#ebbcba', user: '#c4a7e7', tool: '#9ccfd8', answer: '#31748f', err: '#eb6f92',
      codeBg: '#1a1826', codeFg: '#e0def4', codeLine: '#26233a', hover: '#26233a', th: '#1f1d2e', quote: '#6e6a86'
    }
  },
  {
    id: 'forest',
    name: 'Forest · 森野绿',
    brand: { light: '142 71% 37%', dark: '135 55% 60%' },
    flow: ['#16a34a', '#0891b2', '#65a30d', '#0ea5e9'],
    light: {
      bg: '#f4f7f4', panel: '#ffffff', card: '#ffffff', line: '#dfe7df', fg: '#1b2b1b', muted: '#5f6f5f',
      accent: '#16a34a', user: '#15803d', tool: '#0891b2', answer: '#16a34a', err: '#dc2626',
      codeBg: '#f0f5f0', codeFg: '#1b2b1b', codeLine: '#d6e0d6', hover: '#eaf2ea', th: '#eaf2ea', quote: '#a8bda8'
    },
    dark: {
      bg: '#0e1a12', panel: '#142218', card: '#142218', line: '#24352a', fg: '#d7e8db', muted: '#8aa090',
      accent: '#3fb950', user: '#4ade80', tool: '#39c5cf', answer: '#3fb950', err: '#f85149',
      codeBg: '#0b1510', codeFg: '#d7e8db', codeLine: '#24352a', hover: '#1c2c22', th: '#142218', quote: '#3a4b40'
    }
  }
]

export const DEFAULT_PRESET_ID = 'default'

export function getPreset(id: string): ThemePreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]
}
