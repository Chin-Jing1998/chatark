import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode
} from 'react'
import { KNOWN_CATEGORIES, type ConversationSummary } from '@shared/types'
import { appendCapped, bump, type Tab } from './tabs'

export type { Tab } from './tabs'
export { MAX_TABS } from './tabs'

export type Filter =
  | { kind: 'all' }
  | { kind: 'category'; value: string }
  | { kind: 'group'; value: 'pinned' | 'favorite' | 'archived' }

interface State {
  summaries: ConversationSummary[]
  byCategory: Record<string, number>
  total: number
  loading: boolean
  error: string | null
  filter: Filter
  tabs: Tab[]
  activeId: string | null
  root: string
  lastScanMs: number
  /** 最近打开的对话 id（去重、最多 20，持久化于 localStorage） */
  recentIds: string[]
  /** 标签近用顺序（最近在前，含文件标签）：用于满 10 时 LRU 淘汰 */
  tabRecency: string[]
  /** 对话在本应用中的最近打开时间（毫秒），持久化；用于“打开时间”排序 */
  openedAt: Record<string, number>
}

const RECENTS_KEY = 'chatark-recent'
const OPENED_AT_KEY = 'chatark-opened-at'

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    const arr: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, 20) : []
  } catch {
    return []
  }
}

function loadOpenedAt(): Record<string, number> {
  try {
    const raw = localStorage.getItem(OPENED_AT_KEY)
    const obj: unknown = raw ? JSON.parse(raw) : {}
    if (!obj || typeof obj !== 'object') return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === 'number') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

type Action =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_OK'; summaries: ConversationSummary[]; byCategory: Record<string, number>; total: number; tookMs: number }
  | { type: 'LOAD_ERR'; error: string }
  | { type: 'SET_FILTER'; filter: Filter }
  | { type: 'OPEN_TAB'; tab: Tab; at: number }
  | { type: 'OPEN_FILE'; tab: Tab }
  | { type: 'CLOSE_TAB'; id: string }
  | { type: 'ACTIVATE'; id: string }
  | { type: 'RENAME_TAB'; id: string; title: string }
  | { type: 'UPDATE_TAB'; oldId: string; newId: string; title: string }
  | { type: 'REORDER_TAB'; fromId: string; toId: string }
  | { type: 'SET_ROOT'; root: string }

const initialState: State = {
  summaries: [],
  byCategory: {},
  total: 0,
  loading: true,
  error: null,
  filter: { kind: 'all' },
  tabs: [],
  activeId: null,
  root: '',
  lastScanMs: 0,
  recentIds: [],
  tabRecency: [],
  openedAt: {}
}

/** 惰性初始化：从 localStorage 恢复最近打开列表与打开时间。 */
function initState(base: State): State {
  return { ...base, recentIds: loadRecents(), openedAt: loadOpenedAt() }
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, loading: true, error: null }
    case 'LOAD_OK':
      return {
        ...state,
        loading: false,
        summaries: action.summaries,
        byCategory: action.byCategory,
        total: action.total,
        lastScanMs: action.tookMs
      }
    case 'LOAD_ERR':
      return { ...state, loading: false, error: action.error }
    case 'SET_FILTER':
      return { ...state, filter: action.filter }
    case 'SET_ROOT':
      return { ...state, root: action.root }
    case 'OPEN_TAB': {
      const exists = state.tabs.some((t) => t.id === action.tab.id)
      const recentIds = [action.tab.id, ...state.recentIds.filter((x) => x !== action.tab.id)].slice(0, 20)
      const recency = bump(state.tabRecency, action.tab.id)
      const tabs = exists ? state.tabs : appendCapped(state.tabs, recency, action.tab)
      return {
        ...state,
        tabs,
        activeId: action.tab.id,
        recentIds,
        tabRecency: recency.filter((id) => tabs.some((t) => t.id === id)),
        openedAt: { ...state.openedAt, [action.tab.id]: action.at }
      }
    }
    case 'OPEN_FILE': {
      const exists = state.tabs.some((t) => t.id === action.tab.id)
      const recency = bump(state.tabRecency, action.tab.id)
      const tabs = exists ? state.tabs : appendCapped(state.tabs, recency, action.tab)
      return {
        ...state,
        tabs,
        activeId: action.tab.id,
        tabRecency: recency.filter((id) => tabs.some((t) => t.id === id))
      }
    }
    case 'CLOSE_TAB': {
      const idx = state.tabs.findIndex((t) => t.id === action.id)
      if (idx < 0) return state
      const tabs = state.tabs.filter((t) => t.id !== action.id)
      let activeId = state.activeId
      if (state.activeId === action.id) {
        const next = tabs[idx] ?? tabs[idx - 1] ?? null
        activeId = next ? next.id : null
      }
      return { ...state, tabs, activeId, tabRecency: state.tabRecency.filter((id) => id !== action.id) }
    }
    case 'ACTIVATE':
      return { ...state, activeId: action.id, tabRecency: bump(state.tabRecency, action.id) }
    case 'RENAME_TAB':
      return {
        ...state,
        tabs: state.tabs.map((t) => (t.id === action.id ? { ...t, title: action.title } : t))
      }
    case 'UPDATE_TAB': {
      // id 变化（缺 sessionId 的对话改目录后）：同步更新标签 id/标题与 activeId，避免重复标签与命令面板失联
      const tabs = state.tabs.map((t) =>
        t.id === action.oldId ? { ...t, id: action.newId, title: action.title } : t
      )
      return {
        ...state,
        tabs,
        activeId: state.activeId === action.oldId ? action.newId : state.activeId,
        tabRecency: state.tabRecency.map((id) => (id === action.oldId ? action.newId : id))
      }
    }
    case 'REORDER_TAB': {
      const from = state.tabs.findIndex((t) => t.id === action.fromId)
      const to = state.tabs.findIndex((t) => t.id === action.toId)
      if (from < 0 || to < 0 || from === to) return state
      const tabs = [...state.tabs]
      const [moved] = tabs.splice(from, 1)
      tabs.splice(to, 0, moved)
      return { ...state, tabs }
    }
    default:
      return state
  }
}

interface StoreApi {
  state: State
  setFilter: (filter: Filter) => void
  openTab: (item: ConversationSummary) => void
  openConversation: (id: string, title: string) => void
  /** 在应用内新标签打开任意文件（渲染 md/代码/html/图片） */
  openFile: (absPath: string) => void
  closeTab: (id: string) => void
  activate: (id: string) => void
  renameTab: (id: string, title: string) => void
  updateTab: (oldId: string, newId: string, title: string) => void
  reorderTab: (fromId: string, toId: string) => void
  rescan: () => Promise<void>
  reload: () => Promise<void>
}

const StoreContext = createContext<StoreApi | null>(null)

export function StoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState, initState)

  // 持久化最近打开列表
  useEffect(() => {
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(state.recentIds))
    } catch {
      /* 忽略持久化失败（无痛降级） */
    }
  }, [state.recentIds])

  // 持久化对话打开时间（用于“打开时间”排序）
  useEffect(() => {
    try {
      localStorage.setItem(OPENED_AT_KEY, JSON.stringify(state.openedAt))
    } catch {
      /* 忽略持久化失败 */
    }
  }, [state.openedAt])

  const reload = useCallback(async () => {
    dispatch({ type: 'LOAD_START' })
    try {
      const r = await window.api.conv.list({ sort: 'started_desc' })
      dispatch({
        type: 'LOAD_OK',
        summaries: r.items,
        byCategory: r.byCategory,
        total: r.total,
        tookMs: 0
      })
    } catch (e) {
      dispatch({ type: 'LOAD_ERR', error: e instanceof Error ? e.message : String(e) })
    }
  }, [])

  const rescan = useCallback(async () => {
    dispatch({ type: 'LOAD_START' })
    try {
      await window.api.conv.rescan()
      await reload()
    } catch (e) {
      dispatch({ type: 'LOAD_ERR', error: e instanceof Error ? e.message : String(e) })
    }
  }, [reload])

  useEffect(() => {
    void window.api.library.getRoot().then((root) => dispatch({ type: 'SET_ROOT', root }))
    void reload()
  }, [reload])

  // 外部磁盘变更 → 主进程重扫后通知 → 刷新列表
  useEffect(() => {
    return window.api.onLibraryChanged(() => {
      void reload()
    })
  }, [reload])

  const api = useMemo<StoreApi>(
    () => ({
      state,
      setFilter: (filter) => dispatch({ type: 'SET_FILTER', filter }),
      openTab: (item) =>
        dispatch({
          type: 'OPEN_TAB',
          tab: { id: item.id, title: item.title, kind: 'conversation' },
          at: Date.now()
        }),
      openConversation: (id, title) =>
        dispatch({ type: 'OPEN_TAB', tab: { id, title, kind: 'conversation' }, at: Date.now() }),
      openFile: (absPath) =>
        dispatch({
          type: 'OPEN_FILE',
          tab: {
            id: `file:${absPath}`,
            title: absPath.split(/[\\/]/).pop() || absPath,
            kind: 'file',
            path: absPath
          }
        }),
      closeTab: (id) => dispatch({ type: 'CLOSE_TAB', id }),
      activate: (id) => dispatch({ type: 'ACTIVATE', id }),
      renameTab: (id, title) => dispatch({ type: 'RENAME_TAB', id, title }),
      updateTab: (oldId, newId, title) => dispatch({ type: 'UPDATE_TAB', oldId, newId, title }),
      reorderTab: (fromId, toId) => dispatch({ type: 'REORDER_TAB', fromId, toId }),
      rescan,
      reload
    }),
    [state, rescan, reload]
  )

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>
}

export function useStore(): StoreApi {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore 必须在 StoreProvider 内使用')
  return ctx
}

/** 有序分类：已知分类在前（按约定顺序），其余按字母序补后。 */
export function selectOrderedCategories(state: State): string[] {
  const present = Object.keys(state.byCategory)
  const known: string[] = KNOWN_CATEGORIES.filter((c) => present.includes(c))
  const extra = present.filter((c) => !known.includes(c)).sort()
  return [...known, ...extra]
}

/** 全部可选分类（含未出现的已知分类），用于“改分类”菜单。 */
export function selectAllCategories(state: State): string[] {
  return [...new Set<string>([...KNOWN_CATEGORIES, ...Object.keys(state.byCategory)])]
}

/** 依据当前 filter 计算可见对话。 */
export function selectVisible(state: State): ConversationSummary[] {
  const { filter, summaries } = state
  switch (filter.kind) {
    case 'category':
      return summaries.filter((s) => s.category === filter.value)
    case 'group':
      return summaries.filter((s) => s.org[filter.value])
    case 'all':
    default:
      return summaries
  }
}
