/** 项目内会话归档。作者：Chin_Jing1998；修订日期：2026-10-31（北京时间）。 */
import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import * as engine from './exporter/engine'
import { shouldExport } from './exporter/gate'
import { readAll } from './exporter/jsonl-parser'
import { nowIso } from './exporter/timeutil'
import { folderName, readExistingMeta, writeExport } from './exporter/writer'

export const PROJECT_ARCHIVE_DIR = 'claude code对话记录'
export const CODEX_PROJECT_ARCHIVE_DIR = 'codex对话记录'
const AUTHOR = 'Chin_Jing1998'
const FILES = [engine.MD_NAME, engine.HTML_NAME, engine.JS_NAME, engine.META_NAME, engine.TRANSCRIPT_NAME]

export interface ProjectExportInput {
  hook_event_name: string
  session_id: string
  transcript_path: string
  cwd: string
}

export interface ProjectExportResult {
  status: 'written' | 'unchanged' | 'skipped'
  dir?: string
  reason?: string
  sourceClient?: 'claude' | 'codex'
}

async function digest(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

/** 只接受真实目录，防止项目中的同名软链接把归档写入其他位置。 */
async function ensureDirectory(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const st = await fs.lstat(dir)
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('归档位置不是独立目录：' + dir)
}

/**
 * 优先使用 Claude Code / Codex 的启动项目目录，避免会话中的 cd 改变归档位置。
 * 不调用模型、不筛掉 Haiku 工作会话；没有实际问答的空会话不建立记录。
 * 自动识别 Claude Code 与 Codex 原始转录，分别归档至 `claude code对话记录` 与 `codex对话记录`。
 */
export async function exportProjectSession(
  input: ProjectExportInput,
  projectDir?: string
): Promise<ProjectExportResult> {
  if (input.hook_event_name !== 'SessionEnd') return { status: 'skipped', reason: '非会话结束事件' }
  if (!input.session_id || !path.isAbsolute(input.transcript_path) || !input.transcript_path.endsWith('.jsonl')) {
    throw new Error('会话标识或转录路径无效')
  }
  const parsed = await readAll(input.transcript_path)
  if (!shouldExport(parsed)) return { status: 'skipped', reason: '无完整的用户提问与助手响应' }
  const sourceClient = parsed.sourceClient ?? 'claude'
  const archiveDirName = sourceClient === 'codex' ? CODEX_PROJECT_ARCHIVE_DIR : PROJECT_ARCHIVE_DIR
  const conv = engine.buildFromRecords(parsed.records, parsed.stats, input.transcript_path)
  if (conv.session_id && conv.session_id !== input.session_id) throw new Error('Hook 与转录的会话标识不一致')
  conv.session_id = input.session_id
  const project = projectDir || conv.cwd || input.cwd
  if (!project || !path.isAbsolute(project) || !(await fs.stat(project)).isDirectory()) {
    throw new Error('会话所属项目目录不存在')
  }
  const root = path.join(await fs.realpath(project), archiveDirName)
  await ensureDirectory(root)
  // 归档保存在项目内，但默认不进入 Git 提交；已有忽略文件保持原样。
  await fs.writeFile(path.join(root, '.gitignore'), '*\n!.gitignore\n', { flag: 'wx', mode: 0o600 })
    .catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error })

  let target: string | undefined
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(root, entry.name)
    if ((await readExistingMeta(candidate))?.sessionId === conv.session_id) {
      target = candidate
      break
    }
  }
  if (!target) {
    target = path.join(root, folderName(conv))
    try {
      await fs.lstat(target)
      // 同一时间、标题和末八位碰撞时不覆盖另一会话。
      target = path.join(root, folderName(conv).replace(/_[^_]*$/, '') + '_' +
        createHash('sha256').update(conv.session_id).digest('hex').slice(0, 8))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  await ensureDirectory(target)
  const previous = await readExistingMeta(target)
  if (previous && previous.sessionId !== conv.session_id) throw new Error('归档目录已属于另一会话')
  const sourceHash = await digest(input.transcript_path)
  if (previous && (previous as unknown as Record<string, unknown>).sourceSha256 === sourceHash) {
    const complete = await Promise.all(FILES.map((name) => fs.lstat(path.join(target!, name))
      .then((s) => s.isFile()).catch(() => false)))
    if (complete.every(Boolean) && await digest(path.join(target, engine.TRANSCRIPT_NAME)) === sourceHash) {
      return {
        status: 'unchanged',
        dir: target,
        ...(sourceClient === 'codex' ? { sourceClient: 'codex' as const } : {})
      }
    }
  }
  if (previous?.title) conv.title = previous.title
  const revisedAt = nowIso()
  const texts = engine.textArtifacts(conv)
  texts[engine.MD_NAME] = `---\nauthor: ${AUTHOR}\nlast_modified_by: ${AUTHOR}\nrevised_at: "${revisedAt}"\n---\n\n` + texts[engine.MD_NAME]
  texts[engine.HTML_NAME] = texts[engine.HTML_NAME].replace('<head>',
    `<head>\n<meta name="author" content="${AUTHOR}">\n<meta name="last-modified-by" content="${AUTHOR}">\n<meta name="revised-at" content="${revisedAt}">`)
  texts[engine.JS_NAME] = `// 作者：${AUTHOR}；修订时间：${revisedAt}\n` + texts[engine.JS_NAME]
  const result = writeExport(conv, texts, target, input.transcript_path, false, previous?.titleSource ?? 'local')
  // 原始转录保持字节不变；校验复制结果，避免仅生成正文却缺失原始记录。
  if (await digest(path.join(target, engine.TRANSCRIPT_NAME)) !== sourceHash) {
    throw new Error('转录在导出期间变化，请重新导出该会话')
  }
  const meta = { ...result.meta, author: AUTHOR, creator: AUTHOR, lastModifiedBy: AUTHOR,
    exportedAt: revisedAt, revisedAt, sourceSha256: sourceHash, projectDir: path.dirname(root),
    ...(sourceClient === 'codex' ? { sourceClient: 'codex' as const } : {}) }
  const tmp = path.join(target, `.meta.${process.pid}.tmp`)
  await fs.writeFile(tmp, JSON.stringify(meta, null, 2) + '\n', { mode: 0o600 })
  await fs.rename(tmp, path.join(target, engine.META_NAME))
  return {
    status: 'written',
    dir: target,
    ...(sourceClient === 'codex' ? { sourceClient: 'codex' as const } : {})
  }
}
