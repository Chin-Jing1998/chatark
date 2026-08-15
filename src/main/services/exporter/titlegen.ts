/**
 * LLM 主题标题生成：调用本机 claude CLI（claude -p）按对话内容 + 项目路径生成
 * ≤12 字中文标题。任何失败（未安装 / 未登录 / 超时 / 非 JSON）均返回 null，
 * 由调用方回退到 fallbackTitle 本地规则，绝不抛异常。
 *
 * 认证前提：claude CLI 已登录（claude /login），或进程环境含 ANTHROPIC_API_KEY。
 * 两者皆缺时 "Not logged in" 会被识别并缓存，后续直接走本地回退。
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'

import { sanitizeTitleForDir } from '../fs/paths'
import * as textutil from './textutil'

const execFileAsync = promisify(execFile)

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
 * titlegen 子进程环境标记：随 claude 子进程传递，claude 的 SessionEnd 钩子进程会继承它。
 * 无头导出见到该标记即拒绝导出，是自激循环的第一道防线（第二道见 POLLUTION_RE）。
 */
export const TITLEGEN_ENV_MARK = 'CHATARK_TITLEGEN'

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

const NOT_LOGGED_IN_RE = /not logged in|please run \/login/i

/** 认证不可用的进程级缓存：识别一次后不再反复试错消耗超时。 */
let claudeUnavailable = false

/** 按码点切片（中文/emoji 不被腰斩）。 */
function sliceCodepoints(s: string, max: number): string {
  const arr = Array.from(s)
  return arr.length <= max ? s : arr.slice(0, max).join('')
}

/** claude CLI 定位：PATH 优先，再探测常见安装目录；支持 CHATARK_CLAUDE_BIN 覆盖。 */
export function findClaudeBin(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env['CHATARK_CLAUDE_BIN']
  if (override && existsSync(override)) return override
  const dirs = [join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
  // Windows 的 PATH 以 ';' 分隔且 claude 带 .cmd/.exe 扩展名，写死 ':' + 无扩展名会恒定找不到
  const names = process.platform === 'win32' ? ['claude.cmd', 'claude.exe', 'claude'] : ['claude']
  for (const d of [...(env['PATH'] ?? '').split(delimiter), ...dirs]) {
    for (const n of names) {
      const p = join(d, n)
      if (existsSync(p)) return p
    }
  }
  return null
}

/** 子进程调用 claude -p（prompt 走 argv，不依赖 stdin 行为）。失败/未登录/超时返回 null。 */
async function runClaude(bin: string, prompt: string, timeoutMs: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(bin, ['-p', '--output-format', 'text', prompt], {
      timeout: timeoutMs,
      maxBuffer: 64 * 1024,
      // 标记随 claude 子进程传给它的 SessionEnd 钩子，无头导出据此拒绝导出本次派生会话。
      // 实测 claude 无参数可关钩子：--settings '{"hooks":{}}' 与 '{"hooks":{"SessionEnd":[]}}'
      // 均按合并语义处理、钩子照常触发；--bare 能关但同时禁用 OAuth 登录态，会让本功能失效。
      env: { ...process.env, [TITLEGEN_ENV_MARK]: '1' },
      // ponytail: win32 的 claude 多为 .cmd 批处理，execFile 不经 shell 无法执行；
      // Node ≥18.20 已为 cmd.exe 转义参数，若日后要彻底不过 shell 可改走 stdin 传 prompt
      shell: process.platform === 'win32'
    })
    if (NOT_LOGGED_IN_RE.test(stdout)) {
      claudeUnavailable = true
      return null
    }
    return stdout
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string }
    if (err?.stderr && NOT_LOGGED_IN_RE.test(err.stderr)) claudeUnavailable = true
    return null
  }
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
  if (claudeUnavailable) return null
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
  if (claudeUnavailable || items.length === 0) return out
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
