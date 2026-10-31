---
author: Chin_Jing1998
date: 2026-10-31
---

请用 Material 3 Expressive 的设计实现ChatArk 工作台（M3E 色调容器方案）。面向 Claude Code 本地历史对话库的桌面归档与检索工作台，包含主工作台对话阅读态、仪表盘空状态与快速检索态、分区设置与主题画廊态。
目标为桌面浏览器视口（以 1280×800 为基准），同时支持浅色和深色模式，并跟随设备的系统设置切换。
实现目标是 Web（在浏览器中运行的应用）。
下面的屏幕结构是传达意图的草图，不是最终规格。不要把它当静态图片照搬，而要做成这类应用通常应具备的功能齐全、真正可用的成品。

## 配色
主题为 Purple 系。请在Material 3 的浅色和深色配色方案中设置以下颜色，UI 的所有颜色都通过这些角色引用。
浅色配色：
- primary #6750A4 / onPrimary #FFFFFF / primaryContainer #EADDFF / onPrimaryContainer #21005D
- secondary #635A75 / secondaryContainer #E8DEF8 / onSecondaryContainer #1D192B / tertiaryContainer #FFD8E4 / onTertiaryContainer #31111D
- surface #FEF7FF / surfaceContainerLow #F7F2FA / surfaceContainer #F3EDF7 / surfaceContainerHigh #ECE6F0 / surfaceContainerHighest #E6E0E9
- onSurface #1D1B20 / onSurfaceVariant #49454F / outline #79747E / outlineVariant #CAC4D0
- inverseSurface #322F35 / inverseOnSurface #F5EFF7 / inversePrimary #D0BCFF
- error #B3261E / onError #FFFFFF / errorContainer #F9DEDC / onErrorContainer #410E0B
深色配色：
- primary #D2BCFC / onPrimary #32226F / primaryContainer #4C3889 / onPrimaryContainer #E9DDFF
- secondary #CDC1E1 / secondaryContainer #4B425D / onSecondaryContainer #E9DDFD / tertiaryContainer #6C3644 / onTertiaryContainer #FDDAE1
- surface #141317 / surfaceContainerLow #1C1B1F / surfaceContainer #201F23 / surfaceContainerHigh #2B292D / surfaceContainerHighest #363438
- onSurface #E4E1E7 / onSurfaceVariant #C9C4D1 / outline #938F9B / outlineVariant #494550
- inverseSurface #E4E1E7 / inverseOnSurface #313034 / inversePrimary #6750A4
- error #F2B8B5 / onError #601410 / errorContainer #8C1D18 / onErrorContainer #F9DEDC

## 形状、字体与动效
- 圆角沿用 M3 Expressive 的默认值（按钮为胶囊形，卡片 20dp，对话框 28dp）。
- 字体使用 设备的系统字体。标题、按钮文字和标签页使用 M3 Expressive 的 emphasized 字体样式（headlineMediumEmphasized 等更粗的字重）。
- 动效使用 MotionScheme.expressive()：屏幕过渡和状态变化带轻微回弹的弹簧效果。

## 屏幕结构
共有 3 个屏幕：“主工作台与对话阅读”、“空状态仪表盘与快速检索”、“分区设置与主题画廊”。

左侧 M3E 导航栏与圆角分类侧栏，右侧内嵌圆角主舞台画布（顶栏与标签栏合流），中部展示无左粗线的色调容器对话流与胶囊工具条，右侧常驻会话统计与目录。
“主工作台与对话阅读”屏幕（背景为 surfaceContainerLow）从上到下依次如下（重叠的组件会特别说明）：
- 左缘：5个项目的侧边导航栏（“浏览”(folder_open)、“搜索”(search)、“收藏”(star)、“标签”(sell)、“设置”(settings)，第一项为选中状态）。WideNavigationRail，折叠状态，宽 96dp。非模态布局：按当前宽度占据布局空间。顶部菜单按钮切换展开与折叠。
- 中部，从左到右横向排成一行：268×768dp 的容器框（背景 surfaceContainer，圆角 24dp）、884×768dp 的容器框（背景 surface，圆角 28dp）（放在同一行并垂直居中，不要竖着堆叠或换行，最后的容器框向右拉伸占满剩余宽度）。
  - 容器框内部叠放以下内容（以容器为背景，下列组件绘制在其前面，位置为容器内的相对位置）：
    - 上部放置占位文字为“筛选分类或对话…”的搜索栏（右端有 tune 图标）。
    - 中部放置5项的列表，从上到下依次为 “convo:// 协议注入与主题同步”（辅助文本“架构重构 · OPUS · 42 条 · 14:20”），左侧显示 push_pin 图标，右侧显示 star 图标、“SQLite FTS5 中文分词检索调优”（辅助文本“搜索引擎 · SONNET · 28 条 · 昨日”），左侧显示 chat 图标，右侧显示 chevron_right 图标、“Claude Stop Hook 增量归档脚本”（辅助文本“自动化 · OPUS · 19 条 · 10-29”），左侧显示 chat 图标，右侧显示 chevron_right 图标、“导出快照 CSP 与离线自包含校验”（辅助文本“安全加固 · HAIKU · 15 条 · 10-27”），左侧显示 verified_user 图标，右侧显示 chevron_right 图标、“拖拽分隔条跨 iframe 指针穿透修复”（辅助文本“界面交互 · SONNET · 31 条 · 10-25”），左侧显示 chat 图标，右侧显示 chevron_right 图标。
  - 容器框内部叠放以下内容（以容器为背景，下列组件绘制在其前面，位置为容器内的相对位置）：
    - 上部放置标题为“ChatArk · convo:// 协议注入与主题同步”的顶部应用栏，左侧是 auto_awesome，右侧是 dark_mode 图标按钮。
    - 上部，从左到右横向排成一行：“convo:// 协议注入与主题同步”、“FTS5 中文分词检索调优”、“src/main/theme.ts”这 3 个标签页（第一项为选中状态）、“快速检索 ⌘K”的色调按钮（带 terminal 图标）（宽 224dp）（放在同一行并垂直居中，不要竖着堆叠或换行，最后的“快速检索 ⌘K”按钮向右拉伸占满剩余宽度）。
    - 中部，从左到右横向排成一行：填充卡片（高 132dp）（背景 secondaryContainer）。标题“用户提问 · #1 · 14:20:08”，正文“请检查现行 TopBand 与 Stage 标签条的空间浪费问题，并让存量库中的 对话.html 在切换 6 套主题预设时实时同步背景与代码高亮配色。”、填充卡片（高 220dp）（背景 surfaceContainer）。标题“会话统计与提问目录”，正文“模型：claude-opus-4-7
消息：42 条（提问 14 / 工具 16 / 回答 12）
目录：/Users/chin.jing1998/编程项目工作站/chatark
完整度：100%（含对话.html + meta.json）”（放在同一行并垂直居中，不要竖着堆叠或换行，最后的“会话统计与提问目录”卡片向右拉伸占满剩余宽度）。
    - 中部靠左放置2项的列表，从上到下依次为 “Read · src/main/services/theme.ts (L1–L84)”（辅助文本“工具调用已完成 · 耗时 24ms · 展开查看 EMBED_FIX_CSS 与令牌白名单校验”），左侧显示 terminal 图标，右侧显示 expand_more 图标、“Edit · src/renderer/src/app/Layout.tsx (+48 / -19)”（辅助文本“合并顶栏与标签栏为一体式色调容器头 · 点击在内置标签页打开源码”），左侧显示 edit_note 图标，右侧显示 open_in_new 图标。
    - 中部，从左到右横向排成一行：浮起卡片（高 236dp）（背景 surfaceContainerLow）。标题“Claude Opus 4.7 · 架构诊断与双端样式同步方案”，正文“1. 外壳层：采用 Surface Container Low (#F6F4FA) 底板承载圆角主舞台 (#FFFFFF)，释放 40px 垂直阅读高度。
2. 协议层：convo:// 拦截器在 </head> 前注入 html[data-theme] 令牌与 EMBED_FIX_CSS，无需重导历史 HTML 即可同步 6 套预设。
3. 导航层：目录抽屉与右侧统计栏对齐 12px 粘性顶距，消除跳转抖动。”、4项的列表，从上到下依次为 “#1 检查 TopBand 与标签条空间”（辅助文本“14:20 · 2 次工具调用”），左侧显示 bookmark 图标、“#2 convo:// 动态注入主题令牌”（辅助文本“14:24 · 5 次工具调用”），左侧显示 notes 图标、“#3 窄屏三栏自适应与 golden 测试”（辅助文本“14:31 · 3 次工具调用”），左侧显示 notes 图标、“#4 导出离线包与归档完整性校验”（辅助文本“14:38 · 6 次工具调用”），左侧显示 check_circle 图标（放在同一行并垂直居中，不要竖着堆叠或换行，最后的列表项组向右拉伸占满剩余宽度）。
    - 下部靠左放置由“查看空状态工作台”(色调)“打开主题画廊与设置”(填充)这 2 个按钮横向相连组成的按钮组。

无打开标签时呈现库规模仪表盘、全局搜索入口（⌘K）、最近阅读会话卡片与未导出会话补录快捷入口。
“空状态仪表盘与快速检索”屏幕（背景为 surfaceContainerLow）从上到下依次如下（重叠的组件会特别说明）：
- 左缘：5个项目的侧边导航栏（“浏览”(folder_open)、“搜索”(search)、“收藏”(star)、“标签”(sell)、“设置”(settings)，“搜索”为选中状态）。WideNavigationRail，折叠状态，宽 96dp。非模态布局：按当前宽度占据布局空间。顶部菜单按钮切换展开与折叠。
- 中部，从左到右横向排成一行：268×768dp 的容器框（背景 surfaceContainer，圆角 24dp）、884×768dp 的容器框（背景 surface，圆角 28dp）（放在同一行并垂直居中，不要竖着堆叠或换行，最后的容器框向右拉伸占满剩余宽度）。
  - 容器框内部叠放以下内容（以容器为背景，下列组件绘制在其前面，位置为容器内的相对位置）：
    - 上部放置占位文字为“EMBED_FIX_CSS”的搜索栏（右端有 close 图标）。
    - 上部放置3项的列表，从上到下依次为 “convo:// 协议注入与主题同步”（辅助文本“命中 4 处 · 架构重构 · 点击打开”），左侧显示 description 图标，右侧显示 arrow_forward 图标、“对话阅读器浮动目录抽屉精修”（辅助文本“命中 2 处 · 界面交互 · 10-30”），左侧显示 description 图标，右侧显示 arrow_forward 图标、“6 套液态玻璃主题色板令牌校准”（辅助文本“命中 3 处 · 视觉系统 · 10-28”），左侧显示 description 图标，右侧显示 arrow_forward 图标。
  - 容器框内部叠放以下内容（以容器为背景，下列组件绘制在其前面，位置为容器内的相对位置）：
    - 上部放置标题为“ChatArk · 工作台概览与快速检索”的顶部应用栏，左侧是 arrow_back，右侧是 settings 图标按钮。
    - 上部放置占位文字为“搜索 1,248 条本地对话标题、正文、代码片段，或输入 > 运行命令 (⌘K)…”的搜索栏（右端有 keyboard_command_key 图标）。
    - 中部，从左到右横向排成一行：填充卡片（高 148dp）（背景 primaryContainer）。标题“1,248 条已归档对话”，正文“跨越 38 个本地 Git 仓库与工作站目录，全文索引 FTS5 毫秒级响应。”、填充卡片（高 148dp）（背景 secondaryContainer）。标题“24 条收藏与置顶要案”，正文“含核心架构决策、疑难故障排查与高频复用提示词模板。”、填充卡片（高 148dp）（背景 tertiaryContainer）。标题“3 条未归档会话待补录”，正文“扫描 ~/.claude/projects 发现新会话，一键补录生成自包含 HTML。”（放在同一行并垂直居中，不要竖着堆叠或换行）。
    - 中部放置4项的列表，从上到下依次为 “最近打开 · convo:// 协议注入与主题同步”（辅助文本“架构重构 · /Users/chin.jing1998/编程项目工作站/chatark · 刚刚阅读”），左侧显示 history 图标，右侧显示 open_in_new 图标、“最近打开 · SQLite FTS5 中文分词检索调优”（辅助文本“搜索引擎 · /Users/chin.jing1998/编程项目工作站/chatark · 2 小时前”），左侧显示 history 图标，右侧显示 open_in_new 图标、“最近打开 · Claude Stop Hook 增量归档脚本校验”（辅助文本“自动化 · ~/.claude/hooks/export_convo.py · 昨日 19:42”），左侧显示 history 图标，右侧显示 open_in_new 图标、“快捷命令 · 打开外观与 6 套主题预设画廊”（辅助文本“实时切换极光蓝紫 / Nord / Solarized / Dracula / Rosé Pine / Forest”），左侧显示 palette 图标，右侧显示 chevron_right 图标。
    - 下部放置由“恢复上次阅读会话 (⌘O)”(填充)“进入设置与历史补录 (⌘,)”(色调)这 2 个按钮横向相连组成的按钮组。

双栏分区设置弹窗：左侧锚点导航切换五大配置模块，右侧展示亮暗模式切换、6 套双色板预设画廊与 Hook 自动导出状态。
“分区设置与主题画廊”屏幕（背景为 surfaceContainerLow）从上到下依次如下（重叠的组件会特别说明）：
- 左缘：5个项目的侧边导航栏（“浏览”(folder_open)、“搜索”(search)、“收藏”(star)、“标签”(sell)、“设置”(settings)，“设置”为选中状态）。WideNavigationRail，折叠状态，宽 96dp。非模态布局：按当前宽度占据布局空间。顶部菜单按钮切换展开与折叠。
- 中部放置1148×768dp 的容器框（背景 surface，圆角 28dp）。
  - 容器框内部叠放以下内容（以容器为背景，下列组件绘制在其前面，位置为容器内的相对位置）：
    - 上部放置标题为“设置中心 · 外观预设、存储迁移与自动归档”的顶部应用栏，左侧是 arrow_back，右侧是 check 图标按钮。
    - 中部，从左到右横向排成一行：5项的列表，从上到下依次为 “外观与明暗模式”（辅助文本“跟随系统 / 亮色 / 暗色”），左侧显示 contrast 图标、“主题风格画廊”（辅助文本“6 套外壳+阅读器联动色板”），左侧显示 palette 图标、“保存路径与迁移”（辅助文本“支持软链接与安全复制切换”），左侧显示 folder_managed 图标、“未导出会话补录”（辅助文本“扫描 ~/.claude 增量导入”），左侧显示 cloud_sync 图标、“Hook 自动导出”（辅助文本“Stop 事件触发静默归档”），左侧显示 bolt 图标、由“跟随系统 (Auto)”(填充)“亮色模式 (Light)”(色调)“暗色模式 (Dark)”(色调)这 3 个按钮横向相连组成的按钮组（放在同一行并垂直居中，不要竖着堆叠或换行）。
    - 中部居中，将 6 个卡片排成 3 列网格（列间距 14dp，行间距 16dp；所有单元格等宽，从左到右、从上一行开始依次填充；保持 3 列，不要排成一行或竖着堆叠）：(1) 填充卡片（高 160dp）（背景 primaryContainer）。标题“极光蓝紫 (Default) · 当前使用”，正文“外壳品牌紫 #7C6FF2 + 清透磨砂底板，兼顾代码对比度与长时间阅读舒适度。”；(2) 描边卡片（高 160dp）（背景 surfaceContainerLow）。标题“Nord 极地冰蓝”，正文“冷冽冰川蓝 #5E81AC 与低饱和岩灰底板，适合终端重度用户与夜间审阅。”；(3) 描边卡片（高 160dp）（背景 surfaceContainerLow）。标题“Solarized 暖阳羊皮纸”，正文“经典 #FDF6E3 暖米纸张底色配青蓝强调色，长篇文献与架构对话零眩光。”；(4) 描边卡片（高 160dp）（背景 surfaceContainerLow）。标题“Dracula 暗夜霓虹”，正文“高辨识度紫粉 #BD93F9 与深邃炭黑画布，突出工具调用状态与代码块边界。”；(5) 描边卡片（高 160dp）（背景 surfaceContainerLow）。标题“Rosé Pine 松玫瑰”，正文“柔和雾粉与松木灰调，提供温润克制的编辑室阅读氛围。”；(6) 描边卡片（高 160dp）（背景 surfaceContainerLow）。标题“Forest 秘林苔绿”，正文“自然森林绿 #3A7D5C 与有机暖灰容器，缓解高频检索视觉疲劳。”。
    - 下部居中放置3项的列表，从上到下依次为 “当前对话库路径：~/编程项目工作站/Claude对话归档库”（辅助文本“已启用 FTS5 实时索引 · 支持一键安全迁移或创建兼容软链接”），左侧显示 folder_special 图标，右侧显示 drive_file_move 图标、“Claude Code Stop Hook 自动导出：已安装并处于最新状态 (v1.4)”（辅助文本“每次 Claude Code 会话结束时自动导出 对话.html 与 meta.json 至归档库”），左侧显示 verified 图标，显示列表项开关（初始开启）、“完成配置并返回 ChatArk 主工作台”（辅助文本“所有主题与阅读器令牌改动已实时同步至已打开的对话标签页”），左侧显示 arrow_back 图标，右侧显示 check 图标。

## 行为与屏幕跳转
- 侧边导航栏：点击“搜索”项后以淡入的方式跳转到“空状态仪表盘与快速检索”屏幕；点击“设置”项后以淡入的方式跳转到“分区设置与主题画廊”屏幕。
- “筛选分类或对话…”搜索栏：点击后以淡入的方式跳转到“空状态仪表盘与快速检索”屏幕。
- “ChatArk · convo:// 协议注入与主题同步”顶部应用栏：点击右侧的 dark_mode 图标按钮后以淡入的方式跳转到“分区设置与主题画廊”屏幕。
- “快速检索 ⌘K”按钮：点击后以淡入的方式跳转到“空状态仪表盘与快速检索”屏幕。
- “查看空状态工作台”按钮：点击后以从右侧滑入的方式跳转到“空状态仪表盘与快速检索”屏幕。
- “打开主题画廊与设置”按钮：点击后以从右侧滑入的方式跳转到“分区设置与主题画廊”屏幕。
- 侧边导航栏：点击“浏览”项后以淡入的方式跳转到“主工作台与对话阅读”屏幕；点击“设置”项后以淡入的方式跳转到“分区设置与主题画廊”屏幕。
- “convo:// 协议注入与主题同步”列表项：点击后以从右侧滑入的方式跳转到“主工作台与对话阅读”屏幕。
- “对话阅读器浮动目录抽屉精修”列表项：点击后以从右侧滑入的方式跳转到“主工作台与对话阅读”屏幕。
- “6 套液态玻璃主题色板令牌校准”列表项：点击后以从右侧滑入的方式跳转到“分区设置与主题画廊”屏幕。
- “ChatArk · 工作台概览与快速检索”顶部应用栏：点击左侧的 arrow_back 图标按钮后以从左侧滑入的方式跳转到“主工作台与对话阅读”屏幕；点击右侧的 settings 图标按钮后以淡入的方式跳转到“分区设置与主题画廊”屏幕。
- “1,248 条已归档对话”卡片：点击后以淡入的方式跳转到“主工作台与对话阅读”屏幕。
- “24 条收藏与置顶要案”卡片：点击后以淡入的方式跳转到“主工作台与对话阅读”屏幕。
- “3 条未归档会话待补录”卡片：点击后以从右侧滑入的方式跳转到“分区设置与主题画廊”屏幕。
- “最近打开 · convo:// 协议注入与主题同步”列表项：点击后以从右侧滑入的方式跳转到“主工作台与对话阅读”屏幕。
- “最近打开 · SQLite FTS5 中文分词检索调优”列表项：点击后以从右侧滑入的方式跳转到“主工作台与对话阅读”屏幕。
- “最近打开 · Claude Stop Hook 增量归档脚本校验”列表项：点击后以从右侧滑入的方式跳转到“主工作台与对话阅读”屏幕。
- “快捷命令 · 打开外观与 6 套主题预设画廊”列表项：点击后以从右侧滑入的方式跳转到“分区设置与主题画廊”屏幕。
- “恢复上次阅读会话 (⌘O)”按钮：点击后以从右侧滑入的方式跳转到“主工作台与对话阅读”屏幕。
- “进入设置与历史补录 (⌘,)”按钮：点击后以从右侧滑入的方式跳转到“分区设置与主题画廊”屏幕。
- 侧边导航栏：点击“浏览”项后以淡入的方式跳转到“主工作台与对话阅读”屏幕；点击“搜索”项后以淡入的方式跳转到“空状态仪表盘与快速检索”屏幕。
- “设置中心 · 外观预设、存储迁移与自动归档”顶部应用栏：点击左侧的 arrow_back 图标按钮后以从左侧滑入的方式跳转到“主工作台与对话阅读”屏幕；点击右侧的 check 图标按钮后以淡入的方式跳转到“主工作台与对话阅读”屏幕。
- “完成配置并返回 ChatArk 主工作台”列表项：点击后以从左侧滑入的方式跳转到“主工作台与对话阅读”屏幕。

## 各组件的样式
以下是所用组件的参考。数值均为 M3 Expressive 的标准值，能用标准组件实现的就交给标准组件，并可根据内容适当调整。
- M3 Expressive 侧边导航栏：折叠宽 96dp，标签位于图标下方。展开宽 220dp，项目高 56dp，图标与标签横向排列，间距 8dp。沿用现有顶部应用栏配色，两种模式在折叠与展开时均使用 surfaceContainer 背景。选中项用 secondaryContainer 胶囊指示器，图标为 onSecondaryContainer，文字优先使用 secondary；若与实际背景（折叠为 surfaceContainer，展开为 secondaryContainer）的对比度低于 4.5:1，则分别使用 onSurface / onSecondaryContainer。顶部菜单按钮切换展开与折叠。非模态型位于内容旁；模态型展开时带遮罩覆盖内容并阻止背景交互，点击遮罩或按 Escape 关闭。
- 容器框：只是带指定背景色和圆角的容器，作为叠放在其上的组件的背景，本身没有任何行为。
- 搜索栏：高 56dp，完全圆角，背景为 surfaceContainerHigh（描边样式为 surface 背景加 outline 边框）。左侧显示搜索图标，右侧显示指定图标。
- 列表项：高 72dp，左侧图标 24dp（未指定时放在 40dp 的 primaryContainer 圆形上），主文本用 bodyLarge，辅助文本用 bodyMedium 的 onSurfaceVariant，背景为指定的颜色角色（未指定则为 surfaceContainerLow）。上下相连的列表以 3dp 间距排列，外侧圆角 28dp，相邻内侧圆角 8dp（M3 Expressive 的列表样式）。
- 顶部应用栏：高 64dp，背景为 surface。标题用 titleLarge，左右图标按钮 48dp。滚动时变为 surfaceContainer 的标准行为即可。
- 标签页：M3 的主标签页。高 48dp，标签用 titleSmall，选中项文字为 primary 并带与标签同宽的 3dp 指示条（上方圆角），下方为 outlineVariant 分割线。点击标签切换内容。
- 按钮：中号，高 56dp，完全圆角（胶囊形）。填充用 primary，色调用 secondaryContainer，描边用 1dp 的 outline 边框。横向相连的按钮组以 3dp 间距排列，只把相邻的内侧圆角缩小到 8dp，外侧保持圆角（M3 Expressive 的 Connected button group）。指定了高度的按钮遵循 M3 尺寸（XS 32dp / S 40dp / M 56dp / L 96dp / XL 136dp）：左右内边距、文字和图标取该尺寸的值，圆角为高度的一半。
- 卡片：圆角 20dp。图片区域按每张卡片的描述放在顶部、底部、左侧、右侧或作为整卡背景（背景时从文字一侧加渐变遮罩：浅色文字用黑色，深色文字用白色）。图片保持宽高比并居中裁剪以填满区域。填充用 surfaceContainerHighest，浮起用 surfaceContainerLow 加 Level 1 阴影，描边用 1dp 的 outlineVariant 边框。标题用 titleMedium，正文用 bodyMedium。内边距 20dp，标题与正文间距 4dp，图片与文字间距 12dp。

## 整体原则
- 先根据屏幕目的判断这是什么类型的应用，并实现该类应用通常应有的功能（新建、列表、详情、编辑、删除、搜索、设置等，视情况而定），即使草图中没有画出。
- 把数据当作真实数据处理：用户创建的数据要持久化到浏览器（IndexedDB 等），重新加载后仍保留。不要放入虚拟或示例数据，没有数据时显示空状态提示。校验输入，删除和失败要有适当的确认或提示。
- 草图没有写明的行为，根据屏幕目的和组件标签补全。未指定行为的按钮或项目要实现与其标签相符的操作（保存、发送、打开详情页等），不要什么都不做。
- 布局只需保持意图（顺序、分组、相对位置），尺寸和间距可根据内容调整。若在真机上会出问题，宁可能用也不要死守草图。
- 组件使用 Material Web 的标准组件，库里已有的组件不要自行绘制。
- 颜色必须通过上面配色方案的角色名（primary、surfaceContainer 等）引用，不要写死颜色值。
- 屏幕边缘留 16dp，组件之间 8〜16dp，排版使用 M3 的字体样式（titleLarge、bodyMedium 等）。
- 写明“横向排成一行”的组件必须放进同一个 Row（横向容器）并在同一行显示，不要竖着堆叠或换行。行高以最高的组件为准，其余组件垂直居中。
- 写明“内部叠放”的组件要绘制在该容器（容器框或卡片）之上（以容器为背景的 Box）。这种叠放是有意为之，不要因布局原因拆开或调整顺序。前后关系按描述顺序，后写的在前面。
- 可点击的组件加涟漪和轻微缩放反馈。“返回”反向播放进入时的过渡动画，系统返回手势／返回键也要做同样的效果。
- 图标使用 Material Symbols Rounded。
- 不需要在浏览器上验证。实现完成后运行 production build 并提供其输出作为交付物。
