# ChatArk

Claude Code 历史对话管理平台（Electron 桌面应用）。直观浏览、分类、搜索、管理本机导出的历史对话 HTML，并可补录与自动导出新会话。

- **液态玻璃界面**：Apple Liquid Glass 风格外壳；亮 / 暗 / 跟随系统三态主题，与对话 HTML 自身主题对齐。
- **文件即数据（类 Obsidian）**：磁盘文件夹即唯一数据源。改分类 = 移动对话目录；删除 = 移入系统回收站（可恢复）。
- **原样查看**：对话 HTML 在 `convo://` 协议 + 沙箱 iframe 中原样呈现，首屏注入主题、零闪烁；死链中和、严格 CSP。
- **全文搜索**：纯 TS 内存全文索引，可搜标题与正文，零原生依赖；增量重建，实测 274 篇对话查询约 15ms。
- **补录三入口**：自动扫描登记现有库、拖拽/选择导入对话包、扫描原始会话补导出。
- **内置导出器**：从 Python `chat_export` 忠实移植为 TypeScript，随包自带、装了即用、无需 Python；对历史库做过逐字节黄金样本回归。
- **一键自动导出**：可在 Claude Code 的 `~/.claude/settings.json` 安装 SessionEnd 钩子，新会话结束自动入库。
- **保存路径可迁移**：更换库根时复制-校验-切换-旧路径移入回收站，校验通过前绝不动旧数据；不接受主目录、桌面、文稿等个人数据总入口作为库根。

## 下载

预构建包见 [Releases](https://github.com/Chin-Jing1998/chatark/releases/latest)，三平台齐全。

**Windows**

| 文件 | 适用 |
|---|---|
| `ChatArk-Setup-<版本>-x64.exe` | Intel / AMD 处理器，安装版（多数人选这个） |
| `ChatArk-Setup-<版本>-arm64.exe` | ARM 处理器（如骁龙 X 系列），安装版 |
| `ChatArk-Setup-<版本>.exe` | 通用版，同时含两种架构，体积约为单架构两倍 |
| `ChatArk-Portable-<版本>-*.exe` | 免安装便携版，双击即用，不写注册表 |

**macOS**

| 文件 | 适用 |
|---|---|
| `ChatArk-<版本>-arm64.dmg` | Apple Silicon（M 系列芯片） |
| `ChatArk-<版本>-x64.dmg` | Intel 芯片 |

**Linux**

| 文件 | 适用 |
|---|---|
| `ChatArk-<版本>-x86_64.AppImage` | x86_64，`chmod +x` 后双击即用 |
| `ChatArk-<版本>-arm64.AppImage` | ARM64，同上 |
| `ChatArk-<版本>-amd64.deb` | Debian / Ubuntu 系，x86_64 |
| `ChatArk-<版本>-arm64.deb` | Debian / Ubuntu 系，ARM64 |

均未做代码签名：Windows 的 SmartScreen 会提示「未知发布者」，点击「更多信息 → 仍要运行」；macOS 首次打开需右键点图标选「打开」以绕过 Gatekeeper。

所有产物均由 [GitHub Actions](.github/workflows/release.yml) 在三平台并行构建，推 `v*` tag 即自动发布。

应用完全离线：不联网、不上传任何数据、无遥测与自动更新。

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

> **分享对话包前请自行核查内容。** 导出包忠实归档整场会话，因此：
> `transcript.jsonl` 是**原始全量转录**（不截断、不脱敏），包含所有工具调用的完整入参与返回——
> 读取过的文件内容、执行过的命令与输出，其中可能含密钥、凭据或其他私密信息；
> `meta.json` 与 `data.js` 另含项目工作目录的**绝对路径（含你的用户名）**、转录源路径与 Git 分支名。
> 应用本身不联网、不上传任何数据，但这些文件一旦随对话包交给他人，上述内容即一并交出。
- 类别以**物理父目录**为准；`meta.category` 仅导出时初值。
- 搜索索引为**内存态**，不落盘、不写入历史库，保证“库内无隐藏状态”，迁移无需搬索引；重启后按需重建。
  重扫后按文件指纹增量更新，只重读内容真正变化的对话。

> 第三方独立工具，与 Anthropic 官方无关。
