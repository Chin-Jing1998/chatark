/**
 * 存量库维护测试：临时库 fixture（haiku meta / 污染标题 / 分类目录无 meta / 损坏 meta），
 * stub titleGen 注入，断言 dry-run 不写盘不调 LLM、haiku 搬移需 confirm 且只搬短会话、
 * LLM 不可用时不据本地回退改名。不触碰真实历史库。
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { runLibraryMaintain, listConversationDirs, isFallbackAllowed } from './library-maintain'
import { isPollutedPrompt, type TitleSource } from './exporter/titlegen'

const NOW = new Date('2026-08-14T10:30:00')
/** 超过 12 码点：LLM 失败时若走 fallbackTitle 会被截断，据此验证 H2 护栏 */
const LONG_TITLE = '答复第一次审查意见通知书补正说明'
const GOOD_DIR = '其他/20260103_000000_答复审查意见_dddddddd'
const LONG_HAIKU_DIR = '专利/20260101_000002_haiku长会话_ffffffff'
/** 库根第一层的游离对话目录（历史上手工拖拽丢了分类层）：不在维护范围内 */
const STRAY_DIR = '20260105_000000_游离会话_hhhhhhhh'

/** 构造临时库：<root>/<分类或扁平>/<会话目录>/{meta.json, transcript.jsonl}。 */
function buildLibrary(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'chatark-maintain-'))
  const conv = (rel: string, meta: Record<string, unknown>): void => {
    const dir = path.join(root, rel)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ sessionId: 'x', title: 't', ...meta }), 'utf8')
    writeFileSync(
      path.join(dir, 'transcript.jsonl'),
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '帮我写专利答复' }] } }),
      'utf8'
    )
  }
  const haiku = 'claude-haiku-4-5-20251001'
  // 短 haiku：唯一允许搬移的形态
  conv('专利/20260101_000000_haiku会话_aaaaaaaa', { model: haiku, cwd: '/p/haiku', messageCount: 4 })
  conv('专利/20260101_000001_haiku会话2_bbbbbbbb', { model: haiku, cwd: '/p/haiku2', messageCount: 6 })
  // 长 haiku 与无 messageCount 的 haiku：均不得搬移
  conv(LONG_HAIKU_DIR, { model: haiku, cwd: '/p/haiku3', messageCount: 40 })
  conv('专利/20260101_000003_haiku无计数_gggggggg', { model: haiku, cwd: '/p/haiku4' })
  conv('专利/20260102_000000_Below_is_a_conversation_log_fr_cccccccc', {
    model: 'claude-opus-5',
    cwd: '/p/CN2410062（保险）',
    title: 'Below is a conversation log from Claude Code'
  })
  conv(GOOD_DIR, { model: 'claude-opus-5', cwd: '/p/审查', title: LONG_TITLE })
  // 根层游离目录：污染标题，但因不在 <根>/<分类>/<对话> 布局内，一律不被扫描与改名
  conv(STRAY_DIR, {
    model: 'claude-opus-5',
    cwd: '/p/游离',
    title: 'Below is a conversation log from Claude Code'
  })
  // 无 meta 的分类目录（模拟 专利/ 本身）——扫描应排除
  mkdirSync(path.join(root, '学术'), { recursive: true })
  // 损坏 meta 的会话目录——计入 skippedNoMeta 且不被清理/重命名
  const bad = path.join(root, '学术/20260104_000000_坏meta_eeeeeeee')
  mkdirSync(bad, { recursive: true })
  writeFileSync(path.join(bad, 'meta.json'), '{broken json', 'utf8')
  return root
}

/** 按内容而非下标决定结果，避免依赖目录遍历顺序：仅污染标题拿到 LLM 新标题。 */
const stubTitleGen = (items: TitleSource[]): Promise<(string | null)[]> =>
  Promise.resolve(items.map((it) => (isPollutedPrompt(it.existingTitle ?? '') ? '专利答复撰写' : null)))

const nullTitleGen = (items: TitleSource[]): Promise<(string | null)[]> =>
  Promise.resolve(items.map(() => null))

const titleOf = (root: string, rel: string): string =>
  JSON.parse(readFileSync(path.join(root, rel, 'meta.json'), 'utf8')).title

describe('isFallbackAllowed', () => {
  it('仅空标题 / 未命名会话 / 污染标题允许 LLM 失败后的本地回退改名', () => {
    expect(isFallbackAllowed('')).toBe(true)
    expect(isFallbackAllowed('   ')).toBe(true)
    expect(isFallbackAllowed(undefined)).toBe(true)
    expect(isFallbackAllowed('未命名会话')).toBe(true)
    expect(isFallbackAllowed('Below is a conversation log from Claude Code')).toBe(true)
    expect(isFallbackAllowed('你是对话标题生成器。根据下面的项目路径与对话内容')).toBe(true)
    // 正常长标题不得回退——否则被截成 12 码点并连目录名一起改写
    expect(isFallbackAllowed(LONG_TITLE)).toBe(false)
  })
})

describe('library-maintain', () => {
  it('dry-run 不写盘、不调用 LLM，只给出调用次数与候选数预估', async () => {
    const root = buildLibrary()
    const before = readdirSync(root).sort()
    let called = false
    const spy = (items: TitleSource[]): Promise<(string | null)[]> => {
      called = true
      return nullTitleGen(items)
    }
    const report = await runLibraryMaintain(root, { dryRun: true, titleGen: spy, now: NOW })

    expect(called).toBe(false) // H3：预览不得产生 LLM 副作用
    expect(report.scanned).toBe(6)
    expect(report.haikuDirs.length).toBe(2)
    expect(report.haikuMoved).toBe(2) // dry-run 按识别数计
    expect(report.renamed).toBe(4) // 待重命名候选 = 未被搬移的会话数
    expect(report.notes.join()).toContain('将发起 1 次 LLM 调用')
    expect(readdirSync(root).sort()).toEqual(before)
    expect(existsSync(path.join(root, `.trash-haiku-${'20260814103000'}`))).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })

  it('未加 confirm 时只列出 haiku 清单，不搬移任何目录', async () => {
    const root = buildLibrary()
    const report = await runLibraryMaintain(root, { titleGen: stubTitleGen, now: NOW })

    expect(report.haikuDirs.length).toBe(2)
    expect(report.haikuMoved).toBe(0)
    expect(report.trashDir).toBeUndefined()
    expect(report.notes.join()).toContain('--confirm')
    expect(existsSync(path.join(root, '专利/20260101_000000_haiku会话_aaaaaaaa'))).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  it('confirm：短 haiku 移入 .trash-haiku-*，长会话与无计数的 haiku 保留', async () => {
    const root = buildLibrary()
    const report = await runLibraryMaintain(root, { titleGen: stubTitleGen, confirm: true, now: NOW })

    expect(report.scanned).toBe(6)
    expect(report.haikuMoved).toBe(2)
    expect(report.skippedNoMeta).toBe(1) // 损坏 meta
    expect(report.renamed).toBe(1) // 污染标题 → LLM '专利答复撰写'
    expect(report.llmFailed).toBe(3) // 其余三条 LLM 返回 null → 保留原标题

    const trash = path.join(root, `.trash-haiku-${'20260814103000'}`)
    expect(report.trashDir).toBe(trash)
    expect(report.notes.join()).toContain('还原')
    expect(readdirSync(trash).sort()).toEqual(['20260101_000000_haiku会话_aaaaaaaa', '20260101_000001_haiku会话2_bbbbbbbb'])

    // 阈值内外的 haiku：长会话与缺 messageCount 的都留在原处
    expect(existsSync(path.join(root, LONG_HAIKU_DIR))).toBe(true)
    expect(existsSync(path.join(root, '专利/20260101_000003_haiku无计数_gggggggg'))).toBe(true)

    // 污染标题目录：目录名与 meta.title 均已更新，来源记为 llm
    const renamed = path.join(root, '专利/20260102_000000_专利答复撰写_cccccccc')
    expect(existsSync(renamed)).toBe(true)
    const renamedMeta = JSON.parse(readFileSync(path.join(renamed, 'meta.json'), 'utf8'))
    expect(renamedMeta.title).toBe('专利答复撰写')
    expect(renamedMeta.titleSource).toBe('llm')

    // H2：LLM 对该条失败，长标题原样保留而非被截成 12 码点
    expect(titleOf(root, GOOD_DIR)).toBe(LONG_TITLE)

    // 重跑幂等：haiku 已移走，标题不再变动
    const again = await runLibraryMaintain(root, { titleGen: stubTitleGen, confirm: true, now: NOW })
    expect(again.scanned).toBe(4)
    expect(again.renamed).toBe(0)
    expect(again.haikuMoved).toBe(0)
    expect(titleOf(root, GOOD_DIR)).toBe(LONG_TITLE)

    rmSync(root, { recursive: true, force: true })
  })

  it('LLM 整体不可用时跳过重命名阶段，全库标题原样保留', async () => {
    const root = buildLibrary()
    const report = await runLibraryMaintain(root, { titleGen: nullTitleGen, confirm: true, now: NOW })

    expect(report.renamed).toBe(0)
    expect(report.llmFailed).toBe(4)
    expect(report.notes.join()).toContain('LLM 不可用，跳过重命名 4 条')
    expect(titleOf(root, GOOD_DIR)).toBe(LONG_TITLE)
    expect(titleOf(root, LONG_HAIKU_DIR)).toBe('t')
    // 污染标题也未被本地回退改名（整体不可用时一律不动）
    expect(existsSync(path.join(root, '专利/20260102_000000_Below_is_a_conversation_log_fr_cccccccc'))).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  it('listConversationDirs 跳过点目录、根层游离目录，只收 <根>/<分类>/<对话>', async () => {
    const root = buildLibrary()
    const dirs = await listConversationDirs(root)
    expect(dirs.length).toBe(7) // 6 个会话 + 1 个坏 meta 目录（游离目录不计入）
    expect(dirs.some((d) => d.includes('.trash'))).toBe(false)
    expect(dirs.some((d) => path.basename(d) === STRAY_DIR)).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })

  it('根层游离目录不被维护：既不改名也不搬移', async () => {
    const root = buildLibrary()
    await runLibraryMaintain(root, { titleGen: stubTitleGen, confirm: true, now: NOW })

    expect(existsSync(path.join(root, STRAY_DIR))).toBe(true)
    expect(titleOf(root, STRAY_DIR)).toBe('Below is a conversation log from Claude Code')
    rmSync(root, { recursive: true, force: true })
  })
})
