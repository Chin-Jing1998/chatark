/**
 * titlegen 子进程的环境与参数构造（纯函数，无副作用，便于逐条断言）。
 *
 * 起因：钩子进程继承桌面版 Claude 会话的全部环境，其中 CLAUDECODE、
 * CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH、CLAUDE_CODE_MESSAGING_SOCKET 等宿主认证标记
 * 会让嵌套的 `claude -p` 误以为身处宿主会话，报 "OAuth session expired and could not be
 * refreshed" 而失败。故改为**白名单**放行，只保留运行与认证真正需要的变量。
 */

/** 精确匹配放行的变量名。 */
const ALLOW_EXACT = new Set([
  // 基本运行环境
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'TMPDIR',
  'TERM',
  // 代理与证书（企业网络下 claude 需要）
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'all_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  // claude 自身的认证与配置入口（这几项是白名单里唯一放行的 CLAUDE_* / CLAUDE_CODE_*）
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLOUD_ML_REGION'
])

/** 前缀匹配放行（区域设置、Anthropic 直连、云厂商网关凭证）。 */
const ALLOW_PREFIX = ['LC_', 'ANTHROPIC_', 'AWS_', 'GOOGLE_']

/** Windows 下缺失即无法启动子进程的系统变量。 */
const ALLOW_WIN32 = new Set([
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'TEMP',
  'TMP',
  'PROGRAMDATA',
  'USERNAME'
])

/**
 * titlegen 子进程环境标记：claude 的 SessionEnd 钩子进程会继承它，
 * 无头导出见到该标记即拒绝导出，是自激循环的第一道防线。
 */
export const TITLEGEN_ENV_MARK = 'CHATARK_TITLEGEN'

/** 关闭非必要遥测/更新检查，减少一次性子进程的额外网络往返。 */
const DISABLE_TRAFFIC_ENV = 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'

/**
 * 按白名单裁剪环境并追加两个标记，返回新对象（不修改入参）。
 * win32 的环境变量名大小写不敏感（`Path`、`SystemRoot`），故该平台一律按大写比较。
 */
export function sanitizeEnvForClaude(
  env: NodeJS.ProcessEnv,
  platform: string = process.platform
): NodeJS.ProcessEnv {
  const isWin = platform === 'win32'
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    const probe = isWin ? key.toUpperCase() : key
    const allowed =
      ALLOW_EXACT.has(probe) ||
      ALLOW_PREFIX.some((p) => probe.startsWith(p)) ||
      (isWin && ALLOW_WIN32.has(probe))
    if (allowed) out[key] = value
  }
  out[TITLEGEN_ENV_MARK] = '1'
  out[DISABLE_TRAFFIC_ENV] = '1'
  return out
}

export interface ClaudeArgsOptions {
  /** 空 MCP 配置：不走 shell 时传内联 JSON，走 shell 时传文件路径（cmd.exe 会吞掉内联引号） */
  mcpConfig: string
  /**
   * `--setting-sources` 的取值，缺省为空串：已实测（claude 2.1.251，stream-json 钩子事件流）
   * 空串与 `project` 都会让派生会话不加载用户级 settings，SessionStart / UserPromptSubmit /
   * SessionEnd 钩子一个都不触发；默认值下会跑 3 个 SessionStart 钩子与 2 个 UserPromptSubmit 钩子。
   * 传 `null` 可显式省略该参数。
   */
  settingSources?: string | null
  /**
   * 本次调用是否经 shell 拼接命令行（win32 的 .cmd/.bat 必须经 cmd.exe）。
   * 缺省按 platform 判定：win32 视为走 shell。经 shell 时空参数会被吞掉，须用字面量 `""` 占位。
   */
  viaShell?: boolean
  platform?: string
}

/**
 * 构造 `claude -p` 参数：固定 haiku、禁用全部工具与 MCP、不落会话持久化。
 * prompt 不进 argv，由调用方写入子进程 stdin（`claude -p` 无位置参数时从 stdin 读取），
 * 避免长文本触碰命令行长度上限、也避免经 shell 时被解释元字符。
 * `--tools` 的空值在经 shell 时必须写成字面量 `'""'`，否则空参数被 shell 吞掉，
 * `--strict-mcp-config` 会被当成 `--tools` 的取值。
 */
export function claudeArgs(opts: ClaudeArgsOptions): string[] {
  const viaShell = opts.viaShell ?? (opts.platform ?? process.platform) === 'win32'
  // 经 shell 拼接时空参数会被吞掉：用字面量 "" 占位，否则后一个参数会被当成取值
  const emptyArg = viaShell ? '""' : ''
  const settingSources = opts.settingSources === undefined ? '' : opts.settingSources
  return [
    '-p',
    '--output-format',
    'text',
    '--model',
    'haiku',
    '--tools',
    emptyArg,
    '--strict-mcp-config',
    '--mcp-config',
    opts.mcpConfig,
    '--no-session-persistence',
    ...(settingSources === null ? [] : ['--setting-sources', settingSources === '' ? emptyArg : settingSources])
  ]
}

/**
 * cmd.exe 参数引用：Node 对 `shell: true` 只做 `[file, ...args].join(' ')`，不做任何转义，
 * 含空格的取值必须自行加引号；内嵌双引号按 Windows 命令行解析规则写成 `\"`。
 */
export function quoteForCmd(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`
}

/** 认证类失败特征（本机未登录、OAuth 过期、API key 无效）。 */
const AUTH_RE =
  /not logged in|please run \/login|OAuth session expired|Failed to authenticate|Invalid API key|authentication_error/i

export type FailureKind = 'auth' | 'timeout' | 'other'

/**
 * 失败分类：killed 为真（execFile 超时杀进程）优先判 timeout，其次按输出识别认证问题。
 * 两路输出皆空且未被杀 → null（无可判定信息，调用方不应据此下结论）。
 */
export function classifyFailure(stdout: string, stderr: string, killed = false): FailureKind | null {
  if (killed) return 'timeout'
  const merged = `${stdout ?? ''}\n${stderr ?? ''}`
  if (AUTH_RE.test(merged)) return 'auth'
  return merged.trim() ? 'other' : null
}
