/**
 * Codex 对话记录导出单元测试。
 * 作者：Chin_Jing1998；修订日期：2026-10-31（北京时间）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  extractCodexSessionIdFromFilename,
  isCodexTranscript,
  lookupCodexThreadTitle,
  normalizeCodexRecords,
  stripCodexInjectedText
} from './codex'
import { exportSession } from './export-session'
import { parseText } from './jsonl-parser'
import { quickInfo } from './session-locator'
import { EventType } from './types'
import { buildConversation } from './model'

const SID = '01a191ef-4b18-7033-a59f-8f4dd26a1f70'
let tmp = ''

function makeCodexRolloutLines(cwd = '/Users/me/chatark'): string[] {
  return [
    JSON.stringify({
      timestamp: '2026-10-31T12:38:34.000Z',
      type: 'session_meta',
      payload: {
        id: SID,
        cwd,
        git: { branch: 'main' }
      }
    }),
    JSON.stringify({
      timestamp: '2026-10-31T12:38:34.100Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'developer',
        content: [{ type: 'input_text', text: '<skills_instructions>internal</skills_instructions>' }]
      }
    }),
    JSON.stringify({
      timestamp: '2026-10-31T12:38:34.200Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: '# AGENTS.md instructions\n\n<INSTRUCTIONS>\n所有回答使用简体中文。\n</INSTRUCTIONS>'
          },
          {
            type: 'input_text',
            text: '<environment_context>\n  <cwd>/Users/me/chatark</cwd>\n</environment_context>'
          }
        ]
      }
    }),
    JSON.stringify({
      timestamp: '2026-10-31T12:38:34.300Z',
      type: 'turn_context',
      payload: {
        cwd,
        model: 'codex/gpt-6.1-sol'
      }
    }),
    JSON.stringify({
      timestamp: '2026-10-31T12:38:35.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: '增加codex对话记录导出的功能，和claude code一样设计'
          }
        ]
      }
    }),
    JSON.stringify({
      timestamp: '2026-10-31T12:38:36.000Z',
      type: 'response_item',
      payload: {
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: '正在梳理导出器与会话定位层的结构。' }]
      }
    }),
    JSON.stringify({
      timestamp: '2026-10-31T12:38:37.000Z',
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        call_id: 'call_001',
        name: 'exec_command',
        input: JSON.stringify({ cmd: 'ls -la src/main/services/exporter' })
      }
    }),
    JSON.stringify({
      timestamp: '2026-10-31T12:38:38.000Z',
      type: 'response_item',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'call_001',
        output: [{ type: 'input_text', text: 'paths.ts\nsession-locator.ts\nmodel.ts' }]
      }
    }),
    JSON.stringify({
      timestamp: '2026-10-31T12:38:40.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '已完成 Codex 对话记录导出功能的全链路适配。' }]
      }
    })
  ]
}

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'chatark-codex-test-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('Codex rollout JSONL 识别与清洗', () => {
  it('从 rollout 文件名提取标准 UUID sessionId', () => {
    expect(
      extractCodexSessionIdFromFilename(
        `/Users/me/.codex/sessions/2026/10/31/rollout-2026-10-31T20-29-01-${SID}.jsonl`
      )
    ).toBe(SID)
  })

  it('剥离 AGENTS.md、environment_context 与上下文压缩交接尾巴', () => {
    const raw = [
      '# AGENTS.md instructions',
      '<INSTRUCTIONS>规范正文</INSTRUCTIONS>',
      '<environment_context><cwd>/tmp</cwd></environment_context>',
      '增加codex对话记录导出的功能，和claude code一样设计Another language model started to solve this problem and produced a summary of its thinking process. 交接内容'
    ].join('\n')
    expect(stripCodexInjectedText(raw)).toBe('增加codex对话记录导出的功能，和claude code一样设计')
  })

  it('将 <send_user_message_question_reply> 转换为可读回答', () => {
    const reply =
      '<send_user_message_question_reply>[{"questionItemId":"q1","answer":"全部保留并对齐"}]</send_user_message_question_reply>'
    expect(stripCodexInjectedText(reply)).toBe('全部保留并对齐')
  })

  it('从 session_index.jsonl 查找最新 thread_name 并去除前导装饰 emoji', () => {
    const idx = path.join(tmp, 'session_index.jsonl')
    writeFileSync(
      idx,
      [
        JSON.stringify({ id: SID, thread_name: '初版标题', updated_at: '2026-10-31T01:00:00Z' }),
        JSON.stringify({ id: SID, thread_name: '🧩 Codex 对话导出｜与 Claude Code 对齐', updated_at: '2026-10-31T02:00:00Z' })
      ].join('\n'),
      'utf8'
    )
    expect(lookupCodexThreadTitle(SID, idx)).toBe('Codex 对话导出｜与 Claude Code 对齐')
  })
})

describe('Codex 记录归一化与完整导出', () => {
  it('parseText 自动识别 Codex 格式并构建含思考、工具配对与回答的 Conversation', () => {
    const text = makeCodexRolloutLines().join('\n')
    const parsed = parseText(text)
    expect(parsed.sourceClient).toBe('codex')
    expect(isCodexTranscript(parsed.records)).toBe(false) // 已归一化为标准 RawRecord

    const conv = buildConversation(parsed.records)
    expect(conv.session_id).toBe(SID)
    expect(conv.cwd).toBe('/Users/me/chatark')
    expect(conv.git_branch).toBe('main')
    expect(conv.model).toBe('codex/gpt-6.1-sol')
    expect(conv.user_prompt_count).toBe(1)
    expect(conv.events.map((e) => e.etype)).toEqual([
      EventType.USER_PROMPT,
      EventType.THINKING,
      EventType.TOOL_CALL,
      EventType.TOOL_RESULT,
      EventType.ANSWER
    ])
    expect(conv.events[0].text).toBe('增加codex对话记录导出的功能，和claude code一样设计')
    expect(conv.events[2].paired).toBe(true)
    expect(conv.events[3].paired).toBe(true)
    expect(conv.events[3].text).toContain('session-locator.ts')
  })

  it('normalizeCodexRecords 支持注入 session_index 标题', () => {
    const raw = makeCodexRolloutLines().map((l) => JSON.parse(l) as Record<string, unknown>)
    const norm = normalizeCodexRecords(raw, { threadTitle: 'Codex 导出器架构对齐' })
    const conv = buildConversation(norm)
    expect(conv.title).toBe('Codex 导出器架构对齐')
  })

  it('quickInfo 与 exportSession 原生处理 Codex rollout 文件并产出五件套', async () => {
    const rolloutPath = path.join(tmp, `rollout-2026-10-31T20-29-01-${SID}.jsonl`)
    const historyRoot = path.join(tmp, 'history')
    mkdirSync(historyRoot, { recursive: true })
    writeFileSync(rolloutPath, makeCodexRolloutLines().join('\n') + '\n', 'utf8')

    const info = await quickInfo(rolloutPath)
    expect(info.sessionId).toBe(SID)
    expect(info.source).toBe('codex')
    expect(info.title).toBe('增加codex对话记录导出的功能，和claude code一样设计')
    expect(info.turns).toBe(2)
    expect(info.model).toBe('codex/gpt-6.1-sol')

    const out = await exportSession({ sourceJsonl: rolloutPath, historyRoot })
    expect(out.ok).toBe(true)
    const dir = out.dir!
    expect(path.basename(dir)).toContain('增加codex对话记录导')
    for (const f of ['对话.md', '对话.html', 'data.js', 'meta.json', 'transcript.jsonl']) {
      expect(existsSync(path.join(dir, f))).toBe(true)
    }
    expect(readFileSync(path.join(dir, '对话.md'), 'utf8')).toContain('已完成 Codex 对话记录导出功能的全链路适配')
    expect(readFileSync(path.join(dir, '对话.md'), 'utf8')).not.toContain('AGENTS行为规范')
  })
})
