import { promises as fs } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fail, ok, type OpResult } from '@shared/types'

/** 把对话目录移动到目标分类目录下。优先原子 rename，跨卷回退 cp+rm。 */
export async function moveToCategory(
  absDir: string,
  toCategory: string,
  root: string
): Promise<OpResult<{ newPath: string }>> {
  const dirName = basename(absDir)
  const currentCategory = basename(dirname(absDir))
  if (currentCategory === toCategory) return ok({ newPath: absDir })

  const targetCatDir = join(root, toCategory)
  // 防路径穿越：目标分类目录必须严格落在库根内（拦截 toCategory 含 ../ 等）
  const rootResolved = resolve(root)
  if (!(resolve(targetCatDir) + sep).startsWith(rootResolved + sep)) {
    return fail('INVALID_INPUT', `非法分类名：${toCategory}`)
  }
  const target = join(targetCatDir, dirName)

  try {
    await fs.mkdir(targetCatDir, { recursive: true })
  } catch (e) {
    return fail('IO_ERROR', `创建分类目录失败：${msg(e)}`)
  }

  if (await exists(target)) {
    return fail('NAME_COLLISION', `目标分类下已存在同名目录：${dirName}`)
  }

  try {
    await fs.rename(absDir, target)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
      // 跨卷回退：复制成功后再删源；删源若中途失败，先清理已复制的孤立 target 再报错，
      // 使失败收敛到"操作前状态"，避免源半删 + 目标孤立并存。
      try {
        await fs.cp(absDir, target, { recursive: true })
      } catch (eCopy) {
        await fs.rm(target, { recursive: true, force: true }).catch(() => undefined)
        return fail('IO_ERROR', `跨卷复制失败：${msg(eCopy)}`)
      }
      try {
        await fs.rm(absDir, { recursive: true, force: true })
      } catch (eRm) {
        await fs.rm(target, { recursive: true, force: true }).catch(() => undefined)
        return fail('IO_ERROR', `跨卷移动删源失败，已回滚目标副本、源保留：${msg(eRm)}`)
      }
    } else {
      return fail('IO_ERROR', `移动失败：${msg(e)}`)
    }
  }
  return ok({ newPath: target })
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
