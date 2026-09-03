/**
 * 应用数据目录解析（纯 Node，绝不 import electron）。
 *
 * 必要性：无头导出链路要能以纯 Node 运行（ELECTRON_RUN_AS_NODE），此时 `require('electron')`
 * 只返回字符串，`app.getPath('userData')` 不可用。本模块按平台规则复刻 Electron 的默认
 * userData 路径，使 GUI 与无头进程落在同一目录。
 *
 * 目录名固定小写 `chatark`：打包进 asar 的 package.json 无 productName，故 `app.name === 'chatark'`，
 * dev 与打包一致。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Electron app.name，同时是 userData 目录名。 */
const APP_DIR = 'chatark'

/** 命令行覆盖开关：`--user-data <dir>`。 */
const USER_DATA_FLAG = '--user-data'

/** 环境变量覆盖（测试与无头 worker 使用）。 */
const USER_DATA_ENV = 'CHATARK_USER_DATA'

/** 平台默认 userData 目录，与 Electron `app.getPath('userData')` 等价。 */
export function defaultUserDataDir(
  platform: string = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', APP_DIR)
  if (platform === 'win32') return join(env['APPDATA'] || join(home, 'AppData', 'Roaming'), APP_DIR)
  return join(env['XDG_CONFIG_HOME'] || join(home, '.config'), APP_DIR)
}

/**
 * 实际使用的 userData 目录：argv `--user-data <dir>` > env CHATARK_USER_DATA > 平台默认。
 * GUI 派生无头 worker 时显式传 argv，保证两端一致；env 供测试与手工排障覆盖。
 */
export function resolveUserDataDir(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): string {
  const i = argv.indexOf(USER_DATA_FLAG)
  const fromArgv = i >= 0 ? argv[i + 1] : undefined
  // 下一位又是选项即视为缺参（与 headless/cli 的 flagValue 同口径），
  // 否则 `--user-data --export-stdin` 会把标志本身当成目录名建出来
  if (fromArgv && !fromArgv.startsWith('--')) return fromArgv
  const fromEnv = env[USER_DATA_ENV]
  if (fromEnv) return fromEnv
  return defaultUserDataDir(process.platform, env)
}

/** 自动导出诊断日志路径。 */
export function autoExportLogPath(userData: string): string {
  return join(userData, 'logs', 'auto-export.log')
}

/** 进程间互斥锁目录（会话锁、titlegen 全局锁）。 */
export function locksDir(userData: string): string {
  return join(userData, 'locks')
}
