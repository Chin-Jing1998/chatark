import { app } from 'electron'
import { exportSession, listSessions } from './services/exporter'
import { runLibraryMaintain } from './services/library-maintain'
import { isMigrationLocked } from './services/migration/lock'
import { getLibraryRoot } from './services/settings/store'

interface HeadlessArgs {
  mode: 'path' | 'session' | 'stdin' | 'maintain'
  value?: string
  dryRun?: boolean
  limit?: number
}

/** 解析无界面导出参数：--export <jsonl|sessionId>、--export-stdin（SessionEnd JSON）或 --library-maintain（存量库维护）。 */
export function parseHeadlessArgs(argv: string[]): HeadlessArgs | null {
  if (argv.includes('--library-maintain')) {
    const i = argv.indexOf('--limit')
    const raw = i >= 0 ? Number(argv[i + 1]) : NaN
    return {
      mode: 'maintain',
      dryRun: argv.includes('--dry-run'),
      limit: Number.isFinite(raw) && raw > 0 ? raw : undefined
    }
  }
  if (argv.includes('--export-stdin')) return { mode: 'stdin' }
  const i = argv.indexOf('--export')
  if (i >= 0 && argv[i + 1]) {
    const v = argv[i + 1]
    return v.endsWith('.jsonl') ? { mode: 'path', value: v } : { mode: 'session', value: v }
  }
  return null
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  return new Promise((resolve) => {
    process.stdin.on('data', (c) => chunks.push(Buffer.from(c)))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', () => resolve(''))
    // 防止无 stdin 时挂死
    setTimeout(() => resolve(Buffer.concat(chunks).toString('utf8')), 3000)
  })
}

async function resolveJsonl(args: HeadlessArgs): Promise<string | null> {
  if (args.mode === 'path') return args.value ?? null
  if (args.mode === 'session') {
    const sessions = await listSessions()
    return sessions.find((s) => s.sessionId === args.value)?.path ?? null
  }
  // stdin：SessionEnd 钩子的 JSON，取 transcript_path
  const raw = await readStdin()
  try {
    const obj = JSON.parse(raw) as { transcript_path?: string }
    return obj.transcript_path ?? null
  } catch {
    return null
  }
}

/**
 * 无头模式的 stdout/stderr 可能被上游提前关闭：SessionEnd 异步钩子场景下，
 * Claude Code 会话结束即断开管道，写入会触发 EPIPE。未监听 stream error 时
 * 该错误成为未捕获异常并弹出异常框，故此处静默预期中的 EPIPE。
 */
function silenceEpipe(): void {
  const ignore = (e: NodeJS.ErrnoException): void => {
    if (e?.code !== 'EPIPE') console.error('无头导出输出失败：', e)
  }
  process.stdout.on('error', ignore)
  process.stderr.on('error', ignore)
}

/** 写入并等待落盘；上游已关管道（EPIPE）时回调仍被调用，配合 silenceEpipe 正常收尾，避免 app.exit 截断未写完的缓冲。 */
function writeAndFlush(stream: NodeJS.WriteStream, text: string): Promise<void> {
  return new Promise((resolve) => {
    stream.write(text, () => resolve())
  })
}

/**
 * 无界面导出：供自动导出钩子（--export-stdin）与脚本（--export <id|path>）调用。
 * 运行后直接退出，不创建窗口。
 */
export async function runHeadlessExport(args: HeadlessArgs): Promise<void> {
  silenceEpipe()

  // 迁移进行中：让路。此时写入旧库根的会话不在迁移的文件快照内，会被删源一并清掉。
  // 退出码取 0——自动导出钩子失败会打断用户的 Claude Code 会话，而"这次没导出"并非错误。
  if (isMigrationLocked()) {
    await writeAndFlush(process.stderr, '历史库正在迁移，本次跳过自动导出（迁移完成后可在补录面板补导出）\n')
    app.exit(0)
    return
  }

  let code = 1
  try {
    const jsonl = await resolveJsonl(args)
    if (!jsonl) {
      await writeAndFlush(process.stderr, '未能确定要导出的转录路径\n')
    } else {
      const r = await exportSession({ sourceJsonl: jsonl, historyRoot: getLibraryRoot(), titleMode: 'llm' })
      await writeAndFlush(process.stdout, `${JSON.stringify(r)}\n`)
      code = r.ok || r.skipped ? 0 : 1
    }
  } catch (e) {
    await writeAndFlush(process.stderr, `导出异常：${e instanceof Error ? e.message : e}\n`)
  } finally {
    app.exit(code)
  }
}

/** 存量库维护（--library-maintain）：清理 haiku + 批量重命名，报告打到 stdout 后退出。 */
export async function runHeadlessMaintain(args: HeadlessArgs): Promise<void> {
  silenceEpipe()
  try {
    const report = await runLibraryMaintain(getLibraryRoot(), { dryRun: args.dryRun, limit: args.limit })
    await writeAndFlush(process.stdout, `${JSON.stringify(report, null, 2)}\n`)
    app.exit(0)
  } catch (e) {
    await writeAndFlush(process.stderr, `维护失败：${e instanceof Error ? e.message : e}\n`)
    app.exit(1)
  }
}
