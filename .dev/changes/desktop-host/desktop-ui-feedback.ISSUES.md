# Desktop UI 使用反馈

最初反馈基线：`feat/desktop-host@dd40c9d`，Windows x64 独立包。此文件记录验收反馈与当前决定，不代替 TARGET-SPEC 或实现计划。**UI-01、UI-02、UI-05、UI-06 已实现并进入更新的 Windows 候选包；设置页与主题仍待讨论。最新 ZIP 身份和验证范围见 [RESULT](refactor/desktop-client.RESULT.md#project-浏览上下文与侧栏)。**

来源：本会话用户反馈 `401ade66`、确认/延期决定 `65ee08a1`；原话读取方法见 `.dev/changes/desktop-host/handover/R5-desktop-ui-continuation.HANDOVER.md`。

## UI-01：Resume 等待期间缺少状态反馈

**状态：Desktop 专用 Resume overlay 已实现，受控 Electron 验证通过，已进入新候选 ZIP。**

- 表现：点击 Resume 后长时间没有可见反馈，像卡住；插件版有进度提示。用户建议悬浮 status bubble，未要求阻塞式弹窗。
- 已查证：`apps/desktop/src/main/desktopHost.ts` 的 `withProgress: (_title, work) => work()` 丢弃了进度呈现；VS Code adapter 调用真实 `window.withProgress`。`apps/pi-client/src/host/catalog/SessionCatalogPicker.ts` 的会话扫描已有 `Finding Pi sessions…` 进度调用。
- 期望：开始查找时尽快给出可见等待反馈，完成/失败后结束；保持界面可操作，不编造百分比、不改变异步结果和错误行为。
- 用户已确认新方向：采用 DeepSeek 独立原型的卡片视觉，改为右侧对话区半透明 overlay，旧对话保留在下层，不再直接隐藏；侧栏、标题和输入区不被正常对话遮罩覆盖。原型在 `tmp/resume-feedback-desktop-overlay.html`（可丢弃，不是运行依赖）。
- 用户已确认展开输入的例外：全屏 Composer 将对话区收起时，遮罩改为覆盖输入区，不改变展开状态或草稿。结束或取消后露出原输入；Escape 只取消 Resume 的选择，不联动折叠输入框。
- 用户明确收窄：这是 **Desktop 专用的 Resume 流程 UI**，不是原先设想的通用 status/stats bubble。实现、样式与有限 main/preload/renderer 传输均在 `apps/desktop`，不修改共享 ClientApp、共享 Registry 或插件进度 UI。
- 实际阶段由 Resume 调用、Host 选择和返回 Session 的投影驱动；查找不等 Runtime，选择期间无忙碌动画，启动排队不冒称已读历史。原型的定时子步骤未带入产品。选择器保留原 Host 项目、分组、搜索与响应 id；Browse/确认仍用原生界面。
- 切换其他 Pi 只隐藏本次遮罩，`Return to Resume` 可回到原请求，不另扫一份列表，也不阻止其他 Pi 执行。重复点击只返回现有 Resume。失败可读且可关闭/重试；取消只在真实选择器生效，关闭窗口不留下晚到的可见状态。
- 验证：Desktop 11 文件 / 88 测试（含新增 12 项 Resume controller/dispatcher 测试）、类型/lint/build 与受控 Electron smoke 通过；覆盖无 Runtime 的 discovery 等待、真实 Host 选择、键盘取消、280px、共享树不重挂载、普通布局不覆盖 Composer、展开布局覆盖输入但保留真实 CodeMirror 节点/草稿/展开状态、后台 Pi 工作、切换/返回、失败清理、无效 bridge version 拒绝，以及合成 Pi 文件的实际启动/历史加载。不是用户真实 Pi 模型体验验收。

## UI-02：代码块真正的文字元素没有使用配置字体

**状态：已修复共享 CSS，并通过受控 Electron 回归，已进入新候选 ZIP。**

- 用户看到代码块仍像宋体。原 `markdown.css` 把字体设置在 `<pre>` 上，但 `.markdown-body pre code` 没有覆盖 Chromium 给 `<code>` 的默认 `font-family: monospace`。现已让该元素显式继承 family，不修改行内 code 或字号规则。
- 回归：`apps/desktop/test/smokeMain.ts` 直接检查 `pre code`；修复前实际 family 为 `monospace` 并失败，修复后配置字体与 `editor.fontFamily` 后备均通过，字号仍为 `chat.fontSize`。
- 实验使用现有打包 exe、隔离 profile 和合成文本，不读取用户真实设置。设置 `editor.fontFamily = Consolas, "Microsoft YaHei", monospace`；实际 DOM 样式和 CDP platform-font 结果：
  - 修正前：`pre` 是配置字体，`code` 是 `monospace`，实际文字使用 **NSimSun（新宋体）**。
  - 仅在临时页面让 `code` 的 `font-family` 继承后：实际变为 **Consolas（英文）+ Microsoft YaHei（中文）**。
- 期望：修复共享样式的实际文字元素，两个产品同时受益；补断言到 `pre code`，不能再次只测父级 `pre` 就声称字体生效。字体列表若缺中文字体，系统仍可能合法回退，不能把 CSS 修复等同于安装缺失字体。
- 语义保持：代码 family 优先 `chat.editor.fontFamily`，未指定时用 `editor.fontFamily`；围栏代码字号沿用 `chat.fontSize`。输入框字号仍由 `chat.editor.fontSize` 控制，不擅自改用 `editor.fontSize`。
- 临时复现材料：`tmp/ui-font-probe.mjs`、`tmp/ui-font-cdp.mjs`、`tmp/ui-font-probe-result.json`。这些不是产品代码或持久依赖，关键证据已在本项保留。

## UI-03：设置页布局与字体设置的表达不清楚

**状态：用户确认需要调整；具体视觉方案尚未定稿。**

- 用户指出 checkbox 单独空占一行、信息松散，整体不好看。当前 `SettingsPanel.svelte` 把布尔项也渲染为键名、说明、独立 input 三段，截图可直接对应这段结构。
- 期望：按控件类型排版，checkbox 与标题形成同一可点击行；说明/状态/Reset 关系清楚，必要操作易找，280px 下仍可用。
- Agent 已建议：可读标题为主、原始 key 为次级信息，整理分组和重复说明。**这只改变呈现，不翻译 settings.json 的键名，不改变显式 Save/Reset/导入预览语义。**
- 字体入口需解释清楚：现有 `chat.*` 是正文/输入框，`editor.fontFamily` 是等宽后备。应用内 UI 基础 family/13px 当前来自 `theme.css`，没有单独的 UI 字体配置。曾提出 `desktop.ui.fontFamily`/`desktop.ui.fontSize`，但它们尚不存在；具体新增键与作用范围需在设置页方案中明确，不把建议说成已实现或已确认的完整设计。原生系统菜单/文件对话框不属于 CSS UI 字体控制。

## UI-04：Desktop 主题来源与切换范围

**状态：记录，后续讨论，不在下一轮自行实现。**

- 用户问当前暗色主题从何而来。事实：`apps/desktop/src/renderer/theme.css` 人工提供固定暗色 `--vscode-*` 调色板，不读取当前 VS Code 主题，也不跟随系统。
- 用户决定：**“我们后面讨论，你可以先记录为 change 中的 issue”。**
- 明/暗/跟随系统、用户调色板和 VS Code 主题导入只是可讨论选项，没有获准具体实现。不因这项反馈顺手引入完整主题引擎或 theme-extension 导入器。

## UI-05：Token 单位固定 K/M，不随语言本地化

**状态：已固定紧凑 formatter 的 en-US locale；中文默认 locale 的 DOM 回归通过。**

- 表现：Context window 显示 `29.2万 / 100万`，用户期望 `1M` 等标准紧凑记法。
- 用户原话：**“NO, 保持 1M；这不是应该翻译的东西”。** 这里的 NO 不是要求保留中文单位，更不是要求翻译 UI。
- 已查证：`apps/pi-client/src/ui/features/usage/ContextUsagePopover.svelte` 原使用 `Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 })`，取系统 locale；相同数字在 zh-CN 为 `29.2万 / 100万`，en-US 为 `292K / 1M`。现仅将紧凑 formatter 固定为 en-US，不修改原始数值或小计数的精确显示规则。
- 回归：`apps/vscode/test/unit/contextUsagePopover.dom.test.ts` 在组件初始化前将未指定 locale 的 Intl formatter 默认设为 zh-CN，并确认其确实输出 `100万`；真实组件仍须显示 `292K / 1M`、`302.5K`、`10K` 和精确的 `500`。修复前失败，修复后 3 项 DOM 测试通过。
- 期望：Token 数量紧凑单位保持 K/M，不因系统或 UI 语言变成万/亿；不改变实际数值。共享呈现修一处进入两端，覆盖中文 locale 的回归，避免只在英文机器上证明通过。

## UI-06：Project 浏览上下文与侧栏

**状态：原型已获用户确认，已实现并通过开发/独立包验证。**

- 原问题不只是排版：添加非首个 Project 不会选中它；点击 Project 也只改变 New/Resume anchor，右侧仍显示另一个 Project 的对话。固定 180px 的侧栏又重复列出全部 Pi，无法隐藏或拖宽。
- 新约定：Project 是浏览上下文。新增 Project 立即选中且不自动创建 Pi；已有 Project 回到上次查看的 Session，空 Project 显示真实空状态。Header 下拉只列当前 Project 的已打开/恢复会话，磁盘历史走 Resume。侧栏仅列 Projects 与运行/待输入聚合，Settings 固定底部。
- 用户明确归属：**“归属当前这个 project，这个行为和 extension 是一致的”。** New/Resume 捕获发起时的 Project；实际 cwd 即使在其他 git worktree，也不自动搬到另一 Project。已打开文件再次 Resume 复用原 Runtime 并归到请求 Project，不复制进程或聊天。Fork 继承源归属；晚到的 New/Resume 不抢走新 Project 的前台。
- 原型不是产品代码：生产采用 Desktop 独立外壳与薄 Project 上下文条，继续使用同一个 ClientApp、Registry 和共享 Header。侧栏支持 180–340px 指针/键盘调宽、真正隐藏/恢复、隐藏后的待输入入口和 280px 临时抽屉；各 Session 草稿、后台进程和输入请求不随导航迁移。
- 维护边界：归属、last-viewed、侧栏和持久化在 Desktop。共享产品源码只改 `SessionRegistry.ts` 的清空前台/打开身份通知，以及 `ClientApp.svelte` 的可选导航 roster；不在共享模块添加 Project 模型或 Desktop 分支，不伪造快照，也不修改 VS Code 入口/适配器。完整 presentation 继续保留所有存活身份，过滤只影响 Header 导航。
- 旧元数据迁移：精确 cwd 对应注册 Project，否则保留在旧 anchor；首次启动对齐真正保存的前台会话。新导航元数据沿用 `state.json` 的 Memento 通道，保存显式归属、last-viewed 和布局；Provisional/Ephemeral 身份按共享 SessionPersistence 过滤，草稿不跨重启保存。
- 验证：全仓 137 文件 / 935 测试、双端构建与预算、增强 Electron smoke 均通过；独立 ZIP 解压后的 exe 通过 16 项受控检查。详见 RESULT，不能把这些证据称为真实模型日常验收。

## 本批验证与暂停边界

- 第一批 UI-02/UI-05 的 checkpoint 为 `9db7943`；Resume checkpoint 为 `7dfa671`；随后按本轮批准的 Project/侧栏模型实现 UI-06。设置页、独立 UI 字体设置与主题尚未修改。
- 通过：Context DOM 3 项、字体设置解析 3 项、共享客户端 typecheck（0 errors，1 项既有 Svelte warning）、修改文件 ESLint、双端构建、受控 Desktop Electron smoke（明确 `ok: true`）。
- 早期 Resume 批次只改 Desktop；Project 批次增加上述两个共享小接缝及回归，没有修改插件入口/适配器。当前完整 check 和新 ZIP 验证已通过；未重跑插件 GUI E2E 或真实模型流程。旧展开目录不会被打包命令自动更新，试用时应关闭旧 Desktop，再将新 ZIP 解压到新目录运行。

## 参考截图

用户提供的本机临时路径如下；不复制包含实际对话的整张截图到 Git。路径可能随临时目录清理失效，上述文字已保留问题本身。

- 设置页 checkbox：`C:/Users/EEG/AppData/Local/Temp/agent-temp/images/clip-20261023-144023-fc52ab31/clipboard-d4a6cc279c5b4ec99582dea63a162772.png`
- 侧栏：`C:/Users/EEG/AppData/Local/Temp/agent-temp/images/clip-20261023-144457-03d7afed/clipboard-1aa9d867a9a440fa9f556b3a8736efa0.png`
