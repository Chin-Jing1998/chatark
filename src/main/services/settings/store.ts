import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { DEFAULT_LIBRARY_REL } from '@shared/constants'

interface AppConfig {
  historyRoot?: string
}

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

function defaultLibraryRoot(): string {
  return join(app.getPath('home'), ...DEFAULT_LIBRARY_REL)
}

function readConfig(): AppConfig {
  try {
    const p = configPath()
    if (!existsSync(p)) return {}
    return JSON.parse(readFileSync(p, 'utf8')) as AppConfig
  } catch {
    return {}
  }
}

function writeConfig(cfg: AppConfig): void {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8')
}

/** 当前历史库根：配置值优先，否则回退默认路径。 */
export function getLibraryRoot(): string {
  return readConfig().historyRoot ?? defaultLibraryRoot()
}

/** 更新历史库根（M8 迁移流程使用） */
export function setLibraryRoot(root: string): void {
  const cfg = readConfig()
  writeConfig({ ...cfg, historyRoot: root })
}
