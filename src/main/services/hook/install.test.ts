import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

// install.ts 在模块加载时就据 homedir() 定下 SETTINGS 路径，故 mock 必须在导入之前生效。
const fakeHome = vi.hoisted(() => ({ dir: '' }))
vi.mock('node:os', async (orig) => {
  const actual = await orig<typeof import('node:os')>()
  return { ...actual, default: { ...actual, homedir: () => fakeHome.dir }, homedir: () => fakeHome.dir }
})
// app 的返回值需按用例切换（appPath 决定无头入口是否存在），故用可变对象承载。
const fakeApp = vi.hoisted(() => ({ isPackaged: true, appPath: '', userData: '/ud dir' }))
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return fakeApp.isPackaged
    },
    getAppPath: () => fakeApp.appPath,
    getPath: (name: string) => (name === 'userData' ? fakeApp.userData : '/home')
  }
}))

fakeHome.dir = await fs.mkdtemp(join(tmpdir(), 'chatark-hook-home-'))
// 打包后 appPath 为 …/Resources/app.asar；这里用真实临时目录，以便切换无头入口的存在与否
const appRoot = await fs.mkdtemp(join(tmpdir(), 'chatark-hook-app-'))
fakeApp.appPath = join(appRoot, 'app.asar')
const headlessJs = join(fakeApp.appPath, 'out', 'main', 'headless.js')
await fs.mkdir(dirname(headlessJs), { recursive: true })
await fs.writeFile(headlessJs, '// stub', 'utf8')

const { installHook, uninstallHook, hookStatus, appCommand, buildHookCommand } =
  await import('./install')
const { autoExportLogPath } = await import('../app-paths')

const settingsPath = (): string => join(fakeHome.dir, '.claude', 'settings.json')

/** 在指定 process.platform 下执行 fn，结束后无条件恢复，避免污染后续用例。 */
async function withPlatform<T>(platform: string, fn: () => Promise<T> | T): Promise<T> {
  const original = process.platform
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    return await fn()
  } finally {
    Object.defineProperty(process, 'platform', { value: original, configurable: true })
  }
}

/** settings.json 里我方 SessionEnd 条目内、带 --export-stdin 的那些 hook。 */
async function readOurHooks(): Promise<
  Array<{ type: string; command?: string; timeout?: number; async?: boolean }>
> {
  const after = JSON.parse(await fs.readFile(settingsPath(), 'utf8'))
  const entries = (after.hooks?.SessionEnd ?? []) as Array<{
    hooks?: Array<{ type: string; command?: string; timeout?: number; async?: boolean }>
  }>
  return entries
    .flatMap((e) => e.hooks ?? [])
    .filter((h) => (h.command ?? '').includes('--export-stdin'))
}

/** 用户机器上的旧版条目：Electron 图形模式命令 + timeout 20 + async。 */
const LEGACY_ENTRY = {
  matcher: '',
  hooks: [
    { type: 'command', command: '"/x/ChatArk" --export-stdin', timeout: 20, async: true }
  ]
}
/** 他人条目：不含我方标识，任何情况下都必须原样保留。 */
const FOREIGN_ENTRY = {
  matcher: '',
  hooks: [{ type: 'command', command: 'echo other', timeout: 5 }]
}

async function writeSettings(raw: string): Promise<void> {
  await fs.mkdir(join(fakeHome.dir, '.claude'), { recursive: true })
  await fs.writeFile(settingsPath(), raw, 'utf8')
}

beforeEach(async () => {
  await fs.rm(join(fakeHome.dir, '.claude'), { recursive: true, force: true })
})
afterEach(async () => {
  await fs.rm(join(fakeHome.dir, '.claude'), { recursive: true, force: true })
  fakeApp.isPackaged = true
  fakeApp.appPath = join(appRoot, 'app.asar')
  fakeApp.userData = '/ud dir'
})

describe('settings.json 写入安全', () => {
  it('解析失败时拒绝写入，原文件一字不改', async () => {
    const broken = '{ "permissions": { "allow": ["Bash"] },, }' // 多一个逗号
    await writeSettings(broken)

    const r = await installHook(false)

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('PARSE_ERROR')
    expect(await fs.readFile(settingsPath(), 'utf8')).toBe(broken)
  })

  it('顶层是数组等非对象 JSON 也算损坏，不覆盖', async () => {
    await writeSettings('["not", "an", "object"]')
    const r = await installHook(false)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('PARSE_ERROR')
    expect(await fs.readFile(settingsPath(), 'utf8')).toBe('["not", "an", "object"]')
  })

  it('卸载遇到损坏文件同样拒绝写入', async () => {
    await writeSettings('{ broken')
    const r = await uninstallHook()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('PARSE_ERROR')
    expect(await fs.readFile(settingsPath(), 'utf8')).toBe('{ broken')
  })

  it('正常安装保留既有配置，只增补 SessionEnd 钩子', async () => {
    await writeSettings(
      JSON.stringify({ permissions: { allow: ['Bash'] }, env: { FOO: 'bar' } }, null, 2)
    )

    const r = await installHook(false)

    expect(r.ok).toBe(true)
    const after = JSON.parse(await fs.readFile(settingsPath(), 'utf8'))
    expect(after.permissions).toEqual({ allow: ['Bash'] }) // 既有配置未被吞掉
    expect(after.env).toEqual({ FOO: 'bar' })
    expect(after.hooks.SessionEnd).toHaveLength(1)
    expect(await hookStatus()).toMatchObject({ installed: true })
  })

  it('文件不存在时可正常安装（absent 与 corrupt 区分对待）', async () => {
    const r = await installHook(false)
    expect(r.ok).toBe(true)
    const after = JSON.parse(await fs.readFile(settingsPath(), 'utf8'))
    expect(after.hooks.SessionEnd).toHaveLength(1)
  })

  it('反复开关只保留最近 5 个备份', async () => {
    await writeSettings(JSON.stringify({ env: {} }))
    for (let i = 0; i < 8; i++) {
      await installHook(false)
      await uninstallHook()
    }
    const baks = (await fs.readdir(join(fakeHome.dir, '.claude'))).filter((n) =>
      n.startsWith('settings.json.bak-')
    )
    expect(baks.length).toBeLessThanOrEqual(5)
  })
})

describe('钩子命令按平台生成', () => {
  it('macOS 写入 run-as-node 无头命令，同步执行且 timeout 为 10', async () => {
    await withPlatform('darwin', () => installHook(false))

    const ours = await readOurHooks()
    expect(ours).toHaveLength(1)
    const [h] = ours
    expect(h.command).toContain('[ -n "$CHATARK_TITLEGEN" ] ||')
    expect(h.command).toContain('ELECTRON_RUN_AS_NODE=1')
    expect(h.command).toContain(`"${join(fakeApp.appPath, 'out', 'main', 'headless.js')}"`)
    expect(h.command).toContain('--export-stdin --user-data "/ud dir"')
    expect(h.timeout).toBe(10)
    expect(h).not.toHaveProperty('async') // 同步钩子：async 会让 Claude Code 不等待也不记录退出码
  })

  it('Windows 命令不含任何 shell 语法与内联环境变量', async () => {
    const cmd = await withPlatform('win32', () => appCommand())

    expect(cmd).not.toContain('[ -n')
    expect(cmd).not.toContain('||')
    expect(cmd).not.toContain('ELECTRON_RUN_AS_NODE')
    expect(cmd).toContain('--export-stdin --user-data "/ud dir"')
    expect(cmd.startsWith('"')).toBe(true)
  })

  it('Linux 存在 APPIMAGE 时写 AppImage 自身路径而非临时挂载点的 execPath', () => {
    const cmd = appCommand('linux', { APPIMAGE: '/home/u/ChatArk.AppImage' })

    expect(cmd).toContain('"/home/u/ChatArk.AppImage" --export-stdin --user-data "/ud dir"')
    expect(cmd).not.toContain(process.execPath)
    expect(cmd.startsWith('[ -n "$CHATARK_TITLEGEN" ] ||')).toBe(true)
  })

  it('darwin 命令对路径里的 $ 与双引号做 sh 转义，不被 shell 二次解释', () => {
    const cmd = buildHookCommand({
      platform: 'darwin',
      execPath: '/A/ChatArk',
      appPath: '/A/app.asar',
      userData: '/ud/$USER 备份/say "hi"'
    })

    expect(cmd).toContain('--user-data "/ud/\\$USER 备份/say \\"hi\\""')
    expect(cmd).not.toContain('"/ud/$USER') // 未转义的 $USER 会被 sh 替换成别的目录
  })

  it('win32 命令不做反斜杠转义（cmd.exe 无此规则，转了反而写错路径）', () => {
    const cmd = buildHookCommand({
      platform: 'win32',
      execPath: 'C:\\Program Files\\ChatArk\\ChatArk.exe',
      appPath: 'C:\\Program Files\\ChatArk\\resources\\app.asar',
      userData: 'C:\\Users\\me\\AppData\\Roaming\\chatark'
    })

    expect(cmd).toBe(
      '"C:\\Program Files\\ChatArk\\ChatArk.exe" --export-stdin --user-data ' +
        '"C:\\Users\\me\\AppData\\Roaming\\chatark"'
    )
  })

  it('Linux 无 APPIMAGE 时回落到 execPath', () => {
    const cmd = buildHookCommand({
      platform: 'linux',
      execPath: '/opt/chatark/chatark',
      appPath: '/opt/chatark/resources/app.asar',
      userData: '/home/u/.config/chatark'
    })

    expect(cmd).toBe(
      '[ -n "$CHATARK_TITLEGEN" ] || "/opt/chatark/chatark" --export-stdin --user-data "/home/u/.config/chatark"'
    )
  })
})

describe('旧版钩子检测与更新', () => {
  it('旧条目判定为需更新，安装后归位且他人条目原样保留', async () => {
    await writeSettings(
      JSON.stringify({ hooks: { SessionEnd: [FOREIGN_ENTRY, LEGACY_ENTRY] } }, null, 2)
    )

    const before = await hookStatus()
    expect(before).toMatchObject({ installed: true, needsUpdate: true })

    const r = await withPlatform('darwin', () => installHook(false))
    expect(r.ok).toBe(true)

    const after = await hookStatus()
    expect(after.needsUpdate).toBe(false)
    expect(await readOurHooks()).toHaveLength(1) // 旧条目被整体替换，不叠加
    const entries = JSON.parse(await fs.readFile(settingsPath(), 'utf8')).hooks.SessionEnd
    expect(entries[0]).toEqual(FOREIGN_ENTRY)
  })

  it('刚安装的条目不报需更新', async () => {
    await withPlatform('darwin', () => installHook(false))
    expect((await hookStatus()).needsUpdate).toBe(false)
  })

  it('未打包环境不报需更新（execPath 与 appPath 均不稳定）', async () => {
    await writeSettings(JSON.stringify({ hooks: { SessionEnd: [LEGACY_ENTRY] } }, null, 2))
    fakeApp.isPackaged = false

    expect(await hookStatus()).toMatchObject({ installed: true, needsUpdate: false })
  })
})

describe('settings.json 原子写的权限保全', () => {
  it('原文件为 0600 时安装后权限不变，不被放宽到默认值', async () => {
    await writeSettings(JSON.stringify({ env: { FOO: 'bar' } }, null, 2))
    await fs.chmod(settingsPath(), 0o600)

    const r = await withPlatform('darwin', () => installHook(false))

    expect(r.ok).toBe(true)
    const st = await fs.stat(settingsPath())
    expect(st.mode & 0o777).toBe(0o600)
    // 内容正常写入且原配置保留
    const after = JSON.parse(await fs.readFile(settingsPath(), 'utf8'))
    expect(after.env).toEqual({ FOO: 'bar' })
    expect(after.hooks.SessionEnd).toHaveLength(1)
  })

  it('文件不存在时新建为 0600（内含敏感配置，不给同组与其他人读）', async () => {
    const r = await withPlatform('darwin', () => installHook(false))

    expect(r.ok).toBe(true)
    expect((await fs.stat(settingsPath())).mode & 0o777).toBe(0o600)
  })
})

describe('无头入口缺失的保护', () => {
  it('macOS 下 headless.js 不存在时拒绝安装且不写 settings.json', async () => {
    const raw = JSON.stringify({ env: { FOO: 'bar' } }, null, 2)
    await writeSettings(raw)
    fakeApp.appPath = await fs.mkdtemp(join(tmpdir(), 'chatark-hook-empty-'))

    const r = await withPlatform('darwin', () => installHook(false))

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('NOT_FOUND')
    expect(await fs.readFile(settingsPath(), 'utf8')).toBe(raw)
  })
})

describe('诊断日志路径', () => {
  it('logPath 取自 userData，logExists 随文件存在与否变化', async () => {
    const ud = await fs.mkdtemp(join(tmpdir(), 'chatark-hook-ud-'))
    fakeApp.userData = ud
    const expected = autoExportLogPath(ud)

    const before = await hookStatus()
    expect(before.logPath).toBe(expected)
    expect(before.logExists).toBe(false)

    await fs.mkdir(dirname(expected), { recursive: true })
    await fs.writeFile(expected, 'log', 'utf8')

    expect((await hookStatus()).logExists).toBe(true)
  })
})
