/** 作者：Chin_Jing1998；修订日期：2026-10-31（北京时间）。 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, symlinkSync, existsSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  CODEX_PROJECT_ARCHIVE_DIR,
  exportProjectSession,
  PROJECT_ARCHIVE_DIR,
  type ProjectExportInput
} from './project-export'

let tmp: string
let project: string
let input: ProjectExportInput
const sid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee1234'

function row(type: 'user' | 'assistant', text: string, model = 'claude-opus-5-5'): string {
  return JSON.stringify({ type, sessionId: sid, cwd: project, timestamp: '2026-10-31T01:00:00Z',
    message: { role: type, model: type === 'assistant' ? model : undefined, content: [{ type: 'text', text }] } })
}

beforeEach(() => {
  process.env.TZ = 'Asia/Shanghai'
  tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'chatark-project-export-')))
  project = path.join(tmp, '项目 甲')
  mkdirSync(project)
  input = { hook_event_name: 'SessionEnd', session_id: sid, cwd: project,
    transcript_path: path.join(tmp, sid + '.jsonl') }
  writeFileSync(input.transcript_path, row('user', '请完成项目归档') + '\n' + row('assistant', '已完成归档') + '\n')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('退出后保存项目对话记录', () => {
  it('中文空格路径内生成五件套，原始转录一致，日期与署名正确', async () => {
    const result = await exportProjectSession(input)
    expect(result.status).toBe('written')
    const dir = result.dir!
    expect(path.dirname(dir)).toBe(path.join(project, PROJECT_ARCHIVE_DIR))
    expect(readdirSync(dir).sort()).toEqual(['data.js', 'meta.json', 'transcript.jsonl', '对话.html', '对话.md'].sort())
    expect(readFileSync(path.join(dir, 'transcript.jsonl'))).toEqual(readFileSync(input.transcript_path))
    const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'))
    expect(meta.author).toBe('Chin_Jing1998')
    expect(meta.revisedAt).toMatch(/\+08:00$/)
    expect(meta.exportedAt).toBe(meta.revisedAt)
    expect(readFileSync(path.join(dir, '对话.md'), 'utf8')).toContain('已完成归档')
    expect(readFileSync(path.join(dir, '对话.html'), 'utf8')).toContain('<meta name="author" content="Chin_Jing1998">')
  })
  it('重复退出不新增目录，恢复会话新增内容后原目录更新', async () => {
    const first = await exportProjectSession(input)
    expect(await exportProjectSession(input)).toEqual({ status: 'unchanged', dir: first.dir })
    writeFileSync(input.transcript_path, readFileSync(input.transcript_path, 'utf8') + row('assistant', '新增完成结果') + '\n')
    const second = await exportProjectSession(input)
    expect(second).toEqual({ status: 'written', dir: first.dir })
    expect(readFileSync(path.join(second.dir!, '对话.md'), 'utf8')).toContain('新增完成结果')
    expect(readdirSync(path.join(project, PROJECT_ARCHIVE_DIR)).filter((p) => !p.startsWith('.'))).toHaveLength(1)
  })
  it('相同长度的内容变化重新归档，缺失产物自动补齐', async () => {
    const first = await exportProjectSession(input)
    writeFileSync(input.transcript_path, readFileSync(input.transcript_path, 'utf8').replace('已完成归档', '已完成修改'))
    expect((await exportProjectSession(input)).status).toBe('written')
    rmSync(path.join(first.dir!, '对话.html'))
    expect((await exportProjectSession(input)).status).toBe('written')
    expect(existsSync(path.join(first.dir!, '对话.html'))).toBe(true)
  })
  it('切换目录后仍按启动项目归档，不写入工作子目录', async () => {
    const subdir = path.join(project, 'src')
    mkdirSync(subdir)
    input.cwd = subdir
    const result = await exportProjectSession(input, project)
    expect(path.dirname(result.dir!)).toBe(path.join(project, PROJECT_ARCHIVE_DIR))
    expect(existsSync(path.join(subdir, PROJECT_ARCHIVE_DIR))).toBe(false)
  })
  it('未设置启动目录时使用转录初始目录', async () => {
    input.cwd = tmp
    const result = await exportProjectSession(input)
    expect(path.dirname(result.dir!)).toBe(path.join(project, PROJECT_ARCHIVE_DIR))
  })
  it('不同项目的记录互不混写', async () => {
    await exportProjectSession(input)
    const secondProject = path.join(tmp, '项目乙')
    mkdirSync(secondProject)
    const second = await exportProjectSession(input, secondProject)
    expect(path.dirname(second.dir!)).toBe(path.join(secondProject, PROJECT_ARCHIVE_DIR))
  })
  it('实际使用 Haiku 的工作会话正常保存', async () => {
    writeFileSync(input.transcript_path, row('user', '处理当前项目') + '\n' + row('assistant', '处理完成', 'claude-haiku-5-5'))
    expect((await exportProjectSession(input)).status).toBe('written')
  })
  it('只有启动退出或用户输入时不生成空记录', async () => {
    writeFileSync(input.transcript_path, row('user', '/exit'))
    expect((await exportProjectSession(input)).status).toBe('skipped')
    expect(existsSync(path.join(project, PROJECT_ARCHIVE_DIR))).toBe(false)
  })
  it('忽略其他事件，拒绝错配会话和不存在的项目目录', async () => {
    expect((await exportProjectSession({ ...input, hook_event_name: 'Stop' })).status).toBe('skipped')
    await expect(exportProjectSession({ ...input, session_id: 'different' })).rejects.toThrow('会话标识不一致')
    await expect(exportProjectSession(input, path.join(tmp, '不存在'))).rejects.toThrow()
  })
  it('拒绝写入项目外的软链接目标', async () => {
    const outside = path.join(tmp, '外部目录')
    mkdirSync(outside)
    symlinkSync(outside, path.join(project, PROJECT_ARCHIVE_DIR))
    await expect(exportProjectSession(input)).rejects.toThrow('不是独立目录')
    expect(readdirSync(outside)).toEqual([])
  })
  it('Codex rollout 转录自动过滤 AGENTS.md 并归档至项目内 codex对话记录 目录', async () => {
    const codexSid = '01a191ef-4b18-7033-a59f-8f4dd26a1f70'
    const rolloutPath = path.join(tmp, `rollout-2026-10-31T20-29-01-${codexSid}.jsonl`)
    const codexLines = [
      JSON.stringify({
        timestamp: '2026-10-31T12:38:34.000Z',
        type: 'session_meta',
        payload: { id: codexSid, cwd: project, git: { branch: 'main' } }
      }),
      JSON.stringify({
        timestamp: '2026-10-31T12:38:34.100Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: '# AGENTS.md instructions\n<INSTRUCTIONS>系统规则</INSTRUCTIONS>' },
            { type: 'input_text', text: '<environment_context><cwd>' + project + '</cwd></environment_context>' }
          ]
        }
      }),
      JSON.stringify({
        timestamp: '2026-10-31T12:38:34.200Z',
        type: 'turn_context',
        payload: { cwd: project, model: 'codex/gpt-6.1-sol' }
      }),
      JSON.stringify({
        timestamp: '2026-10-31T12:38:35.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '请实现 Codex 对话记录导出' }]
        }
      }),
      JSON.stringify({
        timestamp: '2026-10-31T12:38:36.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '已实现与 Claude Code 一致的导出结构' }]
        }
      })
    ]
    writeFileSync(rolloutPath, codexLines.join('\n') + '\n', 'utf8')
    const codexInput: ProjectExportInput = {
      hook_event_name: 'SessionEnd',
      session_id: codexSid,
      cwd: project,
      transcript_path: rolloutPath
    }
    const res = await exportProjectSession(codexInput)
    expect(res.status).toBe('written')
    expect(res.sourceClient).toBe('codex')
    const dir = res.dir!
    expect(path.dirname(dir)).toBe(path.join(project, CODEX_PROJECT_ARCHIVE_DIR))
    expect(path.basename(dir)).toContain('请实现_Codex_对话记录导出')
    expect(path.basename(dir)).not.toContain('AGENTS.md')
    expect(readFileSync(path.join(dir, 'transcript.jsonl'))).toEqual(readFileSync(rolloutPath))
    const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'))
    expect(meta.author).toBe('Chin_Jing1998')
    expect(meta.sourceClient).toBe('codex')
    expect(meta.model).toBe('codex/gpt-6.1-sol')
    expect(readFileSync(path.join(dir, '对话.md'), 'utf8')).toContain('已实现与 Claude Code 一致的导出结构')
  })
})
