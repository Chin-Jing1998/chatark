/**
 * 存量库维护测试：临时库 fixture（haiku meta / 污染标题 / 分类目录无 meta / 损坏 meta），
 * stub titleGen 注入，断言 dry-run 不写盘、full 的计数、.trash-haiku-* 生成、
 * 重命名后目录名与 meta.title。不触碰真实历史库。
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { runLibraryMaintain, listConversationDirs } from './library-maintain'
import type { TitleSource } from './exporter/titlegen'

const NOW = new Date('2026-08-14T10:30:00')

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
  conv('专利/20260101_000000_haiku会话_aaaaaaaa', { model: 'claude-haiku-4-5-20251001', cwd: '/p/haiku' })
  conv('专利/20260101_000001_haiku会话2_bbbbbbbb', { model: 'claude-haiku-4-5-20251001', cwd: '/p/haiku2' })
  conv('专利/20260102_000000_Below_is_a_conversation_log_fr_cccccccc', {
    model: 'claude-opus-5',
    cwd: '/p/CN2410062（保险）',
    title: 'Below is a conversation log from Claude Code'
  })
  conv('其他/20260103_000000_答复审查意见_dddddddd', {
    model: 'claude-opus-5',
    cwd: '/p/审查',
    title: '答复第一次审查意见通知书'
  })
  // 无 meta 的分类目录（模拟 专利/ 本身）——扫描应排除
  mkdirSync(path.join(root, '学术'), { recursive: true })
  // 损坏 meta 的会话目录——计入 skippedNoMeta 且不被清理/重命名
  const bad = path.join(root, '学术/20260104_000000_坏meta_eeeeeeee')
  mkdirSync(bad, { recursive: true })
  writeFileSync(path.join(bad, 'meta.json'), '{broken json', 'utf8')
  return root
}

const stubTitleGen = (items: TitleSource[]): Promise<(string | null)[]> =>
  Promise.resolve(items.map((_item, i) => (i === 0 ? '专利答复撰写' : null)))

describe('library-maintain', () => {
  it('dry-run 不产生任何写入：不建 trash、不改 meta、不改目录名', async () => {
    const root = buildLibrary()
    const before = readdirSync(root).sort()
    const report = await runLibraryMaintain(root, { dryRun: true, titleGen: stubTitleGen, now: NOW })

    expect(report.scanned).toBe(4)
    expect(report.haikuDirs.length).toBe(2)
    expect(report.haikuMoved).toBe(2) // dry-run 按识别数计
    expect(report.renamed).toBe(1) // 预览：将重命名 1 个，但不执行
    expect(readdirSync(root).sort()).toEqual(before)
    expect(existsSync(path.join(root, `.trash-haiku-${'20260814103000'}`))).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })

  it('full：haiku 移入 .trash-haiku-*，重命名生效且幂等', async () => {
    const root = buildLibrary()
    const report = await runLibraryMaintain(root, { titleGen: stubTitleGen, now: NOW })

    expect(report.scanned).toBe(4)
    expect(report.haikuMoved).toBe(2)
    expect(report.skippedNoMeta).toBe(1) // 损坏 meta
    expect(report.renamed).toBe(1) // 污染标题 → LLM '专利答复撰写'
    expect(report.llmFailed).toBe(1) // 第二个候选 LLM 返回 null → 回退

    const trash = path.join(root, `.trash-haiku-${'20260814103000'}`)
    expect(existsSync(trash)).toBe(true)
    expect(readdirSync(trash).sort()).toEqual(['20260101_000000_haiku会话_aaaaaaaa', '20260101_000001_haiku会话2_bbbbbbbb'])

    // 污染标题目录：目录名与 meta.title 均已更新
    const renamed = path.join(root, '专利/20260102_000000_专利答复撰写_cccccccc')
    expect(existsSync(renamed)).toBe(true)
    expect(JSON.parse(readFileSync(path.join(renamed, 'meta.json'), 'utf8')).title).toBe('专利答复撰写')

    // 重跑幂等：haiku 已移走、已重命名的 alreadyGood
    const again = await runLibraryMaintain(root, { titleGen: stubTitleGen, now: NOW })
    expect(again.scanned).toBe(2)
    expect(again.alreadyGood).toBe(2)
    expect(again.haikuMoved).toBe(0)

    rmSync(root, { recursive: true, force: true })
  })

  it('listConversationDirs 跳过点目录且只收含 meta.json 的目录', async () => {
    const root = buildLibrary()
    const dirs = await listConversationDirs(root)
    expect(dirs.length).toBe(5) // 4 个会话 + 1 个坏 meta 目录
    expect(dirs.some((d) => d.includes('.trash'))).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })
})
