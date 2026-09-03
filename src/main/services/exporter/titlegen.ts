/**
 * LLM 主题标题生成：调用本机 claude CLI（claude -p）按对话内容 + 项目路径生成
 * ≤12 字中文标题。任何失败（未安装 / 未登录 / 超时 / 非 JSON）均返回 null，
 * 由调用方回退到 fallbackTitle 本地规则，绝不抛异常。
 *
 * 认证前提：claude CLI 已登录（claude /login），或进程环境含 ANTHROPIC_API_KEY。
 * 子进程环境按白名单裁剪（见 titlegen-env.ts），不继承宿主会话的认证标记。
 * 认证类失败写文件冷却：钩子链路每场会话一个新进程，进程级缓存起不到抑制作用。
 */
import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { resolveUserDataDir } from '../app-paths'
import { sanitizeTitleForDir } from '../fs/paths'
import * as textutil from './textutil'
import {
  claudeArgs,
  classifyFailure,
  quoteForCmd,
  sanitizeEnvForClaude,
  TITLEGEN_ENV_MARK
} from './titlegen-env'

export { TITLEGEN_ENV_MARK }

export interface TitleSource {
  cwd: string
  /** 会话前若干消息的纯文本（已归一），由调用方准备 */
  text: string
  /** 现有标题（buildConversation 后 titler 产物 / meta.title），LLM 失败时回退 */
  existingTitle?: string
}

const MAX_TITLE_LEN = 12
/** cwd 目录名回退可略长（如 "CN2410062（保险）" 13 码点），保证项目主题完整 */
const MAX_DIR_TITLE_LEN = 16
const SINGLE_BUDGET = 6000 // 单条输入字符预算
const BATCH_BUDGET = 1500 // 批量时每条预算（标题只需梗概，避免单 prompt 过大）
export const BATCH_SIZE = 12

/**
 * 自动会话注入 prompt 的污染前缀（现库 "Below is a conversation log fr..." 即此类）。
 * 后两项是本模块自身的 prompt：titlegen 派生的 claude 会话会被钩子回捞导出，
 * 据此在导出门槛处识别并跳过，避免无限自激。
 */
const POLLUTION_RE =
  /^(Analyze this conversation|Below is a conversation log|Below is a conversation|Please analyze|Analyze the|你是对话标题生成器|为下面\s*\d+\s*个对话各生成)/i

/** 文本（首条用户消息或现有标题）是否为自动注入 prompt。 */
export function isPollutedPrompt(text: string): boolean {
  return POLLUTION_RE.test((text ?? '').trim())
}

/**
 * LLM 失败后是否允许用本地回退标题改名：仅限现有标题本就无效的情形
 * （空 / 未命名会话 / 自动注入 prompt 污染）。正常标题一律保留，
 * 否则 fallbackTitle 的 12 码点截断会不可逆地毁掉全库标题。
 */
export function isFallbackAllowed(title: string | undefined): boolean {
  const t = (title ?? '').trim()
  return !t || t === '未命名会话' || isPollutedPrompt(t)
}

/** 认证失败后的冷却时长：期间所有进程跳过 LLM，直接走本地标题。 */
const COOLDOWN_MS = 30 * 60 * 1000

interface CooldownData {
  reason: string
  until: number
}

function cooldownPath(): string {
  return join(resolveUserDataDir(), 'titlegen-cooldown.json')
}

/**
 * 进程内快捷标志：已知在冷却中就不再反复读文件。
 * 连同路径一起记，userData 被切换（测试注入 CHATARK_USER_DATA）时自然失效。
 */
let cooldownMemo: { path: string; until: number } | null = null

/** 是否处于认证失败冷却期。文件缺失、损坏或已过期一律按未冷却处理。 */
export function isCoolingDown(): boolean {
  const p = cooldownPath()
  if (cooldownMemo && cooldownMemo.path === p && cooldownMemo.until > Date.now()) return true
  try {
    const data = JSON.parse(readFileSync(p, 'utf8')) as CooldownData
    if (typeof data.until !== 'number' || data.until <= Date.now()) return false
    cooldownMemo = { path: p, until: data.until }
    return true
  } catch {
    return false
  }
}

/**
 * 记录冷却（认证类失败触发）。写失败静默：冷却只是节流优化。
 * 先写 `.tmp` 再 rename：并发的多个 worker 同时写时，读方只会看到完整 JSON，
 * 不会读到半截内容而把冷却误判为"文件损坏 → 未冷却"。
 */
export function markCoolingDown(reason: string, ttlMs = COOLDOWN_MS): void {
  const p = cooldownPath()
  const until = Date.now() + ttlMs
  cooldownMemo = { path: p, until }
  const tmp = `${p}.${process.pid}.tmp`
  try {
    mkdirSync(resolveUserDataDir(), { recursive: true })
    writeFileSync(tmp, JSON.stringify({ reason, until } satisfies CooldownData), 'utf8')
    renameSync(tmp, p)
  } catch {
    /* 冷却写不进去时退化为进程内标志 */
  }
}

/** 按码点切片（中文/emoji 不被腰斩）。 */
function sliceCodepoints(s: string, max: number): string {
  const arr = Array.from(s)
  return arr.length <= max ? s : arr.slice(0, max).join('')
}

/**
 * 候选路径是否真的可执行：必须是普通文件且有执行位。
 * 仅 existsSync 会把 PATH 中的同名目录（如 `~/bin/claude/`）当成可执行文件，
 * spawn 时才以 EACCES 失败，且失败信息落不到用户眼前。win32 无 X_OK 语义，只查文件。
 */
function isExecutableFile(p: string): boolean {
  try {
    if (!statSync(p).isFile()) return false
    if (process.platform !== 'win32') accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** claude CLI 定位：CHATARK_CLAUDE_BIN 显式覆盖（缺失即视为不可用）；否则 PATH 优先，再探测常见安装目录。 */
export function findClaudeBin(env: NodeJS.ProcessEnv = process.env): string | null {
  // 显式覆盖即权威：指向不存在的路径时不再回退扫 PATH，等价于"禁用 LLM 起名"的开关
  const override = env['CHATARK_CLAUDE_BIN']
  if (override) return isExecutableFile(override) ? override : null
  const dirs = [join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
  // Windows 的 PATH 以 ';' 分隔且 claude 带 .cmd/.exe 扩展名，写死 ':' + 无扩展名会恒定找不到。
  // .exe 排在 .cmd 之前：原生二进制可免 shell 直接 spawn，批处理则必须过 cmd.exe。
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude']
  for (const d of [...(env['PATH'] ?? '').split(delimiter), ...dirs]) {
    for (const n of names) {
      const p = join(d, n)
      if (isExecutableFile(p)) return p
    }
  }
  return null
}

/** 空 MCP 配置：非 win32 直接传内联 JSON；win32 可能经 cmd.exe（内联引号会被吞），一律落成文件传路径。 */
const EMPTY_MCP_INLINE = '{"mcpServers":{}}'

function emptyMcpConfigArg(): string {
  if (process.platform !== 'win32') return EMPTY_MCP_INLINE
  const p = join(resolveUserDataDir(), 'mcp-empty.json')
  try {
    if (!existsSync(p)) {
      mkdirSync(resolveUserDataDir(), { recursive: true })
      writeFileSync(p, EMPTY_MCP_INLINE, 'utf8')
    }
    return p
  } catch {
    return EMPTY_MCP_INLINE
  }
}

/** 子进程输出上限：标题只有十几个字，超此量即为异常输出，读满即杀。 */
const MAX_OUTPUT_BYTES = 64 * 1024

/**
 * Windows 的 `.cmd`/`.bat` 必须经 cmd.exe：Node ≥18.20 起（CVE-2024-27980 修复）
 * 不带 shell 直接 spawn 批处理会抛 EINVAL。其余情形一律不过 shell。
 */
function needsCmdShell(bin: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)
}

interface ClaudeRunResult {
  stdout: string
  stderr: string
  /** 非零退出、spawn 失败、超时或输出超限——任一为真即不可采信 stdout */
  failed: boolean
  /** 因超时被杀 */
  killed: boolean
  /** 输出超过 MAX_OUTPUT_BYTES 被截断并杀进程 */
  overflow: boolean
}

/**
 * 拉起 claude 子进程并把 prompt 写入其 stdin，收集两路输出。绝不抛异常。
 *
 * prompt 走 stdin 而非 argv：`claude -p` 无位置参数时从 stdin 读取（已实测），
 * 因而 6000 字的对话正文既不受命令行长度上限约束，也不会在 win32 经 cmd.exe 时
 * 被 `&`、`|`、`>`、`%VAR%` 等元字符改写语义。
 */
function spawnClaude(
  bin: string,
  args: readonly string[],
  opts: { prompt: string; timeoutMs: number; useShell: boolean }
): Promise<ClaudeRunResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, [...args], {
      cwd: tmpdir(),
      // 环境按白名单裁剪并带上 CHATARK_TITLEGEN 标记：即便派生会话仍跑到钩子，无头导出也会据此早退。
      // 钩子本身由 claudeArgs 的 `--setting-sources ""` 关掉（已实测：用户级 settings 整体不加载，
      // SessionStart / UserPromptSubmit / SessionEnd 钩子一个不触发）；--bare 也能关但会禁用 OAuth 登录态。
      env: sanitizeEnvForClaude(process.env),
      shell: opts.useShell,
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''
    let bytes = 0
    let exitCode: number | null = 0
    let killed = false
    let overflow = false
    let spawnFailed = false
    let settled = false

    const kill = (): void => {
      try {
        child.kill()
      } catch {
        /* 进程已退出 */
      }
    }
    const collect = (which: 'out' | 'err') => (chunk: Buffer | string): void => {
      const text = String(chunk)
      if (which === 'out') stdout += text
      else stderr += text
      bytes += Buffer.byteLength(text)
      if (bytes > MAX_OUTPUT_BYTES) {
        overflow = true
        kill()
      }
    }

    const timer = setTimeout(() => {
      killed = true
      kill()
    }, opts.timeoutMs)
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ stdout, stderr, failed: spawnFailed || killed || overflow || exitCode !== 0, killed, overflow })
    }

    child.stdout?.on('data', collect('out'))
    child.stderr?.on('data', collect('err'))
    // 桩/真实 CLI 都可能不读 stdin 就退出，此时写入触发 EPIPE：吞掉，交由退出码判定
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(opts.prompt)
    child.on('error', (e: Error) => {
      spawnFailed = true
      stderr += `${e.message}\n`
      finish()
    })
    child.on('close', (code) => {
      exitCode = code
      finish()
    })
  })
}

/**
 * 子进程调用 claude -p（prompt 经 stdin 传入）。失败/未登录/超时返回 null。
 *
 * cwd 固定为系统临时目录：在会话项目目录下启动会加载该项目的 CLAUDE.md 与 .mcp.json 全部
 * MCP 服务器，既慢又可能失败。环境按白名单裁剪，避免继承宿主会话的 OAuth 标记。
 */
async function runClaude(bin: string, prompt: string, timeoutMs: number): Promise<string | null> {
  const useShell = needsCmdShell(bin)
  const args = claudeArgs({ mcpConfig: emptyMcpConfigArg(), viaShell: useShell })
  // 经 cmd.exe 时 Node 只做字符串拼接，含空格的取值（当前只有 --mcp-config 的文件路径）须自行加引号
  const line = useShell ? args.map((a) => (/\s/.test(a) ? quoteForCmd(a) : a)) : args
  const res = await spawnClaude(bin, line, { prompt, timeoutMs, useShell })
  // 输出超限优先判为 other：截断后的文本不足以支撑任何结论，尤其不该据此进入认证冷却
  const kind = res.overflow ? 'other' : classifyFailure(res.stdout, res.stderr, res.killed)
  if (kind === 'auth') {
    markCoolingDown('auth')
    return null
  }
  return res.failed ? null : res.stdout
}

/** 输出清洗：剥围栏/引号、压空白、去尾部标点，净化后限长；无效返回 null。 */
export function cleanTitle(raw: string, maxLen = MAX_TITLE_LEN): string | null {
  let t = (raw ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[。，、！？；：.。,，!?;:]+$/, '')
  if (!t) return null
  const s = sanitizeTitleForDir(textutil.cleanInline(t))
  return s === '未命名会话' ? null : trimTrailingOpenParen(sliceCodepoints(s, maxLen))
}

/** 截断可能把 "CN2410062（保险）" 切成悬空开括号，去尾部未配对的开括号。 */
function trimTrailingOpenParen(s: string): string {
  return s.replace(/[（\[「『《([{]+$/, '')
}

/** LLM 失败/未安装/超时时的本地回退：现有标题（未污染）→ cwd 末 1-2 级目录名 → '未命名会话'。 */
export function fallbackTitle(src: TitleSource): string {
  const existing = textutil.cleanInline(src.existingTitle ?? '')
  // 污染标题（自动会话注入 prompt）整体视为无效，不走剥离残留
  if (existing && existing !== '未命名会话' && !isPollutedPrompt(existing)) {
    return sliceCodepoints(sanitizeTitleForDir(existing), MAX_TITLE_LEN)
  }
  const seg = (src.cwd || '').replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
  for (let i = seg.length - 1; i >= Math.max(0, seg.length - 2); i--) {
    const name = seg[i]
    if (name && name !== '~' && name !== '.') {
      return trimTrailingOpenParen(sliceCodepoints(sanitizeTitleForDir(name), MAX_DIR_TITLE_LEN))
    }
  }
  return '未命名会话'
}

/** 单条标题生成。 */
export async function generateTitle(
  src: TitleSource,
  opts?: { claudeBin?: string; timeoutMs?: number }
): Promise<string | null> {
  if (isCoolingDown()) return null
  const bin = opts?.claudeBin ?? findClaudeBin()
  if (!bin) return null
  const prompt = [
    '你是对话标题生成器。根据下面的项目路径与对话内容，用中文生成一个不超过 12 个字的主题标题。',
    '规则：只输出标题本身，不要引号、标点、解释、编号。',
    `项目路径: ${src.cwd || '(未知)'}`,
    '对话内容:',
    src.text.slice(0, SINGLE_BUDGET)
  ].join('\n')
  const out = await runClaude(bin, prompt, opts?.timeoutMs ?? 15000)
  return out === null ? null : cleanTitle(out)
}

/** 批量标题生成：每批 BATCH_SIZE 条合一次 claude -p，要求输出 JSON 数组；失败项返回 null。 */
export async function generateTitles(
  items: TitleSource[],
  batchSize = BATCH_SIZE,
  opts?: { claudeBin?: string; timeoutMs?: number }
): Promise<(string | null)[]> {
  const out: (string | null)[] = new Array(items.length).fill(null)
  if (items.length === 0 || isCoolingDown()) return out
  const bin = opts?.claudeBin ?? findClaudeBin()
  if (!bin) return out
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize)
    const prompt = [
      `为下面 ${chunk.length} 个对话各生成一个中文主题标题（每个不超过 12 个字，不要引号/标点/解释）。`,
      `只输出一个 JSON 数组，形如 [{"index":0,"title":"..."},...]，共 ${chunk.length} 项，不要其他文字：`,
      JSON.stringify(
        chunk.map((it, k) => ({ index: i + k, cwd: it.cwd, content: it.text.slice(0, BATCH_BUDGET) }))
      )
    ].join('\n')
    const raw = await runClaude(bin, prompt, opts?.timeoutMs ?? 20000)
    const parsed = parseBatchJson(raw)
    for (const [k, title] of parsed) {
      // 模型可能回传越界/小数 index：直接采信会写错槽位或把 out 撑成稀疏数组
      if (!Number.isInteger(k) || k < i || k >= i + chunk.length) continue
      const c = cleanTitle(title)
      if (c) out[k] = c
    }
  }
  return out
}

/**
 * 容错解析批量 JSON：剥代码围栏 → 取首 '[' 至尾 ']' → JSON.parse；
 * 失败再退正则逐条抠 "title":"..."。返回 Map<index, 原始标题串>。
 */
export function parseBatchJson(raw: string | null): Map<number, string> {
  const out = new Map<number, string>()
  if (!raw) return out
  // 只剥 ```json 围栏标记，保留围栏内的 JSON 内容
  let text = raw.replace(/```(?:json)?/g, '').trim()
  const first = text.indexOf('[')
  const last = text.lastIndexOf(']')
  if (first >= 0 && last > first) {
    try {
      const arr = JSON.parse(text.slice(first, last + 1)) as unknown
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item && typeof item === 'object') {
            const rec = item as Record<string, unknown>
            if (typeof rec['index'] === 'number' && typeof rec['title'] === 'string') {
              out.set(rec['index'], rec['title'])
            }
          }
        }
        return out
      }
    } catch {
      // 落到正则兜底
    }
  }
  const re = /\{\s*"index"\s*:\s*(\d+)\s*,\s*"title"\s*:\s*"((?:\\.|[^"\\])*)"\s*\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const idx = Number(m[1])
    const title = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    if (Number.isFinite(idx) && title) out.set(idx, title)
  }
  return out
}

/** 从事件序列拼接前若干条消息文本至预算（导出场景无需重读原始 JSONL）。 */
export function sampleEventText(events: Array<{ etype: string; text: string }>, maxChars = SINGLE_BUDGET): string {
  let out = ''
  for (const e of events) {
    if (!e.text.trim()) continue
    out += (out ? '\n' : '') + e.text
    if (out.length >= maxChars) return out.slice(0, maxChars)
  }
  return out
}
