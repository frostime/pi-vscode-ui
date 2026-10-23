# 共享客户端与 Desktop 开发预览验证

## 候选与范围

- 原验证快照：`wip/desktop-client@7c3f671`，前一 checkpoint 为 `367d295`，包含本地 `main@2ed69c1`。产品代码现已 squash 整合进主目录 `feat/desktop-host`，后续在主目录开发；原 worktree 冻结作回退。未合并 main、未改产品版本、未发布。
- `apps/pi-client` 的现有 UI、Runtime、Registry 和消息桥供两个产出实际消费。宿主需求集中在 `src/host/clientHost.ts`，VS Code 薄接线，Desktop 适配。
- 原架构快照是内存态预览。主目录后续已实现独立设置及 Project/会话元数据文件；各批次的证据见下文。当前已有 Windows x64 独立 ZIP 及本机技术交付验证；未公开发布，真实模型下的最终体验仍需验收，草稿不跨应用重启保存。

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

## 双端维护接线与能力声明

按主 Agent 与独立审查讨论后的收敛范围完成：

- `ClientHost` 增加必填的静态 UI 能力声明；Host/renderer 引用同一产品常量。仅覆盖 editor tabs、IDE mention specials、文件引用导航和诊断导出四项真实差异，不把能力 flag 作为授权或方法存在性检查的替代品。
- Desktop 的共享 Network & proxy、Question tool、启动失败页 Settings/Configure Pi 接到已有设置页，代理/Pi 路径定位原键。未知 VS Code 设置查询明确拒绝，不扩成通用搜索语法，不改配置或自动重启进程。
- Desktop 隐藏诊断导出入口，文件引用保持可读且不触发不支持的跳转。合成能力 DOM 测试实际挂载 Header、工具卡片和 Markdown 链接；真实宿主测试另验常量和 native 文件/选区/诊断行为。Editor Tab 执行继续由 coordinator/dispatcher 的既有行为测试负责。
- `/editor` 归插件本地注册，Desktop 不再先吞掉 Pi 同名命令再过滤。Panel 的 `/resume` 仍隐藏并本地提示。修掉 PromptEditor 二次注册默认命令导致 panel `/resume` 重新出现的问题，新增实际 CodeMirror 补全列表断言。通用实现仍单一，不重写命令框架。
- 新增 `.agents/skills/dual-maintenance/SKILL.md` 并从 AGENTS 路由，链接真实 SPEC、源码归属、聚焦检查与既有证据边界。未增加 CSS/产品词汇扫描、bundle 标记防复制、每个动作强制 flag 或固定规则数量等机制。

验证：

- `pnpm check` 明确退出 **0**：132 个测试文件 / **872 项测试**，包括 329 项插件测试、291 项共享客户端测试及 47 项 Desktop 测试；双端构建、lint、类型与原插件预算通过。
- `pnpm package:vsix && pnpm verify:vsix` 退出 **0**，仍为 0.15.5 / 78 entries / 2.65 MB；未安装/发布。
- 增强 Electron smoke 修正菜单状态等待后连续通过，最终退出 **0**、`ok: true`。实际点击共享菜单和失败页入口，确认代理/Pi 设置焦点、完整设置页打开、实际 Desktop 不显示 editor-tab/diagnostics 动作；保留此前两个受控 Pi、多 Project、Stop 隔离、字体与设置保存/重开证据。
- 一轮独立限界复核未发现实质缺陷，且补跑了相关 28 项测试；原生事件/焦点未由该复核代验，以上 smoke 单独完成此证据。

未重跑 Extension Host E2E 或完整真实 Pi GUI，不把这些自动检查称为主插件“绝无退化”或 Desktop 首版完成。两份已有 README 暂存链接修正不属于本批提交。

日志：`tmp/r4-check.log`、`tmp/r4-vsix.log`、`tmp/r4-smoke-final.log`；最终 smoke 结果/截图：`C:/Users/EEG/AppData/Local/Temp/frostpi-desktop-smoke-FHAqOT/`。临时材料不是产品依赖。

## state.json 与正常关闭/重开

主目录接入独立 `state.json`，与 settings.json 同目录。外层版本化保存 Project 的稳定 id/name/cwd、选中 Project 和原始键 HostMemento；既有 SessionPersistence 继续解释 `frostpi.sessions.v1`。恢复根目录先于 Registry 构造，不复制聊天正文、工具输出、草稿、图片、私有 launch args 或进程状态。Project alias 去重映射选中项，暂时缺失的目录保留元数据，新增仍需验证存在。

Project/Memento 更新经过同一串行原子写队列。I/O 失败保留 desired memory，正常关闭停止 Pi、等待 Registry 队列和文件队列，文件 flush 可单次重试；校验/序列化失败不能冒充已被文件缓存接收并成功恢复。坏文件不自动重置，错误在 UI/关闭路径明确可见。JSONC/原子 IO 与设置存储共用，继续使用发布 ESM 入口；拒绝库会静默丢弃的 `__proto__` 属性，保护旧文件。

初次独立复核发现两处关闭/恢复问题，已修正并补回归：

- 延迟 New/Resume discovery 在 Registry dispose 后返回，不能再创建 Runtime、排入 metadata 写或启动 Pi；已关闭状态与 queued start 受同一生命周期检查约束，不靠无限循环 flush。
- Desktop 显式使用 `restoreSelection: saved-only`，保存的 null/无效选中项不再回退启动其他历史会话。共享 Registry 默认的 Native saved-or-first 行为保留。用户在初始化中主动关闭窗口作为取消处理，不误报正常启动失败。

最终验证：

- `pnpm check` 明确退出 **0**：133 个测试文件 / **901 项测试**，包括插件 329、共享客户端 295、Desktop 72；lint、类型、双端构建和插件预算通过。
- `pnpm package:vsix && pnpm verify:vsix` 明确退出 **0**，仍为 0.15.5 / 78 entries / 2.65 MB，未安装/发布。
- 最终 Electron smoke 明确退出 **0**、`ok:true`。实际正常 close 后重开稳定 Project/会话身份，读取受控 Pi 自己的合成 JSONL；以进程启动计数验证只启动保存选中项、startOnOpen=false 不启动、最后选中临时会话而存为 null 时不启动其他项。检查原会话 entry IDs 未增加，不自动重发 prompt；Provisional/Ephemeral 不进入保存索引。此前两 Project 并行/Stop 隔离/设置入口等检查仍通过。
- Registry 回归单独释放关闭前延迟的 New/Resume discovery，确认没有新 Runtime/metadata 写入；该用例不启动 Pi。Store 用例覆盖字段交错、读坏文件保护、写失败恢复/排空及未捕获元数据与已接收待写的区别。

没有重跑 Extension Host E2E、真实 Pi GUI，也没有模拟断电、跨进程写入合并或真实 OS ACL/磁盘故障。这里的历史与进程计数来自受控 fixture，不冒充真实模型/完整首版验收。两份已有 README 暂存链接修改仍不属于此批。

日志：`tmp/r5-check-final.log`、`tmp/r5-smoke-final.log`、`tmp/r5-vsix.log`；最终 smoke 结果/截图：`C:/Users/EEG/AppData/Local/Temp/frostpi-desktop-smoke-pno9bN/`。这些临时材料不是产品依赖。

## Windows x64 独立交付候选

已生成 `artifacts/FrostPi-0.15.5-win32-x64.zip`：161,470,583 B（154.0 MiB），解压运行 `FrostPi/FrostPi.exe`。SHA-256：`2ca463a6561188a10f17a4cc62072f61ae226ff31b17ae2a5121faade97dccc2`。版本未改、未签名、未合 main、未公开发布。

- 使用标准 Electron packager、白名单 staging、真实磁盘上的 private Pi artifacts、中文 README 与运行许可声明；Node/Pi 不安装升级，数据仍在现有 FrostPi profile。补齐打包形态的启动 argv，防止丢掉首个目录参数。ZIP/本工具缓存先完整生成再发布，不破坏旧产物。
- `pnpm package:desktop` 退出 0；主 Agent 再跑 `pnpm verify:desktop --real-pi` 退出 0、20 checks。归档在仓库外带空格目录启动，覆盖实际资源/字体、设置、两 Project、受控 Pi 发送/Stop 隔离/历史重开。归档身份由结果中的 SHA 标识，不冒充任意后续源码状态；主 Agent 另比对 69 个 runtime 文件与最终 dist，逐文件字节一致。
- 真实 Pi 1.1.0 使用全新临时 agent/profile、显式离线配置和扩展命令，经实际 exe 的 Composer、确认卡与 custom-message 交互；没有提供凭据或请求模型。该阶段使用 ephemeral，不把内存 custom entry 当成物理 JSONL 历史；真实模型完成/流式 Stop 不由这个阶段证明。
- GUI 式 PATH 来自 Registry 原值和 Windows KnownFolder/被引用的注册表变量，不借开发 shell 自动展开，也不注入当前 Node 目录。本机发现 Node 24.12.0 / Pi 1.1.0；helper 修正后又通过完整 20 checks。它不声称复现某次 Explorer 的旧环境。
- 最终 `pnpm check` 退出 0：134 文件 / 905 测试，双端构建、类型、含 Desktop scripts 的 lint 和原预算通过。VSIX 打包/校验退出 0，仍为 78 entries / 2.65 MB；开发 Electron smoke 同时退出 0。
- 当前插件 E2E 使用缓存 VS Code 1.143.0、独立临时数据和软件渲染，退出 0 且套件完成 marker 为真，覆盖激活、注册和 New/Stop 命令；不是完整 Webview/远程/真实模型验收。runner 添加有界等待与仅停止 owned 进程树的超时处理，1ms 负向实验正确失败。先前宿主失败原因仍未归因，本轮通过不反推旧失败为环境问题。
- 打包实现和有界 API/静态复核使用显式指定的 cheap DeepSeek worker/reader/reviewer；主 Agent 核对实际产物并完成最终回归。采纳了下载代理作用域、依赖归属与证据表述的具体修正，没有增加 ZIP 与随时变化的 checkout 的 mtime 强耦合。

最终日志：`tmp/r6-package-final.log`、`tmp/r6-package-verify-final.log`、`tmp/r6-check-final.log`、`tmp/r6-smoke-final.log`、`tmp/r6-e2e-final.log`、`tmp/r6-vsix-final.log`。主 Agent 的打包结果目录为 `C:/Users/EEG/AppData/Local/Temp/frostpi-desktop-verify-YkRkpI/fixtures/`；PATH helper 末次复验为 `.../frostpi-desktop-verify-YeNLkf/fixtures/`，二者验证的 ZIP SHA 相同。E2E 完成证据为 `.../FrostPi extension E2E RzJFZw/result.json`。这些都是临时验证材料。

## UI 验收修正：字体、K/M 与 Desktop Resume

代码字体与 K/M 修复已 checkpoint 为 `9db7943`：共享 `pre code` 显式继承 family，围栏代码字号规则不变；紧凑数字固定英文单位。修复前回归分别暴露 `monospace` 与中文万单位，修复后 Context DOM 3 项、字体解析 3 项、双构建及开发 Electron smoke 通过。旧 ZIP 未更新。

Resume 经用户原型评审后采用 Desktop 专用的对话区半透明 overlay。用户明确反对将本方案当作通用 status/stats bubble：新增代码与传输仅在 `apps/desktop`，不修改共享客户端或插件源代码，不增加共享桥字段。共享 Registry 仍拥有启动、会话与历史，Desktop 只观察一次 Resume 和其真实 Host 选择/返回投影；原型中的定时子步骤未进入实现。

- `pnpm --dir apps/desktop test`：11 文件 / 88 项通过，其中 12 项新增 Resume/controller dispatcher 回归；覆盖原 Promise 结果/异常、独立异步选择归属、无 Runtime 的即时反馈、按返回 id 跟踪历史而非前台 Pi、失败展示/过期响应、重复 Resume 和关闭后晚到结果。
- Desktop typecheck 0 errors（共享 `ExtensionUiRequestCard.svelte` 原有 1 warning）、lint、构建及增强后的 `test:smoke` 退出 0，结果显式含 `ok: true` 与 Resume 专项标记。
- 受控实际 Electron 检查：发现目录前有提示、列表出现后无忙碌、选择器键盘取消、280px 不横溢、旧对话节点仍挂载、普通布局遮罩不盖输入区、展开布局按用户确认的例外覆盖输入且保留 CodeMirror 节点/草稿/展开状态（Escape 只取消 Resume）、切换其他 Pi 后继续执行并返回同一选择请求、失败关闭，以及实际合成 Pi JSONL 的启动/历史加载到共享 UI；无效 bridge version 不触发 Resume。
- 没有使用真实凭据/模型。未重跑全仓 check 或插件 GUI；源码范围隔离不冒称完整插件体验验收。未重打包/验证新 ZIP，不把上面的开发 smoke 当作独立 exe 的通过证据。设置页、UI 字体、主题和侧栏布局仍未在本批改动。

本批日志：`tmp/desktop-resume-tests.log`、`tmp/desktop-resume-types.log`、`tmp/desktop-resume-lint.log`、`tmp/desktop-resume-build.log`、`tmp/desktop-resume-smoke.log`。截图/结果由 smoke 打印的系统临时目录保存，均为合成会话，不依赖这些临时文件继续维护。

## 尚未证明

用户日常操作的布局/流程满意度、包含关闭/重开的完整真实 Pi GUI、所有用户扩展组合及其他平台尚未验收。草稿跨重启恢复未实现；独立桌面候选已交付，但公开发布与签名未进行。不能把此 checkpoint 宣称为 Desktop 产品完成或发布就绪。
