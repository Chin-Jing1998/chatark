import { app } from 'electron'
import { exportSession, listSessions } from './services/exporter'
import { isMigrationLocked } from './services/migration/lock'
import { getLibraryRoot } from './services/settings/store'

interface HeadlessArgs {
  mode: 'path' | 'session' | 'stdin'
  value?: string
}

/** 解析无界面导出参数：--export <jsonl|sessionId> 或 --export-stdin（从 stdin 读 SessionEnd JSON）。 */
export function parseHeadlessArgs(argv: string[]): HeadlessArgs | null {
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
 * 无界面导出：供自动导出钩子（--export-stdin）与脚本（--export <id|path>）调用。
 * 运行后直接退出，不创建窗口。
 */
export async function runHeadlessExport(args: HeadlessArgs): Promise<void> {
  // 迁移进行中：让路。此时写入旧库根的会话不在迁移的文件快照内，会被删源一并清掉。
  // 退出码取 0——自动导出钩子失败会打断用户的 Claude Code 会话，而"这次没导出"并非错误。
  if (isMigrationLocked()) {
    process.stderr.write('历史库正在迁移，本次跳过自动导出（迁移完成后可在补录面板补导出）\n')
    app.exit(0)
    return
  }

  let code = 1
  try {
    const jsonl = await resolveJsonl(args)
    if (!jsonl) {
      process.stderr.write('未能确定要导出的转录路径\n')
    } else {
      const r = await exportSession({ sourceJsonl: jsonl, historyRoot: getLibraryRoot() })
      process.stdout.write(`${JSON.stringify(r)}\n`)
      code = r.ok ? 0 : 1
    }
  } catch (e) {
    process.stderr.write(`导出异常：${e instanceof Error ? e.message : e}\n`)
  } finally {
    app.exit(code)
  }
}
