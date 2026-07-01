import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { ThemeMode } from '@shared/api'
import { applyTheme, cycleMode, getStoredMode, getStoredPreset, reapplyForSystem } from './theme'

export interface UseTheme {
  mode: ThemeMode
  preset: string
  toggle: () => void
  set: (mode: ThemeMode) => void
  setPreset: (id: string) => void
}

const ThemeContext = createContext<UseTheme | null>(null)

/**
 * 主题单一源：全应用共享 mode + preset。
 * 初始化、切换、系统外观翻转时同步外壳 .dark/预设变量与对话 iframe（含整套配色令牌）。
 */
export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [mode, setMode] = useState<ThemeMode>(getStoredMode)
  const [preset, setPresetState] = useState<string>(getStoredPreset)
  const presetRef = useRef(preset)
  presetRef.current = preset

  useEffect(() => {
    void applyTheme(mode, preset)
  }, [mode, preset])

  useEffect(() => {
    const off = window.api.onThemeChanged(({ dark }) => {
      if (getStoredMode() === 'system') reapplyForSystem(presetRef.current, dark)
    })
    return off
  }, [])

  const toggle = useCallback(() => setMode((m) => cycleMode(m)), [])

  return (
    <ThemeContext.Provider
      value={{ mode, preset, toggle, set: setMode, setPreset: setPresetState }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): UseTheme {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme 必须在 ThemeProvider 内使用')
  return ctx
}
