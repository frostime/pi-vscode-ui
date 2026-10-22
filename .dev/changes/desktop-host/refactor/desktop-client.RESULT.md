# 共享客户端与 Desktop 开发预览验证

## 候选与范围

- 原验证快照：`wip/desktop-client@7c3f671`，前一 checkpoint 为 `367d295`，包含本地 `main@2ed69c1`。产品代码现已 squash 整合进主目录 `feat/desktop-host`，后续在主目录开发；原 worktree 冻结作回退。未合并 main、未改产品版本、未发布。
- `apps/pi-client` 的现有 UI、Runtime、Registry 和消息桥供两个产出实际消费。宿主需求集中在 `src/host/clientHost.ts`，VS Code 薄接线，Desktop 适配。
- Desktop 是内存态开发预览：Project、设置和客户端元数据不跨应用重启保存。配置路径、Project 配置覆盖与正式关闭/恢复策略仍未定。

## 自动与原生宿主检查

| 检查 | 结果 |
|---|---|
| `pnpm check` | 通过：全部 lint/typecheck、125 个测试文件 / **824 项测试**、双端构建、插件 bundle budget |
| `pnpm package:vsix && pnpm verify:vsix` | 通过：0.15.5，78 entries，2.65 MB；未安装到用户宿主 |
| `env -u ELECTRON_RUN_AS_NODE pnpm --dir apps/vscode test:e2e` | 通过：受控 Extension Host 退出码 0；测试宿主 VS Code 1.142.0 |
| `pnpm --dir apps/desktop test:smoke` | 通过：实际 Electron 44.9.0、两个无关临时目录、两个受控 Pi 子进程；共同 UI/New/消息渲染、并行执行、Stop 隔离、前台/cwd 归属和 renderer 无 Node/原始 IPC |
| 通用 UI 修改传播 | 共享空状态文案由 “Start a Pi session” 改为 “Start or resume a Pi session”，两个实际 JS 产物均包含新文案；9 份原有 CSS 内容与基线相同 |

Svelte 保留基线中的一条可访问性警告（ExtensionUiRequestCard 的条件 tabindex），构建保留入口 chunk 提示；没有通过放宽预算或跳过测试来通过 gate。E2E 的下载版 VS Code 有自身 workbench/worker 诊断输出，测试 runner 及 Extension Host 均退出 0。

两路独立只读审查后，修复了 Resume 搜索/Browse 可见性、远程目录 URI 保留、Electron 文件过滤转换、输入错误保留/可纠正、原生 API 类型及错误反馈。外部链接仍由共享分派器限制为 HTTP(S)。

## 真实本机 Pi

本机 `pi --version` 为 **1.1.0**。使用同一份已构建 SessionRuntime，在新建临时目录和指定临时 session-dir 中完成：

- 启动并刷新命令元数据；用临时扩展产生真实 RPC confirm 请求，拒绝后 pending 清零。
- 发送最小真实模型请求，检查 assistant response 中的预期标记；未将提示、回复或凭据写入 FrostPi 日志/本报告。
- 启动另一轮后 Abort，确认退出 streaming 且 Runtime 未失败。
- 停止进程，按同一 Pi session file 创建新 Runtime 并加载历史，确认原回复恢复。

结果全部通过。Pi 仍拥有会话文件；未修改用户项目或设置。验证关闭了自动扩展/skill/template 发现及 MCP，显式加载临时输入扩展；这不证明所有用户扩展组合。**真实 Pi 证据来自共享 Runtime；Electron GUI 路径的自动化使用受控子进程，两份证据不能混称为完整真人 GUI 验收。**

临时证据：gate 日志 `G:/Enviroment/msys2/tmp/frostpi-gates.eJz95L/`；最终 Desktop smoke 的结果/截图在 `C:/Users/EEG/AppData/Local/Temp/frostpi-desktop-smoke-ok5mYD/`；真实 Pi 结果在 `C:/Users/EEG/AppData/Local/Temp/frostpi-real-pi-6Wfr3w/`。这些是当时证据，不是运行依赖。

## 后续审查发现

用户已反馈两端最基础功能似乎可用，但 Desktop 的 `$(...)` 图标标签未解析。独立审查及源码核对还发现 Mermaid 产物路径不匹配、Desktop 字体规则被硬编码、设置默认值存在 manifest/fallback 双来源，以及受控 fixture 的 `get_state.isStreaming` 固定为 false。先前成功记录保留，但不能以一次旧 smoke 通过证明可重复的并发/Stop 隔离；需要修正 fixture 后重验。整合到主目录不表示这些问题已经修复。

## 主目录整合与兼容收尾

- `e2cdae9` 将 `wip/desktop-client@7c3f671` squash 进主目录 `feat/desktop-host`；原 worktree 冻结作回退，不再施工。锁定依赖已在主目录重装；本机 Electron 开发二进制复用已校验版本，未改变全局配置。
- `d0dbc29` 修复 Desktop 的 VS Code 图标标签及搜索字段语义、Mermaid 入口相对资源路径；两端改为消费同一个 `ui/styles` 入口和 Chat 字体解析函数，原 9 份 CSS 不变。字体测试随解析函数迁入共享客户端。
- 受控 Pi 的 `get_state.isStreaming` 现在随真实 fixture 事件变化；smoke 用显式 release 文件控制流完成，Abort 取消后续定时输出，不再依赖 240ms 的竞速窗口。
- 主目录 `pnpm check` 通过：127 个测试文件 / **828 项测试**、lint、类型、双端构建和预算；VSIX 打包/校验通过，仍为 0.15.5 / 78 entries / 2.65 MB。增强后的 Electron smoke **连续 3 次通过**，新增实际 QuickPick 图标及 Mermaid SVG 断言。
- 主目录额外尝试使用现有离线 VS Code 1.129.1 缓存运行同一 Extension Host suite，启动被系统 `vscode-updating` mutex 阻塞，未运行到插件测试，**不能记为通过**。未关闭用户 VS Code、干预更新器或绕过系统锁；待环境允许后重跑。
- 设置 manifest 与 fallback 双来源、首次导入范围和其余维护收尾仍未解决。本次未实现持久设置或首次导入，也未将基础试用反馈视为首版总验收。

本轮临时日志：`G:/Enviroment/msys2/tmp/frostpi-primary-gates.wAfwky/`、`frostpi-primary-smoke.yNRk4t/`、`frostpi-primary-vsix.THQFRY/`；最后一次 smoke 截图/结果在 `C:/Users/EEG/AppData/Local/Temp/frostpi-desktop-smoke-E6H1y5/`。

## 设置默认值权威来源

主目录接续将 `apps/vscode/package.json` 的 `contributes.configuration` 保留为设置定义权威来源。`pnpm --dir apps/pi-client settings:generate` 生成共享默认值；解析器及代理的空值回退使用该模块，不再手写第二份默认值。两端构建均经过共享客户端的过期检查，运行时不读取产品 manifest。新增测试比较全部设置的 schema 默认值与生成值，并对比 Native 形状配置和无配置宿主的解析结果。新增设置的实际行为/适配仍须实现，不能由生成默认值代替。

- 主目录 `pnpm check` 通过：127 个测试文件 / **829 项测试**、lint、类型、双端构建及插件预算。保留既有 Svelte 可访问性、Mermaid 构建时资源路径及 chunk 提示。
- 隔离复制 manifest、生成器和生成文件，修改 `session.startOnOpen` 默认值后，`--check` 明确失败；重新生成后检查通过且输出为新值。未修改真实产品默认值。
- 本轮未重跑 VSIX、Electron smoke、Extension Host E2E 或真实 Pi；此前证据及限制不变。未读取用户真实设置，未实现首次导入、持久化或设置 UI。

日志：`tmp/r3-setting-check.log`；隔离反例：`tmp/r3-settings-parity-43y8la9i/`。这些是临时验证材料，不是产品依赖。

## 独立配置与首次导入

主目录新增持久 `settings.json`、首次设置页及 schema 驱动设置表单。普通启动使用系统应用数据目录的 `FrostPi` profile；测试可用 `FROSTPI_DESKTOP_USER_DATA` 隔离。存储保留原始 dot keys，`desktop.*` 仅预留真实 Desktop 专属设置，不把 Project/窗口/会话状态混入设置。

首次导入只读标准 VS Code 默认用户文件，以白名单产生可编辑预览，Save 才写入 Desktop 并生效；后续不再导入或同步。白名单为 manifest 生成的 FrostPi schema、4 个 Chat 字体键、`editor.fontFamily` 与 `files.exclude`/`search.exclude`。Proxy 的 vscode 模式和旧 endpoint 键明确转换，未解决的转换阻止 Save；不导入代理凭据。设置存储使用 JSONC 读取、串行原子写入；损坏文件不覆盖，修复后 Reload。相关设置错误由主进程显式分类，未知异常内容不跨 IPC。

- `pnpm check` 两轮取得退出码 0（最近一轮为 131 个测试文件 / **859 项测试**）；最后统一字体默认值常量的 dot keys 后，补跑的完整日志再次记录全部 859 项测试、类型、lint、双端构建及 budget 完成。该组合命令触及工具 300 秒超时，后续确认日志已到 `[check] complete`，不另声称该次工具捕获了退出码 0。
- 修复后 Electron smoke 多次通过；最终独立补跑明确取得 **退出码 0** 和 `ok: true`。新增证据包括真实共享 Markdown/Composer 的字体 family/size、代码后备字体、首次导入预览不生效、Save/Reset/新 App 实例重开、280px 设置布局、非法设置拒绝及修改 executable/proxy 不重启两个运行中的受控 Pi。
- VSIX 打包/校验通过，仍为 0.15.5 / 78 entries / 2.65 MB；未安装或发布。最终候选的 Extension Host E2E 与真实 Pi GUI 本轮未重跑，此前限制不变。
- 独立只读审查后收齐了错误消息边界、旧代理键迁移和无效 exclusion map 的明确提示。未扩展为逐条修复坏配置或掉电持久性保证。

首次 GUI 尝试因 `jsonc-parser` 默认 UMD 入口留下动态 `require('./impl/format')`，触发用户看到的主进程弹窗，未记为通过。已改用该包发布的 ESM 入口，并增加执行打包后 JSONC reader 的回归测试。smoke 还增加先于静态应用 import 的失败 bootstrap；隔离负向实验确认启动异常写失败结果并退出 1，不再阻塞于原生弹窗。

本轮未读取真实用户的 VS Code 设置。Project/会话列表、草稿跨重启恢复与最终退出规则仍未实现/确认，不能把设置持久化称为 Desktop 首版完成。

日志：`tmp/r3-settings-check-final.log`、`tmp/r3-settings-accepted-check.log`、`tmp/r3-settings-vsix-final.log`、`tmp/r3-settings-smoke-exit.log`；最终 smoke 结果/截图：`C:/Users/EEG/AppData/Local/Temp/frostpi-desktop-smoke-rldOhC/`；启动失败负向实验：`C:/Users/EEG/AppData/Local/Temp/frostpi-smoke-bootstrap-negative-icaezG/`。均为临时证据，不是产品依赖。

## 尚未证明

用户日常操作的布局/流程满意度、完整真实 Pi GUI 路径、所有用户扩展组合、Desktop 持久化/重开恢复和其他平台尚未验收。不能把此 checkpoint 宣称为 Desktop 产品完成或发布就绪。
