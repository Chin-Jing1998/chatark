import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fail, ok, KNOWN_CATEGORIES, type ImportResult, type OpResult } from '@shared/types'
import { library } from '../library'
import { getLibraryRoot } from '../settings/store'
import { parseConversationDir } from '../fs/parse-dir'
import { parseDirName, sanitizeTitleForDir, sessionHash8 } from '../fs/paths'
import { findFreeTarget } from '../fs/free-path'

export type { ImportResult }

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function deriveFolderName(dirName: string, startedAt: string, title: string, sessionId: string): string {
  const parsed = parseDirName(dirName)
  if (parsed) return dirName // 已是规范目录名，沿用
  const d = startedAt ? new Date(startedAt) : new Date()
  const valid = !Number.isNaN(d.getTime())
  const base = valid ? d : new Date(0)
  const ts = `${base.getFullYear()}${pad2(base.getMonth() + 1)}${pad2(base.getDate())}`
  const tm = `${pad2(base.getHours())}${pad2(base.getMinutes())}${pad2(base.getSeconds())}`
  const hash = sessionHash8(sessionId) || 'unknownx'
  return `${ts}_${tm}_${sanitizeTitleForDir(title)}_${hash}`
}

/**
 * 拖拽导入一个对话包目录：解析 meta → 去重（sessionId）→ 决定分类目录 → 复制/移动入库。
 * 默认 copy（保留原件）。
 */
export async function importPackageDir(
  srcDir: string,
  mode: 'copy' | 'move' = 'copy'
): Promise<OpResult<ImportResult>> {
  let rec
  try {
    rec = await parseConversationDir(srcDir, dirname(srcDir), Date.now())
  } catch (e) {
    return fail('PARSE_ERROR', `解析失败：${e instanceof Error ? e.message : e}`)
  }
  if (!rec.files.meta.exists && !rec.sessionId) {
    return ok({ status: 'invalid', message: '缺少 meta.json 且无法确定 sessionId' })
  }
  const sessionId = rec.sessionId
  if (!sessionId) return ok({ status: 'invalid', message: '无法确定 sessionId' })

  // 去重：同 sessionId 已在库 → 跳过
  if (library.allSessionIds().has(sessionId)) {
    return ok({ status: 'skipped-duplicate', sessionId })
  }

  const root = getLibraryRoot()
  const metaCat = rec.meta.category
  const category = metaCat && (KNOWN_CATEGORIES as readonly string[]).includes(metaCat) ? metaCat : (metaCat || '其他')
  const folder = deriveFolderName(basename(srcDir), rec.startedAt, rec.title, sessionId)
  const targetCatDir = join(root, category)
  let target = join(targetCatDir, folder)

  // 整段包进抑制：复制期间的监听回声不触发重扫，结束后由闸门统一重放一次
  return library.runSuppressed(async (): Promise<OpResult<ImportResult>> => {
    try {
      await fs.mkdir(targetCatDir, { recursive: true })
      // 目录名冲突（不同 sessionId 撞名）→ 递增后缀直到空闲路径，避免 fs.cp 覆盖已有会话
      target = await findFreeTarget(target)
      await fs.cp(srcDir, target, { recursive: true })
      if (mode === 'move') await fs.rm(srcDir, { recursive: true, force: true })
      await library.rescan()
    } catch (e) {
      return fail('IO_ERROR', `落盘失败：${e instanceof Error ? e.message : e}`)
    }
    return ok({ status: 'imported', sessionId, dir: target })
  })
}
