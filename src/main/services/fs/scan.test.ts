import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { UNCATEGORIZED } from '@shared/constants'
import { scan } from './scan'
import { resolveTestLibraryRoot } from '../../test-support/library-root'

// 库根解析：CHATARK_TEST_LIBRARY > 应用配置 > 默认路径，空库视同无库；找不到时整组跳过，不致 CI 失败
const root = resolveTestLibraryRoot() ?? ''
const maybe = root ? describe : describe.skip

maybe('扫描真实历史库', () => {
  // 断言一律走"结构自洽"而非绝对数量：库会随日常使用与自动导出钩子持续增长，
  // 任何硬编码的对话数/分类数都必然在某天失效（此前写死 111 篇，实际已增至 274 篇）。
  it('登记库内对话并解析出自洽字段', async () => {
    const r = await scan(root)
    expect(r.records.length).toBeGreaterThan(0)

    // 每条记录都应有可用主键：sessionId，或退化的 dir: 形式
    expect(r.records.every((x) => x.id.length > 0)).toBe(true)
    expect(r.records.every((x) => x.sessionId || x.id.startsWith('dir:'))).toBe(true)

    // 分类以物理父目录为准，故必然非空且与 relPath 首段一致；
    // 「未归类」例外——它是库根第一层游离目录的虚拟分组，relPath 就是目录名本身
    for (const x of r.records) {
      expect(x.category.length).toBeGreaterThan(0)
      if (x.category === UNCATEGORIZED) expect(x.relPath).toBe(x.dirName)
      else expect(x.relPath.split(/[\\/]/)[0]).toBe(x.category)
    }

    // 完整性检测自洽：missingFiles 精确反映各标准文件的实际存在性
    // （不硬编码缺失个数——本机实时导出钩子会改动库内容使计数漂移）
    for (const x of r.records) {
      expect(x.integrity.missingFiles.includes('jsonl')).toBe(!x.files.jsonl.exists)
      expect(x.integrity.missingFiles.includes('meta')).toBe(!x.files.meta.exists)
      expect(x.integrity.missingFiles.includes('html')).toBe(!x.files.html.exists)
    }

    // 每条都有标题与 html
    expect(r.records.every((x) => x.title.length > 0)).toBe(true)
  })
})

// —— 临时 fixture 组：库根第一层的游离对话目录与无法识别的目录（不触碰真实库） ——

const CATEGORIZED_DIR = '20260101_120000_专利甲案_abcd1234'
const STRAY_DIR = '20260102_130000_学术乙稿_beef5678'

describe('扫描临时库：游离对话目录与跳过项', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'chatark-scan-'))

    // 分类目录下的正常对话
    const categorized = join(root, '专利', CATEGORIZED_DIR)
    await fs.mkdir(categorized, { recursive: true })
    await fs.writeFile(
      join(categorized, 'meta.json'),
      JSON.stringify({ sessionId: 'sid-abcd1234', title: '专利甲案', category: '专利' }),
      'utf8'
    )

    // 库根第一层的游离对话目录（手工拖拽丢了分类层），meta 记录分类为「学术」
    const stray = join(root, STRAY_DIR)
    await fs.mkdir(stray, { recursive: true })
    await fs.writeFile(
      join(stray, 'meta.json'),
      JSON.stringify({ sessionId: 'sid-beef5678', title: '学术乙稿', category: '学术' }),
      'utf8'
    )

    // 既非对话目录、也无对话子目录
    await fs.mkdir(join(root, 'junk'), { recursive: true })
    await fs.writeFile(join(root, 'junk', '随手记.txt'), 'x', 'utf8')

    // 点目录：即便内部藏着对话目录也一律忽略
    await fs.mkdir(join(root, '.trash-x', STRAY_DIR), { recursive: true })
    await fs.writeFile(join(root, '.trash-x', STRAY_DIR, 'meta.json'), '{}', 'utf8')
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('游离目录归入「未归类」，相对路径为目录名且标记分类不一致', async () => {
    const r = await scan(root)

    const stray = r.records.find((x) => x.dirName === STRAY_DIR)
    expect(stray).toBeDefined()
    expect(stray?.category).toBe(UNCATEGORIZED)
    expect(stray?.relPath).toBe(STRAY_DIR)
    expect(stray?.integrity.categoryMismatch).toBe(true)
    expect(stray?.sessionId).toBe('sid-beef5678')
  })

  it('分类目录下的对话照常解析，分类取物理父目录', async () => {
    const r = await scan(root)

    const rec = r.records.find((x) => x.dirName === CATEGORIZED_DIR)
    expect(rec).toBeDefined()
    expect(rec?.category).toBe('专利')
    expect(rec?.relPath).toBe(join('专利', CATEGORIZED_DIR))
    expect(rec?.integrity.categoryMismatch).toBe(false)
  })

  it('无法识别的第一层目录计入 skipped，点目录整体忽略', async () => {
    const r = await scan(root)

    expect(r.records).toHaveLength(2)
    expect(r.scannedDirs).toBe(2)
    expect(r.skipped.map((s) => s.path)).toContain(join(root, 'junk'))
    expect(r.records.some((x) => x.absPath.includes('.trash-x'))).toBe(false)
  })

  it('空的第一层目录视为空分类，不计入 skipped', async () => {
    const emptyCat = join(root, '空分类')
    await fs.mkdir(emptyCat, { recursive: true })

    const r = await scan(root)

    expect(r.skipped.map((s) => s.path)).not.toContain(emptyCat)
    expect(r.skipped.map((s) => s.path)).toContain(join(root, 'junk'))
  })
})
