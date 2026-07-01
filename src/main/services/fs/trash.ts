import { shell } from 'electron'
import { fail, ok, type OpResult } from '@shared/types'

/** 删除对话：移入系统回收站（可恢复）。不支持回收站的位置返回 NO_TRASH。 */
export async function trashConversationDir(absDir: string): Promise<OpResult> {
  try {
    await shell.trashItem(absDir)
    return ok(undefined)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return fail('NO_TRASH', `移入回收站失败（该位置可能不支持回收站）：${message}`, true)
  }
}
