import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { ChatArkApi, ConfirmOptions, ThemeChangedPayload, ThemeMode } from '@shared/api'
import type {
  BackfillProgress,
  ConversationRecord,
  ConversationSummary,
  HookStatus,
  ImportResult,
  ListQuery,
  ListResult,
  MigrationOutcome,
  MigrationProgress,
  OpResult,
  OrgMeta,
  ReexportResult,
  SearchHit,
  UnexportedSession
} from '@shared/types'

// 白名单 API：渲染进程只能通过 window.api 访问主进程能力，
// 不暴露 ipcRenderer / require / Node 原语。
const api: ChatArkApi = {
  platform: process.platform,

  setThemeSource: (mode: ThemeMode): Promise<boolean> => ipcRenderer.invoke(IPC.themeSet, mode),

  setThemeTokens: (tokens: Record<string, string> | null): Promise<void> =>
    ipcRenderer.invoke(IPC.themeSetTokens, tokens),

  onThemeChanged: (cb: (payload: ThemeChangedPayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: ThemeChangedPayload): void => cb(payload)
    ipcRenderer.on(IPC.themeChanged, listener)
    return () => ipcRenderer.removeListener(IPC.themeChanged, listener)
  },

  conv: {
    list: (query?: ListQuery): Promise<ListResult> => ipcRenderer.invoke(IPC.convList, query ?? {}),
    get: (id: string): Promise<ConversationRecord | null> => ipcRenderer.invoke(IPC.convGet, id),
    rescan: () => ipcRenderer.invoke(IPC.convRescan),
    move: (id: string, toCategory: string): Promise<OpResult<ConversationSummary>> =>
      ipcRenderer.invoke(IPC.convMove, id, toCategory),
    trash: (id: string): Promise<OpResult> => ipcRenderer.invoke(IPC.convTrash, id),
    rename: (id: string, newTitle: string): Promise<OpResult<ConversationSummary>> =>
      ipcRenderer.invoke(IPC.convRename, id, newTitle),
    setOrg: (id: string, partial: Partial<OrgMeta>): Promise<OpResult<ConversationSummary>> =>
      ipcRenderer.invoke(IPC.convSetOrg, id, partial),
    reveal: (id: string): Promise<OpResult> => ipcRenderer.invoke(IPC.convReveal, id),
    openExternal: (id: string): Promise<OpResult> => ipcRenderer.invoke(IPC.convOpenExternal, id)
  },

  file: {
    reveal: (absPath: string): Promise<void> => ipcRenderer.invoke(IPC.fileReveal, absPath)
  },

  search: {
    query: (q: string, limit?: number): Promise<SearchHit[]> =>
      ipcRenderer.invoke(IPC.searchQuery, q, limit)
  },

  library: {
    getRoot: (): Promise<string> => ipcRenderer.invoke(IPC.libraryGetRoot),
    pickRoot: (): Promise<string | null> => ipcRenderer.invoke(IPC.libraryPickRoot),
    setRoot: (newRoot: string): Promise<OpResult<MigrationOutcome>> =>
      ipcRenderer.invoke(IPC.librarySetRoot, newRoot)
  },

  backfill: {
    scanRaw: (): Promise<UnexportedSession[]> => ipcRenderer.invoke(IPC.backfillScanRaw),
    reexport: (ids: string[]): Promise<ReexportResult> => ipcRenderer.invoke(IPC.backfillReexport, ids),
    pickImport: (): Promise<string[]> => ipcRenderer.invoke(IPC.backfillPickImport),
    import: (dirs: string[]): Promise<OpResult<ImportResult>[]> =>
      ipcRenderer.invoke(IPC.backfillImport, dirs)
  },

  hook: {
    status: (): Promise<HookStatus> => ipcRenderer.invoke(IPC.hookStatus),
    install: (replacePython: boolean): Promise<OpResult<HookStatus>> =>
      ipcRenderer.invoke(IPC.hookInstall, replacePython),
    uninstall: (): Promise<OpResult<HookStatus>> => ipcRenderer.invoke(IPC.hookUninstall)
  },

  ui: {
    confirm: (opts: ConfirmOptions): Promise<boolean> => ipcRenderer.invoke(IPC.uiConfirm, opts)
  },

  onLibraryChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.evtLibrary, listener)
    return () => ipcRenderer.removeListener(IPC.evtLibrary, listener)
  },

  onOpenCommand: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.evtOpenCommand, listener)
    return () => ipcRenderer.removeListener(IPC.evtOpenCommand, listener)
  },

  onMigration: (cb: (p: MigrationProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: MigrationProgress): void => cb(p)
    ipcRenderer.on(IPC.evtMigration, listener)
    return () => ipcRenderer.removeListener(IPC.evtMigration, listener)
  },

  onBackfill: (cb: (p: BackfillProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: BackfillProgress): void => cb(p)
    ipcRenderer.on(IPC.evtBackfill, listener)
    return () => ipcRenderer.removeListener(IPC.evtBackfill, listener)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  ;(globalThis as unknown as { api: ChatArkApi }).api = api
}
