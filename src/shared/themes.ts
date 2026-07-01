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
export function paletteToTokens(p: Palette, dark: boolean): Record<string, string> {
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
    '--app-bg': aurora(p, dark)
  }
}

/** 取预设在指定明暗下的对话令牌（每个预设都有亮/暗两版，一律显式应用）。 */
export function presetConversationTokens(
  preset: ThemePreset,
  dark: boolean
): Record<string, string> {
  return paletteToTokens(dark ? preset.dark : preset.light, dark)
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
    name: '默认 · 极光蓝紫',
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
