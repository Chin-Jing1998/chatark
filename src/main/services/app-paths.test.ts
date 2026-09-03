/**
 * userData 路径解析：三平台默认值须与 Electron `app.getPath('userData')` 一致
 * （目录名固定小写 chatark），覆盖优先级为 argv > env > 默认。纯函数，不碰磁盘。
 */
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { autoExportLogPath, defaultUserDataDir, locksDir, resolveUserDataDir } from './app-paths'

const HOME = '/home/tester'

describe('defaultUserDataDir', () => {
  it('darwin 落在 ~/Library/Application Support/chatark', () => {
    expect(defaultUserDataDir('darwin', {}, HOME)).toBe(join(HOME, 'Library', 'Application Support', 'chatark'))
  })

  it('win32 优先用 APPDATA，缺失时回退 ~/AppData/Roaming', () => {
    expect(defaultUserDataDir('win32', { APPDATA: 'D:\\Roaming' }, HOME)).toBe(join('D:\\Roaming', 'chatark'))
    expect(defaultUserDataDir('win32', {}, HOME)).toBe(join(HOME, 'AppData', 'Roaming', 'chatark'))
  })

  it('linux 优先用 XDG_CONFIG_HOME，缺失时回退 ~/.config', () => {
    expect(defaultUserDataDir('linux', { XDG_CONFIG_HOME: '/xdg' }, HOME)).toBe(join('/xdg', 'chatark'))
    expect(defaultUserDataDir('linux', {}, HOME)).toBe(join(HOME, '.config', 'chatark'))
  })

  it('未知平台按 linux 规则处理（AppImage 等衍生平台不至于落到根目录）', () => {
    expect(defaultUserDataDir('freebsd', {}, HOME)).toBe(join(HOME, '.config', 'chatark'))
  })
})

describe('resolveUserDataDir', () => {
  it('argv --user-data 优先于环境变量', () => {
    const argv = ['node', 'headless.js', '--export-stdin', '--user-data', '/tmp/from-argv']
    expect(resolveUserDataDir(argv, { CHATARK_USER_DATA: '/tmp/from-env' })).toBe('/tmp/from-argv')
  })

  it('无 argv 时用 CHATARK_USER_DATA', () => {
    expect(resolveUserDataDir(['node', 'headless.js'], { CHATARK_USER_DATA: '/tmp/from-env' })).toBe('/tmp/from-env')
  })

  it('--user-data 缺少取值时不吞掉后续参数，回退到环境变量', () => {
    expect(resolveUserDataDir(['node', 'x.js', '--user-data'], { CHATARK_USER_DATA: '/tmp/from-env' })).toBe(
      '/tmp/from-env'
    )
  })

  it('--user-data 的取值是另一个选项时同样视为缺参', () => {
    const argv = ['node', 'x.js', '--user-data', '--export-stdin']
    expect(resolveUserDataDir(argv, { CHATARK_USER_DATA: '/tmp/from-env' })).toBe('/tmp/from-env')
  })

  it('两者皆无时回退平台默认值', () => {
    const got = resolveUserDataDir(['node', 'x.js'], {})
    expect(got).toBe(defaultUserDataDir(process.platform, {}))
    expect(got.endsWith('chatark')).toBe(true)
  })
})

describe('派生路径', () => {
  it('日志与锁目录挂在 userData 下', () => {
    expect(autoExportLogPath('/ud')).toBe(join('/ud', 'logs', 'auto-export.log'))
    expect(locksDir('/ud')).toBe(join('/ud', 'locks'))
  })
})
