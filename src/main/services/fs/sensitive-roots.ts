/**
 * 「过宽根目录」判定：这些路径要么是用户数据的总入口（home / Documents），要么是系统目录，
 * 作为库根会让迁移删源波及无关数据，作为文件预览根会让白名单形同虚设。
 *
 * 两处共用：
 *  - 库根护栏（ipc/library.ipc.ts）：拒绝把库根设成这些目录本身；
 *  - 文件预览白名单（services/library.ts 的 allowedFileRoots）：过滤掉过宽的对话 cwd。
 *
 * 判定为**精确匹配**而非前缀匹配 —— `~/Documents/ChatArk库` 是合理的库根，
 * 被拒的只有 `~/Documents` 本身。
 */
import { homedir } from 'node:os'
import { join, parse, resolve, sep } from 'node:path'

/** 规范化：去尾部分隔符、解析 `.`/`..`，供精确比较。 */
function norm(p: string): string {
  return resolve(p)
}

/**
 * 过宽根目录集合（随平台变化，故每次计算而非模块级常量 —— 便于测试注入不同 HOME）。
 */
function dangerousRoots(): string[] {
  const home = homedir()
  const list = [
    home,
    // 用户数据总入口：作为库根会让删源波及全部个人文件
    join(home, 'Desktop'),
    join(home, 'Documents'),
    join(home, 'Downloads'),
    join(home, 'Movies'),
    join(home, 'Music'),
    join(home, 'Pictures'),
    join(home, 'Public'),
    join(home, 'Library'), // macOS
    join(home, 'AppData'), // Windows
    join(home, '.config'),
    // Claude Code 自身的数据目录：既是转录源，也含凭据配置
    join(home, '.claude')
  ]

  if (process.platform === 'darwin') {
    list.push('/Applications', '/Library', '/System', '/Users', '/Volumes')
  } else if (process.platform === 'win32') {
    list.push('C:\\Users', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\Windows')
  } else {
    list.push('/home', '/etc', '/usr', '/var', '/opt', '/srv', '/mnt', '/media')
  }

  return list.map(norm)
}

/**
 * 判断路径是否为「过宽根目录」：卷根本身，或落在上述清单内。
 * @param p 绝对路径
 */
export function isDangerousRoot(p: string): boolean {
  if (!p) return true
  const target = norm(p)
  // 卷根（`/`、`C:\`）一律拒绝
  if (target === parse(target).root) return true
  return dangerousRoots().includes(target)
}

/**
 * b 是否落在 a 之内（含 a 自身）。与 fs/move.ts 的路径穿越校验同一套写法。
 */
export function isWithin(a: string, b: string): boolean {
  const base = norm(a)
  const target = norm(b)
  if (target === base) return true
  return target.startsWith(base.endsWith(sep) ? base : base + sep)
}
