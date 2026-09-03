import { homedir } from 'node:os'
import { join } from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'
import { DEFAULT_LIBRARY_REL } from '@shared/constants'
import { defaultUserDataDir } from '../services/app-paths'

/**
 * 真实库组测试共用的库根解析。
 * 与应用运行时 settings/store.ts 的 getLibraryRoot 同一语义（配置优先、回退默认）；
 * userData 路径取平台默认值，不受测试用 CHATARK_USER_DATA 覆盖影响。
 */

/** 读应用 config.json 里的 historyRoot；不存在或损坏返回 null。 */
function appConfigHistoryRoot(): string | null {
  try {
    const raw = readFileSync(join(defaultUserDataDir(), 'config.json'), 'utf8')
    const root = (JSON.parse(raw) as { historyRoot?: unknown }).historyRoot
    return typeof root === 'string' && root.length > 0 ? root : null
  } catch {
    return null
  }
}

/** 目录存在且含非隐藏条目才算可用——空目录（仅 .DS_Store 等）视同无库。 */
function usable(root: string): boolean {
  try {
    return readdirSync(root).some((name) => !name.startsWith('.'))
  } catch {
    return false
  }
}

/**
 * 解析测试用库根：CHATARK_TEST_LIBRARY > 应用配置 historyRoot > 默认路径。
 * 显式指定的环境变量不可用时不回退——静默换库会让人测错对象；
 * 全部不可用返回 null，调用方以此跳过整组真实库测试。
 */
export function resolveTestLibraryRoot(): string | null {
  const env = process.env.CHATARK_TEST_LIBRARY
  if (env) return usable(env) ? env : null
  for (const c of [appConfigHistoryRoot(), join(homedir(), ...DEFAULT_LIBRARY_REL)]) {
    if (c && usable(c)) return c
  }
  return null
}
