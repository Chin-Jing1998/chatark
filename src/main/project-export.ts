/** 项目归档独立入口。作者：Chin_Jing1998；修订日期：2026-10-31（北京时间）。 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, closeSync, mkdirSync, openSync, statSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { exportProjectSession, type ProjectExportInput } from './services/project-export'
import { exportSession } from './services/exporter'
import { titleLockCallbacks } from './services/exporter/title-lock'
import { nowIso } from './services/exporter/timeutil'
import { waitForFileLock, releaseFileLock } from './services/fs/file-lock'
import { resolveUserDataDir } from './services/app-paths'
import { getLibraryRoot } from './services/settings/store'

process.env.TZ = 'Asia/Shanghai'
process.umask(0o077)

function resolveStateDir(transcriptPath?: string): string {
  if (process.env.CODEX_PROJECT_EXPORT_STATE) return process.env.CODEX_PROJECT_EXPORT_STATE
  if (process.env.CLAUDE_PROJECT_EXPORT_STATE) return process.env.CLAUDE_PROJECT_EXPORT_STATE
  if (transcriptPath && transcriptPath.includes('/.codex/')) {
    return join(homedir(), '.local/share/codex-project-export')
  }
  return join(homedir(), '.local/share/claude-project-export')
}

function log(fields: Record<string, unknown>, stateDir = resolveStateDir()): void {
  const logFile = join(stateDir, 'export.log')
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  try { if (statSync(logFile).size > 1024 * 1024) renameSync(logFile, logFile + '.1') } catch { /* 首次运行无日志 */ }
  appendFileSync(logFile, JSON.stringify({ time: nowIso(), ...fields }) + '\n', { mode: 0o600 })
}

async function readInput(): Promise<ProjectExportInput> {
  const timer = setTimeout(() => { process.stdin.destroy(new Error('未收到退出事件输入')) }, 1000)
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of process.stdin) {
      size += chunk.length
      if (size > 1024 * 1024) throw new Error('退出事件输入过大')
      chunks.push(Buffer.from(chunk))
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!input || typeof input !== 'object') throw new Error('退出事件输入无效')
    return { hook_event_name: input.hook_event_name, session_id: input.session_id,
      transcript_path: input.transcript_path, cwd: input.cwd }
  } finally { clearTimeout(timer) }
}

async function main(): Promise<void> {
  if (process.env.CHATARK_TITLEGEN) return
  if (process.argv[2] === '--worker') {
    const input: ProjectExportInput = JSON.parse(process.argv[3])
    const stateDir = resolveStateDir(input.transcript_path)
    const key = createHash('sha256').update(input.session_id + input.transcript_path).digest('hex')
    const lock = join(stateDir, 'locks', key + '.lock')
    if (!await waitForFileLock(lock, { staleMs: 600000, maxWaitMs: 60000 })) {
      throw new Error('等待同一会话导出超时')
    }
    try {
      const projectDir = process.env.CODEX_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR
      const result = await exportProjectSession(input, projectDir)
      let centralDir: string | undefined
      if (result.sourceClient === 'codex' && process.env.CHATARK_PROJECT_ONLY !== '1') {
        const userData = resolveUserDataDir(process.argv, process.env)
        const central = await exportSession({
          sourceJsonl: input.transcript_path,
          historyRoot: getLibraryRoot(),
          titleMode: 'llm',
          ...titleLockCallbacks(userData)
        })
        centralDir = central.dir
      }
      log({ sessionId: input.session_id, ...result, ...(centralDir ? { centralDir } : {}) }, stateDir)
    } finally { releaseFileLock(lock) }
    return
  }
  const input = await readInput()
  if (input.hook_event_name !== 'SessionEnd') return
  const stateDir = resolveStateDir(input.transcript_path)
  const logFile = join(stateDir, 'export.log')
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const fd = openSync(logFile, 'a', 0o600)
  try {
    const child = spawn(process.execPath, [__filename, '--worker', JSON.stringify(input)], {
      detached: true, stdio: ['ignore', fd, fd], env: process.env
    })
    child.on('error', (error) => log({ status: 'error', error: error.message }, stateDir))
    child.unref()
  } finally { closeSync(fd) }
}

void main().catch((error: Error) => {
  log({ status: 'error', error: error.message })
  process.exitCode = 1
})
