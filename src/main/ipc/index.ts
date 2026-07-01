import { registerThemeIpc } from './theme.ipc'
import { registerConversationsIpc } from './conversations.ipc'
import { registerSearchIpc } from './search.ipc'
import { registerLibraryIpc } from './library.ipc'
import { registerBackfillIpc } from './backfill.ipc'
import { registerUiIpc } from './ui.ipc'

let registered = false

/** 统一注册所有 IPC（幂等）。 */
export function registerIpc(): void {
  if (registered) return
  registered = true
  registerThemeIpc()
  registerConversationsIpc()
  registerSearchIpc()
  registerLibraryIpc()
  registerBackfillIpc()
  registerUiIpc()
}
