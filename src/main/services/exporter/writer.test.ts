/**
 * 幂等定位与增量判定：findExisting 只认 `<根>/<分类>/<对话>/meta.json`
 * （库根第一层的游离目录不得被复用，否则导出写进去后永远不进索引），
 * transcriptUnchanged 只在转录快照与源等大且非 light 导出时为真。
 * 全部写入临时目录。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findExisting, readExistingMeta, transcriptUnchanged } from './writer'

const SID = 'ssss-1111'

let root = ''

/** 造一个会话目录：meta.json + 指定字节数的 transcript.jsonl。 */
function conv(rel: string, meta: Record<string, unknown>, transcriptBytes = 0): string {
  const dir = path.join(root, rel)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ sessionId: SID, title: 't', ...meta }), 'utf8')
  if (transcriptBytes > 0) writeFileSync(path.join(dir, 'transcript.jsonl'), 'x'.repeat(transcriptBytes), 'utf8')
  return dir
}

function source(bytes: number): string {
  const p = path.join(root, `src-${bytes}.jsonl`)
  writeFileSync(p, 'y'.repeat(bytes), 'utf8')
  return p
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'chatark-writer-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('findExisting', () => {
  it('命中 <根>/<分类>/<对话>/meta.json', async () => {
    const dir = conv('专利/20260101_000000_标题_aaaaaaaa', {})
    await expect(findExisting(root, SID)).resolves.toBe(dir)
  })

  it('忽略库根第一层的游离对话目录', async () => {
    conv('20260101_000000_游离_bbbbbbbb', {})
    await expect(findExisting(root, SID)).resolves.toBe(null)
  })

  it('忽略库根直放的 meta.json 与更深层目录', async () => {
    writeFileSync(path.join(root, 'meta.json'), JSON.stringify({ sessionId: SID }), 'utf8')
    conv('专利/子目录/更深/20260101_000000_太深_cccccccc', {})
    await expect(findExisting(root, SID)).resolves.toBe(null)
  })

  it('sessionId 为空或库根不存在时返回 null', async () => {
    conv('专利/20260101_000000_标题_aaaaaaaa', {})
    await expect(findExisting(root, '')).resolves.toBe(null)
    await expect(findExisting(path.join(root, '不存在'), SID)).resolves.toBe(null)
  })
})

describe('transcriptUnchanged', () => {
  it('快照与源等大且非 light 导出 → true', async () => {
    const dir = conv('专利/20260101_000000_标题_aaaaaaaa', {}, 100)
    await expect(transcriptUnchanged(dir, source(100))).resolves.toBe(true)
  })

  it('源已增长 → false', async () => {
    const dir = conv('专利/20260101_000000_标题_aaaaaaaa', {}, 100)
    await expect(transcriptUnchanged(dir, source(120))).resolves.toBe(false)
  })

  it('light 导出（无完整快照）→ false', async () => {
    const dir = conv('专利/20260101_000000_标题_aaaaaaaa', { light: true }, 100)
    await expect(transcriptUnchanged(dir, source(100))).resolves.toBe(false)
  })

  it('缺 transcript.jsonl 或 meta 损坏 → false', async () => {
    const noSnapshot = conv('专利/20260101_000001_无快照_dddddddd', {})
    await expect(transcriptUnchanged(noSnapshot, source(100))).resolves.toBe(false)

    const badMeta = path.join(root, '专利/20260101_000002_坏meta_eeeeeeee')
    mkdirSync(badMeta, { recursive: true })
    writeFileSync(path.join(badMeta, 'meta.json'), '{broken', 'utf8')
    writeFileSync(path.join(badMeta, 'transcript.jsonl'), 'x'.repeat(100), 'utf8')
    await expect(transcriptUnchanged(badMeta, source(100))).resolves.toBe(false)
  })
})

describe('readExistingMeta', () => {
  it('读出 meta，缺失或损坏返回 null', async () => {
    const dir = conv('专利/20260101_000000_标题_aaaaaaaa', { titleSource: 'user' })
    await expect(readExistingMeta(dir)).resolves.toMatchObject({ sessionId: SID, titleSource: 'user' })
    await expect(readExistingMeta(path.join(root, '不存在'))).resolves.toBe(null)
  })
})
