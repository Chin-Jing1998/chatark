import { promises as fs, type Dirent } from 'node:fs'
import { join, dirname, relative, resolve, isAbsolute, sep } from 'node:path'
import { fail, ok, type MigrationProgress, type OpResult } from '@shared/types'

/** a 是否包含 b（b 在 a 内部或二者相同）。 */
function contains(a: string, b: string): boolean {
  const rel = relative(resolve(a), resolve(b))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export type { MigrationProgress }

export interface MigrationPlan {
  totalBytes: number
  totalFiles: number
  conflicts: string[]
  freeBytes: number
  enoughSpace: boolean
}

interface FileEntry {
  rel: string
  size: number
}

/** 递归遍历目录，收集相对路径与大小（跳过符号链接，防循环）。 */
async function walk(root: string, base = root, acc: FileEntry[] = []): Promise<FileEntry[]> {
  let entries: Dirent<string>[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    const full = join(root, e.name)
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) {
      await walk(full, base, acc)
    } else if (e.isFile()) {
      try {
        const s = await fs.stat(full)
        acc.push({ rel: relative(base, full), size: s.size })
      } catch {
        /* 跳过不可读文件 */
      }
    }
  }
  return acc
}

async function freeSpace(path: string): Promise<number> {
  let target = resolve(path)
  // newRoot 常尚不存在（用户选新路径）：ENOENT 时上溯到最近存在的祖先目录再测，
  // 否则 statfs 抛 ENOENT 会让空间预检被静默跳过、磁盘写满才失败。
  for (;;) {
    try {
      const s = await fs.statfs(target)
      return s.bavail * s.bsize
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        const parent = dirname(target)
        if (parent === target) return Number.MAX_SAFE_INTEGER // 已到根仍不存在
        target = parent
        continue
      }
      return Number.MAX_SAFE_INTEGER // 其它错误不阻塞
    }
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** 预演：统计源大小/文件数、目标冲突、空间是否充足。 */
export async function planMigration(oldRoot: string, newRoot: string): Promise<MigrationPlan> {
  const files = await walk(oldRoot)
  const totalBytes = files.reduce((s, f) => s + f.size, 0)
  const conflicts: string[] = []
  for (const f of files) {
    if (await exists(join(newRoot, f.rel))) conflicts.push(f.rel)
  }
  await fs.mkdir(newRoot, { recursive: true }).catch(() => undefined)
  const free = await freeSpace(newRoot)
  return {
    totalBytes,
    totalFiles: files.length,
    conflicts,
    freeBytes: free,
    enoughSpace: free >= totalBytes * 1.05
  }
}

/**
 * 安全迁移：复制 → 校验 → 切换（由调用方更新配置） → 删源。
 * 原则：校验通过前绝不删旧数据；失败则清理目标半成品、源原封不动。
 * 注意：本函数不改配置，仅完成"复制+校验+删源"；切换库根由调用方在 onSwitch 回调里做。
 */
export async function runMigration(
  oldRoot: string,
  newRoot: string,
  onProgress: (p: MigrationProgress) => void,
  onSwitch: () => void
): Promise<OpResult<{ movedFiles: number }>> {
  if (oldRoot === newRoot) return fail('INVALID_INPUT', '新旧路径相同')
  // 防数据丢失：新旧路径不得互相嵌套（否则删源会连带删掉已复制的目标）
  if (contains(oldRoot, newRoot) || contains(newRoot, oldRoot)) {
    return fail('INVALID_INPUT', '新旧路径存在嵌套关系，请另选一个独立目录')
  }

  const files = await walk(oldRoot)
  const totalBytes = files.reduce((s, f) => s + f.size, 0)
  const totalFiles = files.length

  // 预检空间
  const free = await freeSpace(newRoot)
  if (free < totalBytes * 1.05) {
    return fail('NO_SPACE', `目标磁盘空间不足（需约 ${Math.ceil((totalBytes * 1.05) / 1e6)}MB）`)
  }

  onProgress({ phase: 'plan', copiedBytes: 0, totalBytes, copiedFiles: 0, totalFiles })

  // 记录 newRoot 迁移前是否已存在：失败回滚时用于决定整体删除还是仅清空新建骨架
  const newRootExisted = await exists(newRoot)

  // 复制
  let copiedBytes = 0
  let copiedFiles = 0
  try {
    await fs.mkdir(newRoot, { recursive: true })
    for (const f of files) {
      const src = join(oldRoot, f.rel)
      const dest = join(newRoot, f.rel)
      await fs.mkdir(dirname(dest), { recursive: true })
      await fs.copyFile(src, dest)
      copiedBytes += f.size
      copiedFiles += 1
      if (copiedFiles % 10 === 0 || copiedFiles === totalFiles) {
        onProgress({ phase: 'copying', copiedBytes, totalBytes, copiedFiles, totalFiles })
      }
    }
  } catch (e) {
    await rollbackTargets(newRoot, files, newRootExisted).catch(() => undefined)
    return fail('IO_ERROR', `复制失败，已清理目标、源保留：${msg(e)}`)
  }

  // 校验：逐文件大小一致
  onProgress({ phase: 'verifying', copiedBytes, totalBytes, copiedFiles, totalFiles })
  for (const f of files) {
    try {
      const s = await fs.stat(join(newRoot, f.rel))
      if (s.size !== f.size) {
        await rollbackTargets(newRoot, files, newRootExisted).catch(() => undefined)
        return fail('IO_ERROR', `校验失败（大小不一致）：${f.rel}，已清理目标、源保留`)
      }
    } catch {
      await rollbackTargets(newRoot, files, newRootExisted).catch(() => undefined)
      return fail('IO_ERROR', `校验失败（缺文件）：${f.rel}，已清理目标、源保留`)
    }
  }

  // 切换库根（调用方更新配置）
  onProgress({ phase: 'switching', copiedBytes, totalBytes, copiedFiles, totalFiles })
  onSwitch()

  // 删源（校验已过，安全）
  await deleteSourceTopLevel(oldRoot).catch(() => undefined)

  onProgress({ phase: 'done', copiedBytes, totalBytes, copiedFiles, totalFiles })
  return ok({ movedFiles: totalFiles })
}

/**
 * 失败回滚：清理本次复制产生的内容，不动目标已有数据。
 * newRoot 为本次新建 → 整体删除；newRoot 原已存在 → 删本次复制的文件并逐级删空的新建子目录。
 */
async function rollbackTargets(
  newRoot: string,
  files: FileEntry[],
  newRootExisted: boolean
): Promise<void> {
  if (!newRootExisted) {
    await fs.rm(newRoot, { recursive: true, force: true }).catch(() => undefined)
    return
  }
  for (const f of files) {
    await fs.rm(join(newRoot, f.rel), { force: true }).catch(() => undefined)
  }
  // 收集本次复制涉及的子目录，按深度降序尝试 rmdir（仅空目录会被删除，保留预有内容）
  const dirs = new Set<string>()
  for (const f of files) {
    let d = dirname(join(newRoot, f.rel))
    while (d.startsWith(newRoot + sep) && d !== newRoot) {
      dirs.add(d)
      d = dirname(d)
    }
  }
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    await fs.rmdir(d).catch(() => undefined)
  }
}

/** 删除源根下的顶层条目（迁移后清空旧库，但保留旧库根目录本身）。 */
async function deleteSourceTopLevel(oldRoot: string): Promise<void> {
  const entries = await fs.readdir(oldRoot, { withFileTypes: true })
  for (const e of entries) {
    await fs.rm(join(oldRoot, e.name), { recursive: true, force: true }).catch(() => undefined)
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
