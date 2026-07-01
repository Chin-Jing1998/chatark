/**
 * 会话定位：cwd 正向编码、列表、活跃会话排除、轻量信息提取。
 *
 * 自 chat_export/session_locator.py 移植相关函数。枚举 ~/.claude/projects/* / *.jsonl，
 * 活跃会话取自 ~/.claude/sessions/*.json 的 busy/近 180s 窗口。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

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
}

async function safeMtimeMs(p: string): Promise<number> {
  try {
    return (await fs.stat(p)).mtimeMs
  } catch {
    return 0
  }
}

/** 枚举所有 projects 子目录下的 *.jsonl，按文件名取 sessionId。 */
export async function listSessions(): Promise<SessionEntry[]> {
  const out: SessionEntry[] = []
  let dirs: string[]
  try {
    dirs = await fs.readdir(paths.PROJECTS_ROOT)
  } catch {
    return out
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
      out.push({
        sessionId: f.slice(0, -'.jsonl'.length),
        path: full,
        mtimeMs: await safeMtimeMs(full)
      })
    }
  }
  return out
}

export interface QuickInfo {
  sessionId: string
  cwd: string
  title: string
  turns: number
  mtimeMs: number
}

/** 按码点切片到 maxLen（对齐 Python first_prompt[:40]）。 */
function sliceCodepoints(s: string, max: number): string {
  const arr = Array.from(s)
  return arr.length <= max ? s : arr.slice(0, max).join('')
}

/** 轻量扫描一个 jsonl，取 sessionId / cwd / 标题 / 回合数。 */
export async function quickInfo(jsonlPath: string): Promise<QuickInfo> {
  let sid = ''
  let cwd = ''
  let title = ''
  let users = 0
  let assistants = 0
  let firstPrompt = ''
  try {
    const text = await fs.readFile(jsonlPath, 'utf-8')
    for (const rawLine of text.split(/\r\n|\r|\n/)) {
      const line = rawLine.trim()
      if (!line) continue
      let o: Record<string, unknown>
      try {
        const parsed = JSON.parse(line)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
        o = parsed as Record<string, unknown>
      } catch {
        continue
      }
      if (!sid && o['sessionId']) sid = String(o['sessionId'])
      if (!cwd && o['cwd']) cwd = String(o['cwd'])
      if (o['type'] === 'custom-title' && o['customTitle']) title = String(o['customTitle'])
      if (o['isMeta'] || o['isSidechain']) continue
      const t = o['type']
      if (t === 'user' || t === 'assistant') {
        const msg = o['message']
        const content =
          msg && typeof msg === 'object' && !Array.isArray(msg)
            ? (msg as Record<string, unknown>)['content']
            : undefined
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
  const stem = path.basename(jsonlPath).replace(/\.jsonl$/, '')
  return {
    sessionId: sid || stem,
    cwd,
    title: title || firstPrompt || '(未命名)',
    turns: users + assistants,
    mtimeMs: await safeMtimeMs(jsonlPath)
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
