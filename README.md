# ChatArk

Claude Code 历史对话管理平台（Electron 桌面应用）。直观浏览、分类、搜索、管理本机导出的历史对话 HTML，并可补录与自动导出新会话。

- **液态玻璃界面**：Apple Liquid Glass 风格外壳；亮 / 暗 / 跟随系统三态主题，与对话 HTML 自身主题对齐。
- **文件即数据（类 Obsidian）**：磁盘文件夹即唯一数据源。改分类 = 移动对话目录；删除 = 移入系统回收站（可恢复）。
- **原样查看**：对话 HTML 在 `convo://` 协议 + 沙箱 iframe 中原样呈现，首屏注入主题、零闪烁；死链中和、严格 CSP。
- **全文搜索**：纯 TS trigram 倒排索引，可搜标题与正文，零原生依赖。
- **补录三入口**：自动扫描登记现有库、拖拽/选择导入对话包、扫描原始会话补导出。
- **内置导出器**：从 Python `chat_export` 忠实移植为 TypeScript，随包自带、装了即用、无需 Python；对历史库做过逐字节黄金样本回归。
- **一键自动导出**：可在 Claude Code 的 `~/.claude/settings.json` 安装 SessionEnd 钩子，新会话结束自动入库。
- **保存路径可迁移**：更换库根时复制-校验-切换-删源安全迁移全部内容，校验通过前绝不删旧数据。

## 开发

```bash
npm install
npm run dev          # 启动开发版（Electron + Vite HMR）
npm run typecheck    # tsc 全工程类型检查
npm test             # Vitest 单元 + 黄金样本回归
```

## 构建与分发

```bash
npm run build        # 仅产出 out/（main/preload/renderer）
npm run dist:mac     # 打包 .dmg（macOS）
npm run dist:win     # 打包 .exe（Windows, NSIS）
npm run dist:linux   # 打包 AppImage + deb（Linux）
```

产物在 `release/`。无原生模块，跨平台打包无需重编译。未签名的 macOS 版首次打开需右键“打开”绕过 Gatekeeper。

## 架构

```
src/
├─ main/           主进程：窗口、convo:// 协议、IPC、文件服务、迁移、内置导出器
│  ├─ protocol/    convo:// 注册与 HTML 注入（主题 / embed / 中和 file:// / CSP）
│  ├─ services/
│  │  ├─ fs/       scan / parse-dir / move / trash / rename / watch / paths
│  │  ├─ search/   纯 TS trigram 全文索引
│  │  ├─ org/      置顶 / 收藏 / 归档 / 标签（chatark.json sidecar）
│  │  ├─ migration/路径迁移（复制-校验-切换-删源）
│  │  ├─ backfill/ 补录：扫描原始会话 / 导入对话包
│  │  ├─ hook/     SessionEnd 自动导出钩子安装/卸载
│  │  └─ exporter/ 内置 TS 导出器（移植自 chat_export）
│  ├─ ipc/         按域分文件注册 IPC
│  └─ export-headless.ts  无界面导出（--export / --export-stdin）
├─ preload/        contextBridge 暴露白名单 window.api
├─ renderer/       React 界面：四区液态玻璃布局
│  └─ src/{app,features,lib,styles}
└─ shared/         跨进程契约（types / api / ipc-channels / viewer / constants）
```

## 数据约定

- 历史库默认根：`~/claude code 编程项目研究/claude code历史对话记录`（可在设置中更换）。
- 每个对话是一个目录 `日期_时间_标题_哈希8`，含 `对话.html / transcript.jsonl / data.js / 对话.md / meta.json`；平台另写 `chatark.json` 记录组织元数据。
- 类别以**物理父目录**为准；`meta.category` 仅导出时初值。
- 索引库（搜索）落在应用 userData 目录，不写入历史库，保证“库内无隐藏状态”，迁移不搬索引。

> 第三方独立工具，与 Anthropic 官方无关。
