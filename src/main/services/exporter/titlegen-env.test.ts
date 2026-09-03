/**
 * titlegen 子进程环境与参数：白名单放行矩阵、参数数组快照、失败分类。
 * 全为纯函数，不启动任何子进程。
 */
import { describe, expect, it } from 'vitest'

import { claudeArgs, classifyFailure, quoteForCmd, sanitizeEnvForClaude, TITLEGEN_ENV_MARK } from './titlegen-env'

describe('sanitizeEnvForClaude 放行白名单', () => {
  it('保留运行、代理、证书与 claude 自身的认证入口', () => {
    const out = sanitizeEnvForClaude({
      PATH: '/usr/bin',
      HOME: '/Users/me',
      SHELL: '/bin/zsh',
      LANG: 'zh_CN.UTF-8',
      LC_ALL: 'zh_CN.UTF-8',
      TMPDIR: '/tmp',
      HTTPS_PROXY: 'http://127.0.0.1:7890',
      https_proxy: 'http://127.0.0.1:7890',
      NODE_EXTRA_CA_CERTS: '/etc/ca.pem',
      CLAUDE_CONFIG_DIR: '/Users/me/.claude',
      CLAUDE_CODE_OAUTH_TOKEN: 'tok',
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      AWS_REGION: 'us-east-1',
      GOOGLE_APPLICATION_CREDENTIALS: '/g.json',
      CLOUD_ML_REGION: 'us-central1'
    })
    expect(out.PATH).toBe('/usr/bin')
    expect(out.HOME).toBe('/Users/me')
    expect(out.LC_ALL).toBe('zh_CN.UTF-8')
    expect(out.HTTPS_PROXY).toBe('http://127.0.0.1:7890')
    expect(out.https_proxy).toBe('http://127.0.0.1:7890')
    expect(out.NODE_EXTRA_CA_CERTS).toBe('/etc/ca.pem')
    expect(out.CLAUDE_CONFIG_DIR).toBe('/Users/me/.claude')
    expect(out.CLAUDE_CODE_OAUTH_TOKEN).toBe('tok')
    expect(out.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com')
    expect(out.AWS_REGION).toBe('us-east-1')
    expect(out.GOOGLE_APPLICATION_CREDENTIALS).toBe('/g.json')
    expect(out.CLOUD_ML_REGION).toBe('us-central1')
  })

  it('剔除宿主会话的认证标记与其余 CLAUDE_CODE_* 变量', () => {
    const out = sanitizeEnvForClaude({
      PATH: '/usr/bin',
      CLAUDECODE: '1',
      CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH: '1',
      CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: '1',
      CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/sock',
      CLAUDE_CODE_MESSAGING_TOKEN: 'x',
      CLAUDE_CODE_ENTRYPOINT: 'sdk-cli',
      CLAUDE_PID: '123',
      CLAUDE_EFFORT: 'high',
      CLAUDE_AGENT_SDK_VERSION: '1.2.3',
      BAGGAGE: 'k=v',
      AI_AGENT: 'claude',
      USE_LOCAL_OAUTH: '1',
      USE_STAGING_OAUTH: '1',
      ELECTRON_RUN_AS_NODE: '1'
    })
    for (const k of [
      'CLAUDECODE',
      'CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH',
      'CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH',
      'CLAUDE_CODE_MESSAGING_SOCKET',
      'CLAUDE_CODE_MESSAGING_TOKEN',
      'CLAUDE_CODE_ENTRYPOINT',
      'CLAUDE_PID',
      'CLAUDE_EFFORT',
      'CLAUDE_AGENT_SDK_VERSION',
      'BAGGAGE',
      'AI_AGENT',
      'USE_LOCAL_OAUTH',
      'USE_STAGING_OAUTH',
      'ELECTRON_RUN_AS_NODE'
    ]) {
      expect(out[k], `${k} 不应被放行`).toBeUndefined()
    }
    expect(out.PATH).toBe('/usr/bin')
  })

  it('追加自激循环标记与遥测开关，且不修改入参', () => {
    const input = { PATH: '/usr/bin' }
    const out = sanitizeEnvForClaude(input)
    expect(out[TITLEGEN_ENV_MARK]).toBe('1')
    expect(out.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1')
    expect(input).toEqual({ PATH: '/usr/bin' })
    expect(out).not.toBe(input)
  })

  it('win32 保留系统必需变量且键名比较不区分大小写', () => {
    const out = sanitizeEnvForClaude(
      {
        Path: 'C:\\Windows',
        SystemRoot: 'C:\\Windows',
        ComSpec: 'C:\\Windows\\cmd.exe',
        LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
        UserName: 'me',
        CLAUDECODE: '1'
      },
      'win32'
    )
    expect(out.Path).toBe('C:\\Windows')
    expect(out.SystemRoot).toBe('C:\\Windows')
    expect(out.ComSpec).toBe('C:\\Windows\\cmd.exe')
    expect(out.LOCALAPPDATA).toBe('C:\\Users\\me\\AppData\\Local')
    expect(out.UserName).toBe('me')
    expect(out.CLAUDECODE).toBeUndefined()
  })

  it('非 win32 不放行 Windows 专有变量', () => {
    const out = sanitizeEnvForClaude({ SYSTEMROOT: 'C:\\Windows', PATH: '/usr/bin' }, 'darwin')
    expect(out.SYSTEMROOT).toBeUndefined()
  })

  it('值为 undefined 的键不落入结果', () => {
    const out = sanitizeEnvForClaude({ PATH: undefined, HOME: '/h' })
    expect('PATH' in out).toBe(false)
    expect(out.HOME).toBe('/h')
  })
})

describe('claudeArgs', () => {
  it('非 win32：固定 haiku、禁用工具与 MCP、不落会话持久化', () => {
    expect(claudeArgs({ mcpConfig: '{"mcpServers":{}}', platform: 'darwin' })).toEqual([
      '-p',
      '--output-format',
      'text',
      '--model',
      'haiku',
      '--tools',
      '',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--no-session-persistence',
      '--setting-sources',
      ''
    ])
  })

  it('prompt 不进 argv：参数里不出现任何提示词，由调用方写 stdin', () => {
    const args = claudeArgs({ mcpConfig: '{}', platform: 'darwin' })
    expect(args.some((a) => a.includes('标题生成器'))).toBe(false)
    expect(args[args.length - 1]).toBe('') // 末位是 --setting-sources 的空取值，不再是 prompt
  })

  it('win32 的 --tools 与空 --setting-sources 都用字面量双引号，避免空参数被 shell 吞掉', () => {
    const args = claudeArgs({ mcpConfig: 'C:\\ud\\mcp-empty.json', platform: 'win32' })
    expect(args[args.indexOf('--tools') + 1]).toBe('""')
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('""')
    expect(args[args.indexOf('--mcp-config') + 1]).toBe('C:\\ud\\mcp-empty.json')
  })

  it('viaShell=false 时空参数用真空串：win32 直接 spawn claude.exe 不经 cmd.exe', () => {
    const args = claudeArgs({ mcpConfig: 'C:\\ud\\mcp-empty.json', platform: 'win32', viaShell: false })
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('')
  })

  it('settingSources 缺省为空串：派生会话不加载任何 settings 来源，用户钩子不触发', () => {
    const args = claudeArgs({ mcpConfig: '{}', platform: 'darwin' })
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('')
  })

  it('显式传 null 时整个参数不出现，传具体来源时原样透传', () => {
    expect(claudeArgs({ mcpConfig: '{}', settingSources: null, platform: 'darwin' })).not.toContain(
      '--setting-sources'
    )
    const args = claudeArgs({ mcpConfig: '{}', settingSources: 'project', platform: 'darwin' })
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('project')
  })
})

describe('quoteForCmd', () => {
  it('外层加双引号，内嵌双引号转义为 \\"', () => {
    expect(quoteForCmd('C:\\Users\\my name\\mcp.json')).toBe('"C:\\Users\\my name\\mcp.json"')
    expect(quoteForCmd('a"b')).toBe('"a\\"b"')
  })
})

describe('classifyFailure', () => {
  it('识别各类认证失败', () => {
    expect(classifyFailure('', 'Not logged in. Please run /login')).toBe('auth')
    expect(classifyFailure('', 'OAuth session expired and could not be refreshed')).toBe('auth')
    expect(classifyFailure('', 'Failed to authenticate: token invalid')).toBe('auth')
    expect(classifyFailure('Invalid API key', '')).toBe('auth')
    expect(classifyFailure('', '{"type":"authentication_error"}')).toBe('auth')
  })

  it('被杀进程优先判为超时', () => {
    expect(classifyFailure('', '', true)).toBe('timeout')
    expect(classifyFailure('', 'Not logged in', true)).toBe('timeout')
  })

  it('有输出但无认证特征归为 other，无任何信息返回 null', () => {
    expect(classifyFailure('答复审查意见', '')).toBe('other')
    expect(classifyFailure('', 'command not found')).toBe('other')
    expect(classifyFailure('', '')).toBe(null)
    expect(classifyFailure('  ', '\n')).toBe(null)
  })
})
