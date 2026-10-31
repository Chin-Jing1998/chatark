/**
 * 会话定位：cwd 正向编码、列表、活跃会话排除、轻量信息提取。
 *
 * 自 chat_export/session_locator.py 移植相关函数。枚举 ~/.claude/projects/* / *.jsonl，
 * 活跃会话取自 ~/.claude/sessions/*.json 的 busy/近 180s 窗口。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { extractCodexSessionIdFromFilename } from './codex'
import { parseText } from './jsonl-parser'
import * as paths from './paths'
import * as textutil from './textutil'

/** cwd → projects 子目录名（非字母数字一律转连字符）。 */
export function encodeCwd(cwd: string): string {
  return (cwd || '').replace(/[^A-Za-z0-9]/g, '-')
}

export interface SessionEntry {
  sessionId: string
  path: string
  cwd?: string
  mtimeMs: number
  source?: 'claude' | 'codex'
}

async function safeMtimeMs(p: string): Promise<number> {
  try {
    return (await fs.stat(p)).mtimeMs
  } catch {
    return 0
  }
}

/** 递归收集指定根目录下的 *.jsonl 文件（限深防环）。 */
async function collectJsonlFiles(root: string, maxDepth = 4): Promise<string[]> {
  const files: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries: Array<import('node:fs').Dirent>
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (depth < maxDepth) await walk(full, depth + 1)
      } else if (ent.isFile() && ent.name.endsWith('.jsonl')) {
        files.push(full)
      }
    }
  }
  await walk(root, 0)
  return files
}

/** 枚举 Claude Code（~/.claude/projects）与 Codex（~/.codex/sessions 及 archived_sessions）下的所有会话。 */
export async function listSessions(): Promise<SessionEntry[]> {
  const byId = new Map<string, SessionEntry>()
  const upsert = (entry: SessionEntry): void => {
    const prev = byId.get(entry.sessionId)
    if (!prev || entry.mtimeMs >= prev.mtimeMs) {
      byId.set(entry.sessionId, entry)
    }
  }

  // 1. Claude Code 会话：~/.claude/projects/*/*.jsonl
  let dirs: string[]
  try {
    dirs = await fs.readdir(paths.PROJECTS_ROOT)
  } catch {
    dirs = []
  }
  for (const d of dirs) {
    const sub = path.join(paths.PROJECTS_ROOT, d)
    let files: string[]
    try {
      const st = await fs.stat(sub)
      if (!st.isDirectory()) continue
      files = await fs.readdir(sub)
    } catch {
      continue
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const full = path.join(sub, f)
      upsert({
        sessionId: f.slice(0, -'.jsonl'.length),
        path: full,
        mtimeMs: await safeMtimeMs(full),
        source: 'claude'
      })
    }
  }

  // 2. Codex 会话：~/.codex/sessions/YYYY/MM/DD/*.jsonl 与 ~/.codex/archived_sessions/*.jsonl
  const [codexActive, codexArchived] = await Promise.all([
    collectJsonlFiles(paths.CODEX_SESSIONS_ROOT, 4),
    collectJsonlFiles(paths.CODEX_ARCHIVED_ROOT, 1)
  ])
  for (const full of [...codexArchived, ...codexActive]) {
    upsert({
      sessionId: extractCodexSessionIdFromFilename(full),
      path: full,
      mtimeMs: await safeMtimeMs(full),
      source: 'codex'
    })
  }

  return [...byId.values()]
}

export interface QuickInfo {
  sessionId: string
  cwd: string
  title: string
  turns: number
  model: string | null
  mtimeMs: number
  source?: 'claude' | 'codex'
}

/** 按码点切片到 maxLen（对齐 Python first_prompt[:40]）。 */
function sliceCodepoints(s: string, max: number): string {
  const arr = Array.from(s)
  return arr.length <= max ? s : arr.slice(0, max).join('')
}

/** 轻量扫描一个 jsonl（兼容 Claude Code 与 Codex rollout），取 sessionId / cwd / 标题 / 回合数 / 主导模型。 */
export async function quickInfo(jsonlPath: string): Promise<QuickInfo> {
  let sid = ''
  let cwd = ''
  let title = ''
  let users = 0
  let assistants = 0
  let firstPrompt = ''
  let source: 'claude' | 'codex' = 'claude'
  const modelCounts = new Map<string, number>()
  const modelOrder: string[] = []
  try {
    const text = await fs.readFile(jsonlPath, 'utf-8')
    const parsed = parseText(text, jsonlPath)
    source = parsed.sourceClient ?? 'claude'
    for (const o of parsed.records) {
      if (!sid && o['sessionId']) sid = String(o['sessionId'])
      if (!cwd && o['cwd']) cwd = String(o['cwd'])
      if (o['type'] === 'custom-title' && o['customTitle']) title = String(o['customTitle'])
      if (o['isMeta'] || o['isSidechain']) continue
      const t = o['type']
      if (t === 'user' || t === 'assistant') {
        const msg = o['message']
        const m = msg && typeof msg === 'object' && !Array.isArray(msg) ? (msg as Record<string, unknown>) : null
        // 模型众数统计对所有 assistant 行生效（含噪声行），对齐 model.pickModel 语义
        if (t === 'assistant') {
          const mdl = m ? m['model'] : undefined
          if (mdl) {
            const key = String(mdl)
            if (!modelCounts.has(key)) modelOrder.push(key)
            modelCounts.set(key, (modelCounts.get(key) || 0) + 1)
          }
        }
        const content = m ? m['content'] : undefined
        const txt = textutil.extractText(content)
        if (!txt || textutil.isNoise(txt)) continue
        if (t === 'assistant') {
          assistants += 1
        } else {
          users += 1
          if (!firstPrompt) firstPrompt = sliceCodepoints(textutil.cleanInline(txt), 40)
        }
      }
    }
  } catch {
    // 读失败：返回尽力而为的占位
  }
  // 众数模型（排除 <synthetic>，并列取先出现者），对齐 model.pickModel 语义
  let model: string | null = null
  for (const key of [...modelOrder].sort((a, b) => (modelCounts.get(b) || 0) - (modelCounts.get(a) || 0))) {
    if (key !== '<synthetic>') {
      model = key
      break
    }
  }
  const fallbackSid = extractCodexSessionIdFromFilename(jsonlPath)
  return {
    sessionId: sid || fallbackSid,
    cwd,
    title: title || firstPrompt || '(未命名)',
    turns: users + assistants,
    model,
    mtimeMs: await safeMtimeMs(jsonlPath),
    source
  }
}

/** 从 ~/.claude/sessions/*.json 取 busy 或近期活跃的 sessionId。 */
export async function activeSessionIds(windowSec = 180): Promise<Set<string>> {
  const out = new Set<string>()
  const nowMs = Date.now()
  let files: string[]
  try {
    files = (await fs.readdir(paths.SESSIONS_ROOT)).filter((f) => f.endsWith('.json'))
  } catch {
    return out
  }
  for (const f of files) {
    const fp = path.join(paths.SESSIONS_ROOT, f)
    try {
      const m = JSON.parse(await fs.readFile(fp, 'utf-8')) as Record<string, unknown>
      const sid = m['sessionId']
      if (!sid) continue
      const status = String(m['status'] || '').toLowerCase()
      if (status === 'busy' || status === 'running' || status === 'active') {
        out.add(String(sid))
        continue
      }
      let updated = 0
      const raw = m['updatedAt']
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : 0
      updated = Number.isFinite(n) ? n : 0
      if (updated && nowMs - updated < windowSec * 1000) {
        out.add(String(sid))
      }
    } catch {
      continue
    }
  }
  return out
}
