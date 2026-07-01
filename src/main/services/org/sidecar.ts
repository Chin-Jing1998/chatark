import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { ORG_SIDECAR } from '@shared/constants'
import type { OrgMeta } from '@shared/types'

export const EMPTY_ORG: OrgMeta = { pinned: false, favorite: false, archived: false, tags: [] }

/** 读对话目录内的 chatark.json；不存在或损坏则返回空组织元数据。 */
export async function readOrg(convDir: string): Promise<OrgMeta> {
  try {
    const raw = await fs.readFile(join(convDir, ORG_SIDECAR), 'utf8')
    const parsed = JSON.parse(raw) as Partial<OrgMeta>
    return {
      pinned: Boolean(parsed.pinned),
      favorite: Boolean(parsed.favorite),
      archived: Boolean(parsed.archived),
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t) => typeof t === 'string') : []
    }
  } catch {
    return { ...EMPTY_ORG }
  }
}

/** 原子写 chatark.json。 */
export async function writeOrg(convDir: string, org: OrgMeta): Promise<void> {
  const target = join(convDir, ORG_SIDECAR)
  const tmp = join(convDir, `.${ORG_SIDECAR}.tmp`)
  await fs.writeFile(tmp, JSON.stringify(org, null, 2), 'utf8')
  await fs.rename(tmp, target)
}

/** 读取现有组织元数据，合并部分字段后原子写回，返回合并结果。 */
export async function updateOrg(convDir: string, partial: Partial<OrgMeta>): Promise<OrgMeta> {
  const current = await readOrg(convDir)
  const next: OrgMeta = { ...current, ...partial }
  await writeOrg(convDir, next)
  return next
}
