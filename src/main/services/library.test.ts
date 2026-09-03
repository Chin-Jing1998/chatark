import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { UNCATEGORIZED } from '@shared/constants'
import { DEFAULT_GRACE_MS } from './fs/refresh-gate'

// 假计时器只替换 setTimeout/clearTimeout；fs 异步仍靠真实事件循环推进，
// 故在装假计时器之前留一份真实 setTimeout 供轮询等待使用。
const realSetTimeout = setTimeout

// library 经 trash 间接依赖 electron 的 shell（回收站与定位）；settings/store 与 migration/lock
// 已不依赖 electron，userData 由 CHATARK_USER_DATA 环境变量指向临时目录（config.json 写在其中）。
const paths = vi.hoisted(() => ({ userData: '', home: '' }))
vi.mock('electron', () => ({
  app: { getPath: (name: string): string => (name === 'home' ? paths.home : paths.userData) },
  shell: {
    trashItem: vi.fn(),
    showItemInFolder: vi.fn(),
    openPath: vi.fn(),
    openExternal: vi.fn()
  }
}))

const { library } = await import('./library')

const CATEGORIZED = '20260101_120000_专利甲案_abcd1234'
const STRAY_A = '20260102_130000_学术乙稿_beef5678'
const STRAY_B = '20260103_140000_杂项丙稿_c0ffee12'
const NEWCOMER = '20260104_150000_新来丁稿_d0d0cafe'

let base = ''
let root = ''

async function writeConv(dir: string, meta: Record<string, unknown>): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, 'meta.json'), JSON.stringify(meta), 'utf8')
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => realSetTimeout(resolve, ms))
}

/** 轮询等待条件成立（假计时器下不能用被替换的 setTimeout）。 */
async function until(pred: () => boolean, tries = 400): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (pred()) return
    await sleep(5)
  }
  throw new Error('等待条件超时')
}

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'chatark-library-'))
  root = join(base, 'lib')
  paths.userData = join(base, 'userData')
  paths.home = base
  process.env['CHATARK_USER_DATA'] = paths.userData
  await fs.mkdir(paths.userData, { recursive: true })
  await fs.writeFile(
    join(paths.userData, 'config.json'),
    JSON.stringify({ historyRoot: root }),
    'utf8'
  )
  await writeConv(join(root, '专利', CATEGORIZED), {
    sessionId: 'sid-abcd1234',
    title: '专利甲案',
    category: '专利'
  })
})

afterEach(async () => {
  delete process.env['CHATARK_USER_DATA']
  await fs.rm(base, { recursive: true, force: true })
})

describe('library 自操作抑制', () => {
  // 本组放在最前：它用假计时器把宽限期走完，不给后续用例留下悬挂的抑制状态
  it('抑制期间的外部变更不立即刷新，释放并过宽限后合并为一次', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let changes = 0
    const off = library.onChange(() => {
      changes += 1
    })
    try {
      await library.rescan()

      await library.runSuppressed(async () => {
        // 模拟抑制期间由钩子进程写入的新对话
        await writeConv(join(root, '专利', NEWCOMER), {
          sessionId: 'sid-d0d0cafe',
          title: '新来丁稿',
          category: '专利'
        })
        library.notifyExternalChange()
        library.notifyExternalChange()
      })
      expect(changes).toBe(0)

      vi.advanceTimersByTime(DEFAULT_GRACE_MS - 1)
      expect(changes).toBe(0)

      vi.advanceTimersByTime(1)
      await until(() => changes > 0)
      expect(changes).toBe(1)
      // 重放确实重扫过：抑制期间落盘的目录已在库内
      expect(library.get('sid-d0d0cafe')?.category).toBe('专利')
    } finally {
      off()
      vi.useRealTimers()
    }
  })
})

describe('library.refreshIfStale', () => {
  it('库根与一级子目录都没变时不重扫', async () => {
    await library.rescan()

    expect(await library.refreshIfStale()).toBe(false)
  })

  it('发现外部新增目录后重扫并纳入记录', async () => {
    await library.rescan()
    expect(library.get('sid-beef5678')).toBeUndefined()

    await sleep(5) // 与上一次快照拉开时间戳，避免同刻写入判不出差异
    await writeConv(join(root, '学术', STRAY_A), {
      sessionId: 'sid-beef5678',
      title: '学术乙稿',
      category: '学术'
    })

    expect(await library.refreshIfStale()).toBe(true)
    expect(library.get('sid-beef5678')?.category).toBe('学术')
  })

  it('一秒内的重复调用被节流，不再打第二次探针', async () => {
    await library.rescan()
    expect(await library.refreshIfStale()).toBe(false) // 首次探针：无变化

    await sleep(5)
    await writeConv(join(root, '学术', STRAY_A), {
      sessionId: 'sid-beef5678',
      title: '学术乙稿',
      category: '学术'
    })

    // 距上次探针不足 1 秒：变化虽已落盘，本次调用直接返回，不重扫
    expect(await library.refreshIfStale()).toBe(false)
    expect(library.get('sid-beef5678')).toBeUndefined()
  })
})

describe('library.relocateUncategorized', () => {
  it('把游离目录移入 meta 记录的分类，未记录分类的移入「其他」', async () => {
    await writeConv(join(root, STRAY_A), {
      sessionId: 'sid-beef5678',
      title: '学术乙稿',
      category: '学术'
    })
    await writeConv(join(root, STRAY_B), { sessionId: 'sid-c0ffee12', title: '杂项丙稿' })
    await library.rescan()
    expect(library.get('sid-beef5678')?.category).toBe(UNCATEGORIZED)

    const r = await library.relocateUncategorized()

    expect(r.moved).toBe(2)
    expect(r.failed).toEqual([])
    // 目标分类目录原本不存在，由归位过程创建
    await expect(fs.access(join(root, '学术', STRAY_A, 'meta.json'))).resolves.toBeUndefined()
    await expect(fs.access(join(root, '其他', STRAY_B, 'meta.json'))).resolves.toBeUndefined()
    expect(library.get('sid-beef5678')?.category).toBe('学术')
    expect(library.get('sid-c0ffee12')?.category).toBe('其他')
  })

  it('同名冲突逐条计入 failed，不影响其余条目', async () => {
    await writeConv(join(root, '学术', STRAY_A), {
      sessionId: 'sid-existing',
      title: '同名占位',
      category: '学术'
    })
    await writeConv(join(root, STRAY_A), {
      sessionId: 'sid-beef5678',
      title: '学术乙稿',
      category: '学术'
    })
    await writeConv(join(root, STRAY_B), {
      sessionId: 'sid-c0ffee12',
      title: '杂项丙稿',
      category: '编程开发'
    })
    await library.rescan()

    const r = await library.relocateUncategorized()

    expect(r.moved).toBe(1)
    expect(r.failed).toHaveLength(1)
    expect(r.failed[0].title).toBe('学术乙稿')
    expect(r.failed[0].message).toContain('同名')
    // 冲突条目原地保留，仍属「未归类」
    await expect(fs.access(join(root, STRAY_A, 'meta.json'))).resolves.toBeUndefined()
    expect(library.get('sid-beef5678')?.category).toBe(UNCATEGORIZED)
    expect(library.get('sid-c0ffee12')?.category).toBe('编程开发')
  })
})
