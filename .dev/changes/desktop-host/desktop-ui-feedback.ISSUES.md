# Desktop UI 使用反馈

基线：`feat/desktop-host@dd40c9d`，Windows x64 独立包。此文件记录验收反馈与当前决定，不代替 TARGET-SPEC 或实现计划。**下面各项尚未修复；本轮只做调查与交接。**

来源：本会话用户反馈 `401ade66`、确认/延期决定 `65ee08a1`；原话读取方法见 `.dev/changes/desktop-host/handover/R5-desktop-ui-continuation.HANDOVER.md`。

## UI-01：Resume 等待期间缺少状态反馈

**状态：已确认需要修复。**

- 表现：点击 Resume 后长时间没有可见反馈，像卡住；插件版有进度提示。用户建议悬浮 status bubble，未要求阻塞式弹窗。
- 已查证：`apps/desktop/src/main/desktopHost.ts` 的 `withProgress: (_title, work) => work()` 丢弃了进度呈现；VS Code adapter 调用真实 `window.withProgress`。`apps/pi-client/src/host/catalog/SessionCatalogPicker.ts` 的会话扫描已有 `Finding Pi sessions…` 进度调用。
- 期望：开始查找时尽快给出可见等待反馈，完成/失败后结束；保持界面可操作，不编造百分比、不改变异步结果和错误行为。
- 注意：Resume 在目录 discovery、扫描列表、选中后启动/加载历史间有不同阶段，不能只在已有 Runtime 开始后才显示状态，也不能在用户选择期间谎称正在恢复进程。具体位置/样式可采用轻量气泡，不需重造通用任务框架。

## UI-02：代码块真正的文字元素没有使用配置字体

**状态：根因已复现，用户确认需要修复；尚未修改产品代码。**

- 用户看到代码块仍像宋体。当前 `markdown.css` 把字体设置在 `<pre>` 上，但 `.markdown-body pre code` 没有覆盖 Chromium 给 `<code>` 的默认 `font-family: monospace`。
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

**状态：用户已明确规则，待修正。**

- 表现：Context window 显示 `29.2万 / 100万`，用户期望 `1M` 等标准紧凑记法。
- 用户原话：**“NO, 保持 1M；这不是应该翻译的东西”。** 这里的 NO 不是要求保留中文单位，更不是要求翻译 UI。
- 已查证：`apps/pi-client/src/ui/features/usage/ContextUsagePopover.svelte` 使用 `Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 })`，取系统 locale；相同数字在 zh-CN 为 `29.2万 / 100万`，en-US 为 `292K / 1M`。
- 期望：Token 数量紧凑单位保持 K/M，不因系统或 UI 语言变成万/亿；不改变实际数值。共享呈现修一处进入两端，覆盖中文 locale 的回归，避免只在英文机器上证明通过。

## UI-06：侧栏折叠、宽度与栏目布局

**状态：记录，需后续讨论，不在下一轮直接重做。**

- 用户期望可折叠隐藏、拖动调宽；Projects / Open Sessions / Settings 挤在一起，缺少设计层次。
- 当前事实：`DesktopApp.svelte` 固定 180px，窄窗口改为顶部 100px 区域；Settings 和说明文字直接跟在会话列表后。
- 用户决定：**“侧栏我们放到后面也需要讨论”。**
- Agent 的三段布局、Settings 固定底部、窄窗覆盖式导航、宽度保存等均只是提议，未形成定稿。后续讨论需保持聊天为主体、隐藏后可恢复并能发现待输入会话；折叠/调宽不能重建 ClientApp、停止后台 Pi 或混淆 Project anchor 与当前会话。

## 参考截图

用户提供的本机临时路径如下；不复制包含实际对话的整张截图到 Git。路径可能随临时目录清理失效，上述文字已保留问题本身。

- 设置页 checkbox：`C:/Users/EEG/AppData/Local/Temp/agent-temp/images/clip-20261023-144023-fc52ab31/clipboard-d4a6cc279c5b4ec99582dea63a162772.png`
- 侧栏：`C:/Users/EEG/AppData/Local/Temp/agent-temp/images/clip-20261023-144457-03d7afed/clipboard-1aa9d867a9a440fa9f556b3a8736efa0.png`
