/**
 * titlegen 纯函数测试：cleanTitle / fallbackTitle / parseBatchJson / sampleEventText，
 * 以及子进程调用的参数、环境与 prompt 传递方式（sh 桩替代真实 claude CLI）。
 *
 * userData 统一指向临时目录：冷却文件（titlegen-cooldown.json）读写不得触碰真实应用目录，
 * 否则本机若正处于认证冷却期，所有起名用例会被静默跳过。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  cleanTitle,
  fallbackTitle,
  generateTitle,
  generateTitles,
  isCoolingDown,
  isPollutedPrompt,
  markCoolingDown,
  parseBatchJson,
  sampleEventText,
  type TitleSource, findClaudeBin } from './titlegen'

let userDataDir = ''
let prevUserData: string | undefined

beforeAll(() => {
  userDataDir = mkdtempSync(path.join(os.tmpdir(), 'chatark-titlegen-ud-'))
  prevUserData = process.env.CHATARK_USER_DATA
  process.env.CHATARK_USER_DATA = userDataDir
})

afterAll(() => {
  if (prevUserData === undefined) delete process.env.CHATARK_USER_DATA
  else process.env.CHATARK_USER_DATA = prevUserData
  rmSync(userDataDir, { recursive: true, force: true })
})

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
  /** 桩 claude：吃掉 stdin 的 prompt，固定回一段含越界/负数/小数 index 的 JSON。 */
  function stubBin(json: string): { bin: string; dir: string } {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'chatark-titlegen-'))
    const bin = path.join(dir, 'claude-stub.sh')
    writeFileSync(bin, `#!/bin/sh\ncat >/dev/null\ncat <<'JSONEOF'\n${json}\nJSONEOF\n`, { mode: 0o755 })
    return { bin, dir }
  }

  it('子进程参数固定为 haiku / 禁用工具 / 严格空 MCP / 不落会话持久化', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'chatark-titlegen-'))
    const bin = path.join(dir, 'claude-stub.sh')
    writeFileSync(
      bin,
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args.txt"\ncat > "${dir}/stdin.txt"\necho 标题A\n`,
      { mode: 0o755 }
    )

    const t = await generateTitle({ cwd: '/p', text: 'x' }, { claudeBin: bin })

    expect(t).toBe('标题A')
    const args = readFileSync(path.join(dir, 'args.txt'), 'utf8').split('\n')
    expect(args.slice(0, 6)).toEqual(['-p', '--output-format', 'text', '--model', 'haiku', '--tools'])
    expect(args).toContain('--strict-mcp-config')
    expect(args).toContain('{"mcpServers":{}}')
    expect(args).toContain('--no-session-persistence')
    rmSync(dir, { recursive: true, force: true })
  })

  it('prompt 经 stdin 传入，argv 里一个字都不出现', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'chatark-titlegen-'))
    const bin = path.join(dir, 'claude-stub.sh')
    writeFileSync(
      bin,
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args.txt"\ncat > "${dir}/stdin.txt"\necho 标题A\n`,
      { mode: 0o755 }
    )
    const text = '这段正文必须原样出现在 stdin 里'

    await generateTitle({ cwd: '/项目 甲', text }, { claudeBin: bin })

    const args = readFileSync(path.join(dir, 'args.txt'), 'utf8')
    const stdin = readFileSync(path.join(dir, 'stdin.txt'), 'utf8')
    expect(args).not.toContain('你是对话标题生成器')
    expect(args).not.toContain(text)
    expect(stdin).toContain('你是对话标题生成器')
    expect(stdin).toContain('项目路径: /项目 甲')
    expect(stdin).toContain(text)
    rmSync(dir, { recursive: true, force: true })
  })

  it('prompt 含 shell 元字符时原样到达桩，不被解释也不改变标题', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'chatark-titlegen-'))
    const bin = path.join(dir, 'claude-stub.sh')
    writeFileSync(bin, `#!/bin/sh\ncat > "${dir}/stdin.txt"\necho 标题A\n`, { mode: 0o755 })
    const danger = '危险 & 元字符 | 管道 > 重定向 $(whoami) `id` ${HOME} ;rm -rf /'

    const t = await generateTitle({ cwd: '/p', text: danger }, { claudeBin: bin })

    expect(t).toBe('标题A')
    expect(readFileSync(path.join(dir, 'stdin.txt'), 'utf8')).toContain(danger)
    rmSync(dir, { recursive: true, force: true })
  })

  it('子进程带自激循环标记，且不继承宿主会话的 CLAUDECODE 等认证标记', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'chatark-titlegen-'))
    const bin = path.join(dir, 'claude-stub.sh')
    writeFileSync(bin, `#!/bin/sh\ncat >/dev/null\nprintenv > "${dir}/env.txt"\necho 标题A\n`, { mode: 0o755 })
    const prev = process.env.CLAUDECODE
    process.env.CLAUDECODE = '1'
    process.env.CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH = '1'

    try {
      const t = await generateTitle({ cwd: '/p', text: 'x' }, { claudeBin: bin })
      expect(t).toBe('标题A')
      const env = readFileSync(path.join(dir, 'env.txt'), 'utf8')
      expect(env).toMatch(/^CHATARK_TITLEGEN=1$/m)
      expect(env).toMatch(/^CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1$/m)
      expect(env).not.toMatch(/^CLAUDECODE=/m)
      expect(env).not.toMatch(/^CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH=/m)
    } finally {
      if (prev === undefined) delete process.env.CLAUDECODE
      else process.env.CLAUDECODE = prev
      delete process.env.CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH
      rmSync(dir, { recursive: true, force: true })
    }
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

describe('认证失败冷却', () => {
  /** 每例换一个 userData：进程内快捷标志按路径记忆，换目录即天然复位 */
  function freshUserData(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'chatark-cooldown-'))
    process.env.CHATARK_USER_DATA = dir
    return dir
  }

  it('标记后进入冷却，冷却期内不再拉起 claude', async () => {
    const dir = freshUserData()
    const bin = path.join(dir, 'claude-stub.sh')
    writeFileSync(bin, `#!/bin/sh\ncat >/dev/null\ntouch "${dir}/called.txt"\necho 标题A\n`, { mode: 0o755 })

    expect(isCoolingDown()).toBe(false)
    markCoolingDown('auth')
    expect(isCoolingDown()).toBe(true)
    expect(await generateTitle({ cwd: '/p', text: 'x' }, { claudeBin: bin })).toBe(null)
    expect(await generateTitles([{ cwd: '/p', text: 'x' }], 3, { claudeBin: bin })).toEqual([null])
    expect(readFileSync(path.join(dir, 'titlegen-cooldown.json'), 'utf8')).toContain('"reason":"auth"')

    process.env.CHATARK_USER_DATA = userDataDir
    rmSync(dir, { recursive: true, force: true })
  })

  it('claude 报未登录时自动进入冷却', async () => {
    const dir = freshUserData()
    const bin = path.join(dir, 'claude-stub.sh')
    writeFileSync(bin, '#!/bin/sh\ncat >/dev/null\necho "Not logged in. Please run /login"\n', { mode: 0o755 })

    expect(await generateTitle({ cwd: '/p', text: 'x' }, { claudeBin: bin })).toBe(null)
    expect(isCoolingDown()).toBe(true)

    process.env.CHATARK_USER_DATA = userDataDir
    rmSync(dir, { recursive: true, force: true })
  })

  it('冷却文件损坏或已过期一律按未冷却处理', () => {
    const broken = freshUserData()
    writeFileSync(path.join(broken, 'titlegen-cooldown.json'), '{bad json', 'utf8')
    expect(isCoolingDown()).toBe(false)

    const expired = freshUserData()
    writeFileSync(
      path.join(expired, 'titlegen-cooldown.json'),
      JSON.stringify({ reason: 'auth', until: Date.now() - 1 }),
      'utf8'
    )
    expect(isCoolingDown()).toBe(false)

    process.env.CHATARK_USER_DATA = userDataDir
    rmSync(broken, { recursive: true, force: true })
    rmSync(expired, { recursive: true, force: true })
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

describe('findClaudeBin 的显式覆盖语义', () => {
  it('CHATARK_CLAUDE_BIN 指向不存在的路径时视为不可用，不回退扫 PATH', () => {
    expect(findClaudeBin({ CHATARK_CLAUDE_BIN: '/nonexistent/claude', PATH: process.env.PATH })).toBeNull()
  })

  it('CHATARK_CLAUDE_BIN 指向存在的文件时直接采用', () => {
    expect(findClaudeBin({ CHATARK_CLAUDE_BIN: process.execPath })).toBe(process.execPath)
  })
})

describe('findClaudeBin 的候选可执行性检查', () => {
  it('PATH 中同名目录不被采信，可执行文件才采用', () => {
    const base = mkdtempSync(path.join(os.tmpdir(), 'chatark-which-'))
    const dirEntry = path.join(base, 'as-dir')
    const fileEntry = path.join(base, 'as-file')
    mkdirSync(path.join(dirEntry, 'claude'), { recursive: true }) // PATH 项下是一个名为 claude 的目录
    mkdirSync(fileEntry, { recursive: true })
    writeFileSync(path.join(fileEntry, 'claude'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })

    expect(findClaudeBin({ PATH: dirEntry })).not.toBe(path.join(dirEntry, 'claude'))
    expect(findClaudeBin({ PATH: fileEntry })).toBe(path.join(fileEntry, 'claude'))
    rmSync(base, { recursive: true, force: true })
  })

  it('无执行位的同名文件不被采信', () => {
    const base = mkdtempSync(path.join(os.tmpdir(), 'chatark-which-'))
    writeFileSync(path.join(base, 'claude'), '#!/bin/sh\nexit 0\n', { mode: 0o644 })

    expect(findClaudeBin({ PATH: base })).not.toBe(path.join(base, 'claude'))
    rmSync(base, { recursive: true, force: true })
  })
})
