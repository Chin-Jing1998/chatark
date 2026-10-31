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
import type { UiScheme } from '@shared/themes'
import {
  applyTheme,
  cycleMode,
  defaultPresetForScheme,
  getStoredMode,
  getStoredPreset,
  getStoredScheme,
  nextScheme,
  reapplyForSystem
} from './theme'

export interface UseTheme {
  mode: ThemeMode
  preset: string
  scheme: UiScheme
  toggle: () => void
  set: (mode: ThemeMode) => void
  setPreset: (id: string) => void
  setScheme: (scheme: UiScheme) => void
  cycleScheme: () => void
}

const ThemeContext = createContext<UseTheme | null>(null)

/**
 * 主题单一源：全应用共享 mode + preset。
 * 初始化、切换、系统外观翻转时同步外壳 .dark/预设变量与对话 iframe（含整套配色令牌）。
 */
export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [mode, setMode] = useState<ThemeMode>(getStoredMode)
  const [preset, setPresetState] = useState<string>(getStoredPreset)
  const [scheme, setSchemeState] = useState<UiScheme>(getStoredScheme)
  const presetRef = useRef(preset)
  presetRef.current = preset
  const schemeRef = useRef(scheme)
  schemeRef.current = scheme

  useEffect(() => {
    void applyTheme(mode, preset, scheme)
  }, [mode, preset, scheme])

  useEffect(() => {
    const off = window.api.onThemeChanged(({ dark }) => {
      if (getStoredMode() === 'system') {
        reapplyForSystem(presetRef.current, dark, schemeRef.current)
      }
    })
    return off
  }, [])

  const toggle = useCallback(() => setMode((m) => cycleMode(m)), [])
  const setScheme = useCallback((next: UiScheme) => {
    setSchemeState(next)
    setPresetState(defaultPresetForScheme(next))
  }, [])
  const cycleScheme = useCallback(() => {
    setSchemeState((cur) => {
      const next = nextScheme(cur)
      setPresetState(defaultPresetForScheme(next))
      return next
    })
  }, [])

  return (
    <ThemeContext.Provider
      value={{
        mode,
        preset,
        scheme,
        toggle,
        set: setMode,
        setPreset: setPresetState,
        setScheme,
        cycleScheme
      }}
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
