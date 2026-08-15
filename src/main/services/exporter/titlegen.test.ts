/**
 * titlegen 纯函数测试：cleanTitle / fallbackTitle / parseBatchJson / sampleEventText。
 * 不触发真实 claude CLI（generateTitle/generateTitles 为集成路径，手动验证覆盖）。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  cleanTitle,
  fallbackTitle,
  generateTitle,
  generateTitles,
  isPollutedPrompt,
  parseBatchJson,
  sampleEventText,
  type TitleSource
} from './titlegen'

describe('cleanTitle', () => {
  it('剥离引号与代码围栏并压空白', () => {
    expect(cleanTitle('"答复审查意见"')).toBe('答复审查意见')
    expect(cleanTitle('```json\n{"title":"x"}\n```')).toBe(null)
    expect(cleanTitle('  答复  审查  意见  ')).toBe('答复 审查 意见')
  })

  it('去除尾部标点', () => {
    expect(cleanTitle('答复审查意见通知书。')).toBe('答复审查意见通知书')
    expect(cleanTitle('答复审查意见，')).toBe('答复审查意见')
  })

  it('按码点限长，中文不腰斩', () => {
    expect(cleanTitle('答复第一次审查意见通知书补正')).toBe('答复第一次审查意见通知书')
  })

  it('空输入或净化后为空返回 null', () => {
    expect(cleanTitle('')).toBe(null)
    expect(cleanTitle('。。。')).toBe(null)
    expect(cleanTitle('未命名会话')).toBe(null)
  })
})

describe('fallbackTitle', () => {
  const src: TitleSource = {
    cwd: '/Users/me/西安中细软/审查意见/CN2410062（保险）',
    text: 'x'
  }

  it('污染标题整体视为无效，回退 cwd 目录名', () => {
    expect(fallbackTitle({ ...src, existingTitle: 'Below is a conversation log from Claude Code' })).toBe(
      'CN2410062（保险）'
    )
    expect(fallbackTitle({ ...src, existingTitle: 'Analyze this conversation and provide feedback' })).toBe(
      'CN2410062（保险）'
    )
  })

  it('现有标题可用时优先于 cwd', () => {
    expect(fallbackTitle({ ...src, existingTitle: '答复第一次审查意见通知书' })).toBe('答复第一次审查意见通知书')
  })

  it('无有效现有标题时回退 cwd 末级目录名', () => {
    expect(fallbackTitle({ ...src, existingTitle: '' })).toBe('CN2410062（保险）')
    expect(fallbackTitle({ ...src, existingTitle: '未命名会话' })).toBe('CN2410062（保险）')
  })

  it('cwd 为空时兜底未命名会话', () => {
    expect(fallbackTitle({ cwd: '', text: '' })).toBe('未命名会话')
  })
})

describe('parseBatchJson', () => {
  it('解析标准 JSON 数组', () => {
    const m = parseBatchJson('[{"index":0,"title":"答复审查意见"},{"index":1,"title":"专利检索"}]')
    expect(m.get(0)).toBe('答复审查意见')
    expect(m.get(1)).toBe('专利检索')
  })

  it('剥代码围栏并容忍尾随文字', () => {
    const raw = '好的，以下是结果：\n```json\n[{"index":0,"title":"标题A"}]\n```\n希望对你有帮助'
    expect(parseBatchJson(raw).get(0)).toBe('标题A')
  })

  it('JSON 解析失败时正则兜底逐条抠取', () => {
    const raw = '[{"index":0,"title":"标题A"}, {"index":1,"title":"标题B"}] 附加说明'
    const m = parseBatchJson(raw)
    expect(m.get(0)).toBe('标题A')
    expect(m.get(1)).toBe('标题B')
  })

  it('完全无效输入返回空 Map', () => {
    expect(parseBatchJson(null).size).toBe(0)
    expect(parseBatchJson('抱歉，我无法完成').size).toBe(0)
  })
})

describe('isPollutedPrompt', () => {
  it('识别本模块自身 prompt 的中文前缀（titlegen 派生会话据此跳过导出）', () => {
    expect(isPollutedPrompt('你是对话标题生成器。根据下面的项目路径与对话内容，用中文生成')).toBe(true)
    expect(isPollutedPrompt('为下面 12 个对话各生成一个中文主题标题')).toBe(true)
    expect(isPollutedPrompt('  为下面 3 个对话各生成一个中文主题标题')).toBe(true)
    expect(isPollutedPrompt('Below is a conversation log from Claude Code')).toBe(true)
  })

  it('正常提问不误判', () => {
    expect(isPollutedPrompt('帮我写专利答复')).toBe(false)
    expect(isPollutedPrompt('')).toBe(false)
  })
})

describe('generateTitles 的 index 守卫', () => {
  /** 桩 claude：无视入参，固定回一段含越界/负数/小数 index 的 JSON。 */
  function stubBin(json: string): { bin: string; dir: string } {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'chatark-titlegen-'))
    const bin = path.join(dir, 'claude-stub.sh')
    writeFileSync(bin, `#!/bin/sh\ncat <<'JSONEOF'\n${json}\nJSONEOF\n`, { mode: 0o755 })
    return { bin, dir }
  }

  it('spawn 的 claude 子进程带上自激循环标记（钩子进程据此拒绝导出）', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'chatark-titlegen-'))
    const bin = path.join(dir, 'claude-stub.sh')
    writeFileSync(bin, '#!/bin/sh\nprintenv CHATARK_TITLEGEN > "$(dirname "$0")/env.txt"\necho 标题A\n', { mode: 0o755 })

    const t = await generateTitle({ cwd: '/p', text: 'x' }, { claudeBin: bin })

    expect(t).toBe('标题A')
    expect(readFileSync(path.join(dir, 'env.txt'), 'utf8').trim()).toBe('1')
    rmSync(dir, { recursive: true, force: true })
  })

  it('丢弃越界 / 负数 / 小数 index，不写错槽位也不撑成稀疏数组', async () => {
    const { bin, dir } = stubBin(
      '[{"index":0,"title":"标题A"},{"index":5,"title":"越界"},{"index":-1,"title":"负数"},' +
        '{"index":1.5,"title":"小数"},{"index":2,"title":"标题C"}]'
    )
    const items: TitleSource[] = [0, 1, 2].map(() => ({ cwd: '/p', text: 'x' }))

    const out = await generateTitles(items, 3, { claudeBin: bin })

    expect(out).toEqual(['标题A', null, '标题C'])
    expect(out.length).toBe(3) // 越界写入会把数组撑到 6
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('sampleEventText', () => {
  const events = [
    { etype: 'user', text: '第一条' },
    { etype: 'tool_result', text: '' },
    { etype: 'answer', text: '第二条' },
    { etype: 'user', text: '第三条' }
  ]

  it('按顺序拼接非空事件文本并截断到预算', () => {
    expect(sampleEventText(events, 100)).toBe('第一条\n第二条\n第三条')
    expect(sampleEventText(events, 4)).toBe('第一条\n')
    expect(sampleEventText(events, 7)).toBe('第一条\n第二条')
  })

  it('全空事件返回空串', () => {
    expect(sampleEventText([{ etype: 'tool_result', text: '  ' }], 100)).toBe('')
  })
})
