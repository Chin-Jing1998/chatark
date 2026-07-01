import { promises as fs } from 'node:fs'

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/**
 * 找到不冲突的目标路径：target 空闲则直接用，否则递增后缀 `-2`/`-3`… 直到找到空闲路径。
 * 用于导入撞名——避免 fs.cp（默认 force:true）覆盖已有目录内的会话文件。
 */
export async function findFreeTarget(target: string): Promise<string> {
  if (!(await exists(target))) return target
  let suffix = 2
  let candidate = `${target}-${suffix}`
  while (await exists(candidate)) {
    suffix += 1
    candidate = `${target}-${suffix}`
  }
  return candidate
}
