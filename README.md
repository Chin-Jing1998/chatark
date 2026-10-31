# ChatArk

Claude Code 历史对话管理平台（Electron 桌面应用）。直观浏览、分类、搜索、管理本机导出的历史对话 HTML，并可补录与自动导出新会话。

- **液态玻璃界面**：Apple Liquid Glass 风格外壳；亮 / 暗 / 跟随系统三态主题，与对话 HTML 自身主题对齐。
- **文件即数据（类 Obsidian）**：磁盘文件夹即唯一数据源。改分类 = 移动对话目录；删除 = 移入系统回收站（可恢复）。
- **原样查看**：对话 HTML 在 `convo://` 协议 + 沙箱 iframe 中原样呈现，首屏注入主题、零闪烁；死链中和、严格 CSP。
- **全文搜索**：纯 TS 内存全文索引，可搜标题与正文，零原生依赖；增量重建，实测 274 篇对话查询约 15ms。
- **补录三入口**：自动扫描登记现有库、拖拽/选择导入对话包、扫描原始会话补导出。
- **内置导出器**：从 Python `chat_export` 忠实移植为 TypeScript，随包自带、装了即用、无需 Python；对历史库做过逐字节黄金样本回归。
- **一键自动导出**：可在 Claude Code 的 `~/.claude/settings.json` 安装 SessionEnd 钩子，新会话结束自动入库。macOS 下钩子以纯 Node 模式在后台运行（不启动 Chromium、不出现程序坞图标），先落盘、再由 haiku 后台起名；钩子过旧时应用会提示一键更新。
- **按项目浏览**：左侧「按项目」视图按会话的工作目录分组，不向任何项目目录写文件；库根第一层的游离对话目录归入「未归类」，可一键归位。
- **保存路径可迁移**：更换库根时复制-校验-切换-旧路径移入回收站，校验通过前绝不动旧数据；不接受主目录、桌面、文稿等个人数据总入口作为库根。

## 下载

预构建包见 [Releases](https://github.com/Chin-Jing1998/chatark/releases/latest)，含 macOS 与 Windows。

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

自 v0.3.0 起不再提供预构建包。克隆仓库后执行 `npm ci && npm run dist:linux` 可自行产出 AppImage 与 deb（打包配置已就绪，无原生模块）。

均未做代码签名：Windows 的 SmartScreen 会提示「未知发布者」，点击「更多信息 → 仍要运行」；macOS 首次打开需右键点图标选「打开」以绕过 Gatekeeper。

预构建产物由 [GitHub Actions](.github/workflows/release.yml) 在 macOS 与 Windows 两个 runner 上并行构建（各含 x64 与 arm64），推 `v*` tag 即自动发布。

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
│  │  ├─ fs/       scan / parse-dir / move / trash / rename / watch / paths / refresh-gate / file-lock
│  │  ├─ search/   纯 TS trigram 全文索引
│  │  ├─ org/      置顶 / 收藏 / 归档 / 标签（chatark.json sidecar）
│  │  ├─ migration/路径迁移（复制-校验-切换-删源）
│  │  ├─ backfill/ 补录：扫描原始会话 / 导入对话包
│  │  ├─ hook/     SessionEnd 自动导出钩子安装 / 状态检测 / 诊断日志
│  │  ├─ exporter/ 内置 TS 导出器（移植自 chat_export；先落盘后起名）
│  │  └─ app-paths.ts  userData / 日志 / 锁目录的纯函数定位（GUI 与无头共用）
│  ├─ ipc/         按域分文件注册 IPC
│  ├─ headless.ts  无头入口（构建为 out/main/headless.js，不依赖 Electron）
│  └─ headless/cli.ts  启动器 + 脱离父进程的导出 worker（--export-stdin / --export / --library-maintain）
├─ preload/        contextBridge 暴露白名单 window.api
├─ renderer/       React 界面：四区液态玻璃布局
│  └─ src/{app,features,lib,styles}   features/projects 为「按项目」视图
└─ shared/         跨进程契约（types / api / ipc-channels / viewer / constants）
```

## 自动导出的工作方式

### 本机项目副本（2026-10-31）

本机在 Claude Code 与 Codex 双端启用相同的退出归档机制：同时写入设置中的集中历史库，
以及项目归档目录 `<会话启动项目>/claude code对话记录/<时间戳>_<标题>_<会话标识>/`（Claude Code）
与 `<会话启动项目>/codex对话记录/<时间戳>_<标题>_<会话标识>/`（Codex）。两处均保存
`对话.html`、`对话.md`、`data.js`、`meta.json`、`transcript.jsonl`。
项目副本复用本仓库导出引擎，独立打包后不依赖应用安装路径；同一会话续接后更新原目录，
空会话不生成文件。Codex 原始转录（`~/.codex/sessions` 与 `~/.codex/archived_sessions`）由导出引擎原生适配并剥离系统注入上下文，优先使用 `~/.codex/session_index.jsonl` 中的会话标题或首条有效提问，项目归档不调用模型。

构建入口：`node scripts/build-project-export.mjs`。本机部署入口为
`~/.local/share/claude-project-export/export.cjs` 与 `~/.local/share/codex-project-export/export.cjs`，诊断日志为各自目录下的 `export.log`。
项目副本优先使用 `CODEX_PROJECT_DIR` / `CLAUDE_PROJECT_DIR`，其次使用转录记录的初始工作目录。
作者与修订者为 `Chin_Jing1998`，导出时间使用北京时间。原始转录逐字节保留。

以下为应用原生集中导出的工作方式：

- **钩子命令**：macOS 写入 `[ -n "$CHATARK_TITLEGEN" ] || ELECTRON_RUN_AS_NODE=1 "<ChatArk 可执行文件>" "<app.asar>/out/main/headless.js" --export-stdin --user-data "<userData>"`，同步执行、`timeout: 10`。`ELECTRON_RUN_AS_NODE` 令 Electron 二进制以纯 Node 运行，冷启动约 0.1 s，无窗口、无程序坞图标。Windows 与 Linux 写入 `"<可执行文件>" --export-stdin --user-data "<userData>"`（Electron 无窗模式，AppImage 用 `$APPIMAGE`）。Windows 命令按 Git Bash 语法生成；若你的 Claude Code 以 PowerShell 执行钩子，请把命令手工改为 `& "…ChatArk.exe" --export-stdin --user-data "…"` 形式。
- **启动器 → worker**：钩子进程只读取 SessionEnd 的 stdin JSON，随即派生一个脱离父进程的 worker（`--export-worker`）并立即退出，因此不会拖住会话退出，也不受钩子超时影响。worker 先用本地规则标题写出五件套，再调用 claude 起名并改名；转录未变化时不重写文件；若既有标题仍是本地规则（上次起名失败或处于冷却期），会只补做一次起名。同一会话与起名各有文件锁（`<userData>/locks/`），成批结束会话时串行起名。
- **起名隔离**：`claude -p --model haiku --tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --no-session-persistence --setting-sources ""`，环境变量按白名单裁剪、工作目录为系统临时目录，因此派生会话不加载任何 MCP、工具与用户钩子，也不在 `~/.claude/projects` 落盘。认证失败（未登录或 OAuth 过期）后 30 分钟内不再重试；起名依赖终端版 `claude` 的登录态，过期时执行一次 `claude /login` 即可恢复，期间导出照常落盘、仅标题为本地规则。
- **诊断日志**：`<userData>/logs/auto-export.log`（超过 1 MB 轮转为 `.1`），每次钩子与 worker 各写一行 `k=v`，设置面板提供「打开日志」。
- **旧版钩子**：应用启动与设置面板会检测钩子命令或超时与当前版本不一致，并提供一键更新（写入前自动备份 `settings.json`）。

## 数据约定

- 历史库默认根：`~/claude code 编程项目研究/claude code历史对话记录`（可在设置中更换）。当前库根记录在 `<userData>/config.json`；userData 在 macOS 为 `~/Library/Application Support/chatark`，Windows 为 `%APPDATA%\chatark`，Linux 为 `~/.config/chatark`。
- 每个对话是一个目录 `日期_时间_标题_哈希8`，含 `对话.html / transcript.jsonl / data.js / 对话.md / meta.json`；平台另写 `chatark.json` 记录组织元数据。

> **分享对话包前请自行核查内容。** 导出包忠实归档整场会话，因此：
> `transcript.jsonl` 是**原始全量转录**（不截断、不脱敏），包含所有工具调用的完整入参与返回——
> 读取过的文件内容、执行过的命令与输出，其中可能含密钥、凭据或其他私密信息；
> `meta.json` 与 `data.js` 另含项目工作目录的**绝对路径（含你的用户名）**、转录源路径与 Git 分支名。
> 应用本身不联网、不上传任何数据，但这些文件一旦随对话包交给他人，上述内容即一并交出。
- 类别以**物理父目录**为准；`meta.category` 仅导出时初值。直接位于库根第一层的对话目录在界面显示为「未归类」，组头「全部归位」会按 `meta.category`（缺省为「其他」）移入分类目录。
- `meta.json` 的 `titleSource` 记录标题来源：`llm`（claude 起名）、`local`（本地规则）、`user`（手工改名）；重导出沿用既有标题，不覆盖手工改名。
- 「按项目」视图按 `meta.cwd` 分组浏览，不向项目目录写任何文件。
- 搜索索引为**内存态**，不落盘、不写入历史库，保证“库内无隐藏状态”，迁移无需搬索引；重启后按需重建。
  重扫后按文件指纹增量更新，只重读内容真正变化的对话。

> 第三方独立工具，与 Anthropic 官方无关。
