/** IPC 通道名常量，main 与 preload 共用，杜绝字符串漂移。 */
export const IPC = {
  // 主题
  themeSet: 'theme:set',
  themeChanged: 'theme:changed',
  /** 设置对话页注入令牌（预设配色）——主进程据此在 convo:// 注入首屏 <style> */
  themeSetTokens: 'theme:setTokens',
  // 对话
  convList: 'conv:list',
  convGet: 'conv:get',
  convRescan: 'conv:rescan',
  convMove: 'conv:move',
  convTrash: 'conv:trash',
  convRename: 'conv:rename',
  convSetOrg: 'conv:setOrg',
  convReveal: 'conv:reveal',
  convOpenExternal: 'conv:openExternal',
  convRelocateUncategorized: 'conv:relocateUncategorized',
  // 任意文件：在系统文件管理器中定位（用于应用内打开的生成文件）
  fileReveal: 'file:reveal',
  // 搜索
  searchQuery: 'search:query',
  // 库
  libraryGetRoot: 'library:getRoot',
  libraryPickRoot: 'library:pickRoot',
  librarySetRoot: 'library:setRoot',
  // 补录
  backfillScanRaw: 'backfill:scanRaw',
  backfillReexport: 'backfill:reexport',
  backfillPickImport: 'backfill:pickImport',
  backfillImport: 'backfill:import',
  // 自动导出钩子
  hookStatus: 'hook:status',
  hookInstall: 'hook:install',
  hookUninstall: 'hook:uninstall',
  // UI 原生对话框
  uiConfirm: 'ui:confirm',
  // 事件（main → renderer 单向推送）
  evtLibrary: 'evt:library',
  evtIndex: 'evt:index',
  evtMigration: 'evt:migration',
  evtBackfill: 'evt:backfill',
  /** 菜单加速键（⌘O/⌘K/⌘R）触发：请渲染层打开命令面板。菜单加速键在对话 iframe 聚焦时仍生效。 */
  evtOpenCommand: 'evt:open-command'
} as const
