import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { FILE_NAMES } from '@shared/constants'
import { fail, ok, type MetaJson, type OpResult } from '@shared/types'
import { parseDirName, sanitizeTitleForDir } from './paths'

/**
 * 重命名对话标题：仅改 meta.json.title 与目录名标题段（保留时间戳_…_哈希骨架），
 * 不重写自包含的 html/md/data.js 快照。展示标题一律取 meta.title。
 */
export async function renameConversation(
  absDir: string,
  newTitle: string
): Promise<OpResult<{ newPath: string; newTitle: string }>> {
  const title = newTitle.trim()
  if (!title) return fail('INVALID_INPUT', '标题不能为空')

  const metaPath = join(absDir, FILE_NAMES.meta)

  // 1) 更新 meta.json.title（原子写）
  try {
    const raw = await fs.readFile(metaPath, 'utf8')
    const meta = JSON.parse(raw) as MetaJson
    meta.title = title
    const tmp = join(absDir, `.${FILE_NAMES.meta}.tmp`)
    await fs.writeFile(tmp, JSON.stringify(meta, null, 2), 'utf8')
    await fs.rename(tmp, metaPath)
  } catch (e) {
    return fail('IO_ERROR', `更新 meta.json 失败：${msg(e)}`)
  }

  // 2) 同步目录名标题段（解析失败则只改 meta、不动目录）
  const dirName = basename(absDir)
  const parsed = parseDirName(dirName)
  if (!parsed) return ok({ newPath: absDir, newTitle: title })

  const newDirName = `${parsed.ts}_${parsed.time}_${sanitizeTitleForDir(title)}_${parsed.hash8}`
  if (newDirName === dirName) return ok({ newPath: absDir, newTitle: title })

  const newPath = join(dirname(absDir), newDirName)
  if (await exists(newPath)) {
    // 目录名冲突：保留 meta 已改，目录维持原名
    return ok({ newPath: absDir, newTitle: title })
  }
  try {
    await fs.rename(absDir, newPath)
  } catch {
    return ok({ newPath: absDir, newTitle: title })
  }
  return ok({ newPath, newTitle: title })
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
