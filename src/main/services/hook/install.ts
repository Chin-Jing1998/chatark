import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
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

async function readSettings(): Promise<Settings | null> {
  try {
    return JSON.parse(await fs.readFile(SETTINGS, 'utf8')) as Settings
  } catch {
    return null
  }
}

let tmpCounter = 0
async function atomicWrite(data: Settings): Promise<void> {
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

async function backup(): Promise<void> {
  try {
    await fs.copyFile(SETTINGS, `${SETTINGS}.bak-${Date.now()}`)
  } catch {
    /* 首次无文件时忽略 */
  }
}

export async function hookStatus(): Promise<HookStatus> {
  const s = await readSettings()
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
    const settings = (await readSettings()) ?? {}
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
      hooks: [{ type: 'command', command: appCommand(), timeout: 20, async: true }]
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
    const settings = await readSettings()
    if (!settings) return fail('NOT_FOUND', '未找到 settings.json')
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
