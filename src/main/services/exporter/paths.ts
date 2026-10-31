/**
 * 导出器常量与基础路径。集中管理，避免散落各处。
 *
 * 自 chat_export/paths.py 移植相关常量。历史库根目录不在此固化（由 exportSession 入参
 * 传入），此处仅保留解析/截断/gate 阈值与 Claude Code 转录源目录。
 */
import os from 'node:os'
import path from 'node:path'

const HOME = os.homedir()

// Claude Code 转录根目录
export const PROJECTS_ROOT = path.join(HOME, '.claude', 'projects')
// 活跃会话元数据目录
export const SESSIONS_ROOT = path.join(HOME, '.claude', 'sessions')
// Codex 转录根目录（按年/月/日分层的活跃与近期会话）
export const CODEX_SESSIONS_ROOT = path.join(HOME, '.codex', 'sessions')
// Codex 归档会话目录
export const CODEX_ARCHIVED_ROOT = path.join(HOME, '.codex', 'archived_sessions')
// Codex 会话标题索引文件
export const CODEX_SESSION_INDEX = path.join(HOME, '.codex', 'session_index.jsonl')

// 这些工具的"返回"实为 Claude 撰写的 Markdown 内容（计划/子代理报告/技能正文），
// 应按 Markdown 渲染而非原始代码块
export const MARKDOWN_TOOLS: readonly string[] = ['ExitPlanMode', 'Agent', 'Skill', 'Task']

// 截断阈值（字节）
export const TRUNCATE_LIMIT_DOC = 50 * 1024 // md 文档工具返回截断阈值
export const TRUNCATE_LIMIT_DATA = 200 * 1024 // data.js

// gate 阈值：至少 1 条助手回复 + 至少 2 条实质消息
export const MIN_ASSISTANT = 1
export const MIN_SUBSTANTIVE = 2

// 导出包内 5 个标准文件名
export const MD_NAME = '对话.md'
export const HTML_NAME = '对话.html'
export const JS_NAME = 'data.js'
export const META_NAME = 'meta.json'
export const TRANSCRIPT_NAME = 'transcript.jsonl'
