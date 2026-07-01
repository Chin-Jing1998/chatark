import type { ThemeMode } from '@shared/api'
import { THEME_MESSAGE } from '@shared/viewer'
import {
  getPreset,
  paletteToChromeVars,
  presetConversationTokens,
  type ThemePreset
} from '@shared/themes'

const STORAGE_KEY = 'platform-theme'
const PRESET_KEY = 'chatark-preset'

export function getStoredMode(): ThemeMode {
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

export function getStoredPreset(): string {
  return localStorage.getItem(PRESET_KEY) || 'default'
}

/** 把主题（含整套配色令牌）广播给所有已打开的对话 iframe（跨 origin，靠注入引导脚本接收）。 */
export function broadcastToFrames(
  theme: 'auto' | 'light' | 'dark',
  tokens: Record<string, string> | null = null
): void {
  document.querySelectorAll<HTMLIFrameElement>('iframe.conv-frame').forEach((f) => {
    f.contentWindow?.postMessage({ type: THEME_MESSAGE, theme, tokens }, '*')
  })
}

/**
 * 应用外壳预设变量：整套外壳令牌（背景/文本/侧栏/边框等，随主题全局变色）、
 * 强调色（--brand/--ring）、七彩流光四色（--flow-1..4）、对话 iframe 底色（--conv-bg）。
 */
function applyChrome(preset: ThemePreset, dark: boolean): void {
  const el = document.documentElement
  const palette = dark ? preset.dark : preset.light
  const chrome = paletteToChromeVars(palette)
  for (const [k, v] of Object.entries(chrome)) el.style.setProperty(k, v)
  const brand = dark ? preset.brand.dark : preset.brand.light
  el.style.setProperty('--brand', brand)
  el.style.setProperty('--ring', brand)
  el.style.setProperty('--conv-bg', palette.bg)
  preset.flow.forEach((c, i) => el.style.setProperty(`--flow-${i + 1}`, c))
}

/**
 * 应用主题：nativeTheme 为真源（返回是否暗色）；外壳切换 `.dark` 类 + 预设变量，
 * 对话 iframe 广播（含整套配色令牌，成套融合），并告知主进程用于新载入 iframe 的首屏注入。
 */
export async function applyTheme(mode: ThemeMode, presetId: string): Promise<void> {
  const preset = getPreset(presetId)
  const dark = await window.api.setThemeSource(mode)
  document.documentElement.classList.toggle('dark', dark)
  localStorage.setItem(STORAGE_KEY, mode)
  localStorage.setItem(PRESET_KEY, presetId)
  applyChrome(preset, dark)
  const theme = mode === 'system' ? 'auto' : mode
  const tokens = presetConversationTokens(preset, dark)
  broadcastToFrames(theme, tokens)
  void window.api.setThemeTokens(tokens)
}

/** 系统外观翻转时（system 模式）重算并同步外壳 + 对话正文（无需切模式）。 */
export function reapplyForSystem(presetId: string, dark: boolean): void {
  const preset = getPreset(presetId)
  document.documentElement.classList.toggle('dark', dark)
  applyChrome(preset, dark)
  const tokens = presetConversationTokens(preset, dark)
  broadcastToFrames('auto', tokens)
  void window.api.setThemeTokens(tokens)
}

/** 切换循环：跟随系统 → 亮 → 暗 → 跟随系统。 */
export function cycleMode(mode: ThemeMode): ThemeMode {
  return mode === 'system' ? 'light' : mode === 'light' ? 'dark' : 'system'
}

export const THEME_LABEL: Record<ThemeMode, string> = {
  system: '跟随系统',
  light: '亮色',
  dark: '暗色'
}
