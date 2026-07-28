import { shell } from 'electron'
import { fail, ok, type OpResult } from '@shared/types'

/**
 * 把任意路径移入系统回收站（可恢复）。不支持回收站的位置返回 NO_TRASH。
 *
 * 所有"删除用户数据"的路径都必须经此函数，不得直接 fs.rm —— 包括迁移删源：
 * 删一个对话可恢复、删整个库根却不可恢复，是不可接受的安全等级倒挂。
 */
export async function trashPath(absPath: string): Promise<OpResult> {
  try {
    await shell.trashItem(absPath)
    return ok(undefined)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return fail('NO_TRASH', `移入回收站失败（该位置可能不支持回收站）：${message}`, true)
  }
}

/** 删除对话：移入系统回收站（可恢复）。 */
export function trashConversationDir(absDir: string): Promise<OpResult> {
  return trashPath(absDir)
}
