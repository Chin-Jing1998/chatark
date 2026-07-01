import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { SearchHit } from '@shared/types'
import { library } from '../services/library'
import { searchService } from '../services/search/search'

/** 注册搜索 IPC。 */
export function registerSearchIpc(): void {
  ipcMain.handle(IPC.searchQuery, async (_e, q: string, limit?: number): Promise<SearchHit[]> => {
    await library.ensureLoaded() // 确保索引数据源已注入
    return searchService.query(q, limit ?? 50)
  })
}
