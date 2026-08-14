import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fail, ok, type HookStatus, type OpResult } from '@shared/types'

export type { HookStatus }

const SETTINGS = join(homedir(), '.claude', 'settings.json')
const OUR_MARKER = '--export-stdin' // 本应用钩子命令的标识子串
const PY_MARKER = 'chat_export' // 旧 Python 版钩子的标识子串

interface HookEntry {
  matcher?: string
  hooks?: Array<{ type: string; command?: string; timeout?: number; async?: boolean }>
}
interface Settings {
  hooks?: Record<string, HookEntry[]>
  [k: string]: unknown
}

/** 本应用无界面导出命令：调用自身可执行文件 + --export-stdin。 */
function appCommand(): string {
  return `"${process.execPath}" --export-stdin`
}

function entryHasMarker(entry: HookEntry, marker: string): boolean {
  return (entry.hooks ?? []).some((h) => (h.command ?? '').includes(marker))
}

/**
 * 读取结果必须区分「文件不存在」与「解析失败」：
 * 二者混为 null 再 `?? {}` 兜底，会在 settings.json 有语法错误时以空对象覆盖，
 * 把用户全部 Claude Code 配置（permissions / env / statusLine / 其他 hooks）清空。
 */
type ReadResult =
  | { kind: 'ok'; settings: Settings }
  | { kind: 'absent' }
  | { kind: 'corrupt'; error: string }

async function readSettings(): Promise<ReadResult> {
  let raw: string
  try {
    raw = await fs.readFile(SETTINGS, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' }
    return { kind: 'corrupt', error: e instanceof Error ? e.message : String(e) }
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { kind: 'corrupt', error: '顶层不是 JSON 对象' }
    }
    return { kind: 'ok', settings: parsed as Settings }
  } catch (e) {
    return { kind: 'corrupt', error: e instanceof Error ? e.message : String(e) }
  }
}

/** 解析失败时给用户的统一说明——绝不代为覆盖，交由用户自行修复。 */
function corruptFail(error: string): OpResult<never> {
  return fail(
    'PARSE_ERROR',
    `~/.claude/settings.json 解析失败（${error}）。为避免覆盖你的 Claude Code 配置，本次未做任何写入。请先修复该文件再重试。`,
    true
  )
}

let tmpCounter = 0
async function atomicWrite(data: Settings): Promise<void> {
  // ~/.claude 可能尚不存在（全新环境）：不先建目录则 .tmp 写入直接 ENOENT
  await fs.mkdir(dirname(SETTINGS), { recursive: true })
  const tmp = `${SETTINGS}.${process.pid}.${Date.now()}.${tmpCounter++}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmp, SETTINGS)
}

// 模块级串行队列：把 install/uninstall 的整个 read-modify-write 串行化，
// 避免并发 IPC 交错导致写入错误内容或 .tmp 竞争。
let opQueue: Promise<unknown> = Promise.resolve()
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = opQueue.then(fn, fn)
  opQueue = run.catch(() => undefined)
  return run
}

/** 本应用备份文件名前缀（清理时据此识别，不碰其他工具的备份）。 */
const BAK_PREFIX = `${basename(SETTINGS)}.bak-`
/** 保留的备份数量上限：每次开关自动导出都会备份，不封顶会在 ~/.claude 里无限堆积。 */
const MAX_BACKUPS = 5

async function backup(): Promise<void> {
  try {
    await fs.copyFile(SETTINGS, `${SETTINGS}.bak-${Date.now()}`)
  } catch {
    /* 首次无文件时忽略 */
  }
  await pruneBackups()
}

/** 只保留最近 MAX_BACKUPS 个备份，其余删除。 */
async function pruneBackups(): Promise<void> {
  try {
    const dir = dirname(SETTINGS)
    const names = (await fs.readdir(dir)).filter((n) => n.startsWith(BAK_PREFIX))
    if (names.length <= MAX_BACKUPS) return
    // 名字尾部是毫秒时间戳，字典序即时间序（位数一致）；降序后删除超出上限的旧备份
    const stale = names.sort((a, b) => b.localeCompare(a)).slice(MAX_BACKUPS)
    for (const n of stale) await fs.rm(join(dir, n), { force: true }).catch(() => undefined)
  } catch {
    /* 清理失败不影响主流程 */
  }
}

/**
 * 清理本应用遗留的原子写临时文件（进程在 rename 前崩溃会留下）。
 * 仅匹配自身命名模式且超过 1 小时的，避免误删正在进行的写入。
 */
export async function pruneStaleTmp(): Promise<void> {
  try {
    const dir = dirname(SETTINGS)
    const prefix = `${basename(SETTINGS)}.`
    const cutoff = Date.now() - 60 * 60 * 1000
    for (const n of await fs.readdir(dir)) {
      if (!n.startsWith(prefix) || !n.endsWith('.tmp')) continue
      const p = join(dir, n)
      const st = await fs.stat(p).catch(() => null)
      if (st && st.mtimeMs < cutoff) await fs.rm(p, { force: true }).catch(() => undefined)
    }
  } catch {
    /* 清理失败不影响启动 */
  }
}

export async function hookStatus(): Promise<HookStatus> {
  const res = await readSettings()
  const s = res.kind === 'ok' ? res.settings : null
  const arr = s?.hooks?.SessionEnd ?? []
  return {
    installed: arr.some((e) => entryHasMarker(e, OUR_MARKER)),
    pythonHookPresent: Object.values(s?.hooks ?? {})
      .flat()
      .some((e) => entryHasMarker(e, PY_MARKER))
  }
}

/** 安装 SessionEnd 自动导出钩子（幂等）；replacePython=true 时同时移除旧 Python 钩子。 */
export function installHook(replacePython = false): Promise<OpResult<HookStatus>> {
  return serialize(async () => {
    if (!app.isPackaged) {
      return fail(
        'INVALID_INPUT',
        '自动导出钩子需在已打包的应用中安装（开发模式的可执行路径不稳定）',
        true
      )
    }
    const res = await readSettings()
    if (res.kind === 'corrupt') return corruptFail(res.error)
    const settings: Settings = res.kind === 'ok' ? res.settings : {}
    await backup()

    const hooks = (settings.hooks ??= {})
    let sessionEnd = (hooks.SessionEnd ??= [])
    // 去除本应用旧条目；可选去除 Python 条目
    sessionEnd = sessionEnd.filter((e) => !entryHasMarker(e, OUR_MARKER))
    if (replacePython) {
      for (const ev of Object.keys(hooks)) {
        hooks[ev] = hooks[ev].filter((e) => !entryHasMarker(e, PY_MARKER))
      }
      sessionEnd = (hooks.SessionEnd ?? []).filter((e) => !entryHasMarker(e, OUR_MARKER))
    }
    sessionEnd.push({
      matcher: '',
      // 60s：SessionEnd 自动导出含 LLM 标题生成（15s 上限）+ Electron 启动，20s 会在落盘中途被杀
      hooks: [{ type: 'command', command: appCommand(), timeout: 60, async: true }]
    })
    hooks.SessionEnd = sessionEnd

    try {
      await atomicWrite(settings)
    } catch (e) {
      return fail('IO_ERROR', `写入 settings.json 失败：${e instanceof Error ? e.message : e}`)
    }
    return ok(await hookStatus())
  })
}

/** 卸载本应用的 SessionEnd 自动导出钩子。 */
export function uninstallHook(): Promise<OpResult<HookStatus>> {
  return serialize(async () => {
    const res = await readSettings()
    if (res.kind === 'corrupt') return corruptFail(res.error)
    if (res.kind === 'absent') return fail('NOT_FOUND', '未找到 settings.json')
    const settings = res.settings
    await backup()
    for (const ev of Object.keys(settings.hooks ?? {})) {
      settings.hooks![ev] = settings.hooks![ev].filter((e) => !entryHasMarker(e, OUR_MARKER))
    }
    try {
      await atomicWrite(settings)
    } catch (e) {
      return fail('IO_ERROR', `写入 settings.json 失败：${e instanceof Error ? e.message : e}`)
    }
    return ok(await hookStatus())
  })
}
