/** 导出包的标准文件名（含中文名），单一来源。 */
export const FILE_NAMES = {
  html: '对话.html',
  jsonl: 'transcript.jsonl',
  dataJs: 'data.js',
  md: '对话.md',
  meta: 'meta.json'
} as const

/** 平台组织元数据 sidecar 文件名 */
export const ORG_SIDECAR = 'chatark.json'

/** 对话目录名规则：YYYYMMDD_HHMMSS_标题_8位哈希 */
export const DIR_NAME_RE = /^(\d{8})_(\d{6})_(.+)_([0-9a-f]{8})$/

/** 默认历史库根（相对用户主目录），与 chat_export/paths.py 一致 */
export const DEFAULT_LIBRARY_REL = ['claude code 编程项目研究', 'claude code历史对话记录'] as const

/** 应用标识 */
export const APP_NAME = 'ChatArk'
