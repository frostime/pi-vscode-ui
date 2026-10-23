---
title: Desktop UI 验收修正接续
created: 2026-10-23T16:37:31+08:00
consumed: true # Reader: set to true once you have read this. Questions about missing context go under "Clarifications".
---

## Assume Reader

面向零上下文的新 session，在 `H:/SrcCode/playground/FrostPi` 主目录的 `feat/desktop-host` 接手。本文替代 R4 作为执行交接；不要回旧 worktree，也不要 checkout 旧产品提交。交接前 HEAD 为文档提交 `6fbc450`，产品代码为 `dd40c9d`；本文提交后 HEAD 可以更晚。

**无需读取旧 session 即可按本文继续。** TARGET-SPEC 是长期目标，ORCH 是整体交付路线，`desktop-ui-feedback.ISSUES.md` 是问题跟踪记录；这些材料用于核对和更新，不承担本文漏写的隐含前提。历史读取只用于出现疑点时查漏、核实原话，不能作为重新拼装任务的前置步骤。

## Background Context

FrostPi 的 VS Code 插件是主产品，Desktop 是复用同一客户端的副产品。共享实现已经迁到 `apps/pi-client`，通过有限的 `ClientHost` 装配两种宿主。目标仍是方便不同目录多开 Pi，而不是内置 IDE、追求两端功能对等或重写聊天 UI。

当前不是“继续做打包”：独立 Windows x64 包已经交付，用户正在实际使用，现要处理这一轮明确的 UI 反馈。设置与 Project/会话索引持久化、正常退出停止 Pi、重开恢复入口均已实现，不要重新规划这些已完成部分。

## Current Status

- 本轮 UI **没有修改任何产品代码**；只有调查、字体实验和文档。R4/issue 文档已提交为 `6fbc450`，本交接开始时工作区干净，无 README 暂存改动。
- 候选为 `artifacts/FrostPi-0.15.5-win32-x64.zip`，161,470,583 B，解压运行 `FrostPi/FrostPi.exe`。现有展开目录 `artifacts/FrostPi/` 中也有 exe。它们仍含下面的 UI 问题。
- 该包 SHA-256：`2ca463a6561188a10f17a4cc62072f61ae226ff31b17ae2a5121faade97dccc2`。Electron 随包，外部 Node/Pi 是前置条件；数据仍在系统应用数据目录的 FrostPi profile，不是 USB 数据便携模式。
- 产品基线通过 134 文件 / 905 测试、类型/lint、双构建、VSIX、开发 Electron smoke、插件受控 E2E，以及打包 exe 的 20 checks。真实 Pi 1.1.0 只做了无凭据、无模型调用的离线命令/确认卡/自定义消息验证。不能称为真实模型完整日常体验验收。
- 所有验证记录描述旧候选，不是下面修复的通过证据。未改产品版本、未合 main、未签名、未公开发布。无待接收的子任务或仍在运行的字体实验进程。

## Trajectory

打包交付后，用户报告了六组 UI 问题。调查确认：Desktop 把已有 Host 进度反馈变成了无呈现的执行；代码块外层字体设置正确，但文字所在的 `code` 元素仍用了 Chromium 默认字体；Token 中文单位来自前端的系统 locale。设置页与侧栏问题能直接对应现有组件布局。用户最后明确了哪些现在修、哪些以后讨论；还纠正了交接方式：不能用 session read 替代认真整理可执行上下文。

## 用户决定与执行边界

| 项目 | 最新决定 | 本轮范围 |
|---|---|---|
| Resume 等待反馈 | “OK 需要 fix” | 补即时、可见且真实的进度反馈 |
| 代码字体 | “ok fix” | 修复真正的文字元素；保持设置语义 |
| 设置页 | “需要调整” | 做布局/可读性改良；具体视觉方案尚未定稿 |
| 主题 | “我们后面讨论，你可以先记录为 change 中的 issue” | 已记录 UI-04，不自行增加切换/导入器 |
| Token 单位 | “NO, 保持 1M；这不是应该翻译的东西” | 固定 K/M，不能继续显示万/亿，也不改实际 token 数值 |
| 侧栏 | “侧栏我们放到后面也需要讨论” | 已记录 UI-06，不先按 Agent 草图重做 |

第 5 项的 NO 是反对单位本地化，不是要求保留当前 `100万`，也不是要求把产品 UI 中文化。原始配置键名、显式 Save/Reset 与导入预览规则仍有效；UI 标题变得易读不等于把存储键改名。

## 工作知识：三个确定问题

### 1. Resume 反馈为什么丢了，修在哪里

- `apps/vscode/src/extension/clientHost.ts` 把 `withProgress` 绑定到真实 VS Code Window progress。
- `apps/desktop/src/main/desktopHost.ts` 当前却是 `withProgress: (_title, work) => work()`。它保留了工作结果，却没有任何进度呈现。
- `apps/pi-client/src/host/catalog/SessionCatalogPicker.ts` 已用 `withProgress("Finding Pi sessions…", …)` 包裹会话扫描。恢复入口在 `apps/pi-client/src/host/SessionRegistry.ts`，在进入 catalog 之前还会等待工作目录 discovery。

因此问题不是先去优化 Pi 模型，也不能只靠已有会话的 running 状态显示忙碌：查找列表时可能还没有 Runtime。需要尽快覆盖“准备/查找列表”这段等待；用户选好会话后，再根据真实启动/历史加载状态呈现后续阶段。列表已出来等待用户选择时，不要继续误标为“正在恢复进程”。

用户接受修反馈，曾建议悬浮 status bubble。可采用不遮挡交互的小气泡/状态条；具体位置可按现有布局决定。完成、取消或失败后都应收尾，并保留原 Promise 返回值/异常。不要伪造百分比、添加实际不支持的 Cancel，也不要为此串行锁住所有 Pi。Desktop 的 main/preload/renderer 必须仍走有限接口，不向组件传 raw Pi events。

### 2. 宋体不是靠猜测得到的结论

当前共享样式 `apps/pi-client/src/ui/styles/markdown.css`：

- `.markdown-body pre` 用 `font:` 设置 family/size。
- `.markdown-body pre code` 只有背景/display 等规则，没有 family。
- Chromium 对 `code` 自己声明了默认 `font-family: monospace`。这条直接声明优先于从 `pre` 继承，所以“检查父级已经正确”不能证明代码文字正确。

隔离实验实际启动了现有打包 exe，使用自建 profile 和合成文本，没有读取用户真实配置或运行 Pi。设置 `editor.fontFamily` 为 `Consolas, "Microsoft YaHei", monospace`：

| 检查 | 原页面 | 仅临时设置 `code.style.fontFamily = "inherit"` 后 |
|---|---|---|
| `getComputedStyle(pre).fontFamily` | 指定字体链 | 同左 |
| `getComputedStyle(code).fontFamily` | `monospace` | 指定字体链 |
| CDP 实际绘制字体 | NSimSun / 新宋体 | Consolas 英文 + Microsoft YaHei 中文 |

这是已复现的 CSS 继承缺口，不要回头要求用户重填字体、盲目追加字体名或重写配置解析器。直接检查共享规则是否应让实际 `pre code` 继承 family，并将回归落到这个元素。行内 code 当前已有 family 规则，不能无差别重置所有 Markdown 字体。

既有设置关系要保留：

| 区域 | family | size |
|---|---|---|
| 正文 | `chat.fontFamily`；default 时 UI 字体 | `chat.fontSize` |
| Composer | `chat.editor.fontFamily`；default 时 UI 字体 | `chat.editor.fontSize` |
| 围栏代码块 | 优先 `chat.editor.fontFamily`；default 时 `editor.fontFamily` | `chat.fontSize` |
| 应用内 UI | 当前是 Desktop 主题给出的基础 UI family | 基础 13px，另有局部/派生字号 |

不能为修代码块擅自改成 `editor.fontSize`。CSS 修复也不保证用户未安装的字体会出现；示例中的中文 fallback 是实验输入，不是已决定的新产品默认值。

实验材料在 `tmp/ui-font-probe.mjs`、`tmp/ui-font-cdp.mjs`、`tmp/ui-font-probe-result.json`。它们只是可丢弃复现工具；即使临时文件消失，上述输入、观测和反事实已足够重建实验。

### 3. 1M 为什么变成 100万

`apps/pi-client/src/ui/features/usage/ContextUsagePopover.svelte` 的模块级 formatter 是 `Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 })`。undefined 采用默认 locale；已验证同一组输入：

```text
292000 / 1000000
zh-CN -> 29.2万 / 100万
en-US -> 292K / 1M
```

修的是共享前端格式，不是 Pi 数值、Context window 容量或 RPC。使用稳定的 K/M 表达即可，不能把“系统语言变中文”当成应翻译单位的理由。现有测试入口为 `apps/vscode/test/unit/contextUsagePopover.dom.test.ts`；回归需要真的覆盖中文默认 locale 条件，不能只改 navigator.language、仍让 Intl 用英文默认值后声称覆盖。

## 设置页：确定要改什么，尚未决定什么

入口为 `apps/desktop/src/renderer/SettingsPanel.svelte`，不是插件的原生设置页。当前 generic renderer 把布尔项拆成“原始 key 标题 / 说明 / 单独 checkbox”，这正是截图空一行的来源。另有重复说明、技术键抢主视觉、分组和操作层次弱的问题。

可按控件类型整理：checkbox 与可读标题同一可点击行，说明和原 key 作为次级信息，Default/Explicit/Reset 关系清楚；不要把 Reset 按钮嵌进会触发 checkbox 的 label。普通输入/数字/JSON 编辑保持清楚的 label 与帮助。280px、键盘和 focus 仍应可用。沿用现有语种，不因用户用中文交流就默认开展完整翻译。

保持功能契约：Save 才落盘/应用；Reset 删除显式值；Import 是可编辑预览，未保存前不能改全局实时字体；坏文件保护、Reload、代理处理不重写。展示名可以友好，但 settings.json 仍保留全部原始 dot keys。

用户也问“UI 字体怎么设置”。目前没有这类入口，theme.css 给出静态基础值。曾提出 `desktop.ui.fontFamily` / `desktop.ui.fontSize`，这是候选设计，不是现有键或已定稿功能。可在设置页方案中明确是否新增及作用范围；这不阻塞已明确的代码字体、数字格式、进度和 checkbox 改良。若新增，必须真正控制对应界面，不能只加表单；不得拿 chat/editor 字号冒充 UI 字号，也不承诺改变 Windows 原生菜单/文件选择器。不要重新打开已结束的 Project/Profile 导入范围讨论。

## 延后的两项：保留问题，不擅自实现

- **主题**：当前 `apps/desktop/src/renderer/theme.css` 是人工固定暗色 `--vscode-*` 调色板，不读取当前 VS Code 主题，也不随系统切换。明/暗/系统切换、导入主题等都还没有获准具体实现。用户要求先记录，UI-04 已记录。
- **侧栏**：`DesktopApp.svelte` 目前固定 180px，窄窗时压成顶部 100px；Projects、All open Pi、Settings、说明文字直接排列。用户想折叠/隐藏、拖动调宽和更清楚的栏目层次，但最后明确留待讨论。Agent 的三段布局、Settings 固定底部、覆盖式窄窗导航、宽度保存均不是定稿。以后调整也必须保留单一 ClientApp、Project anchor 与当前 Pi 独立、后台任务和输入归属；不能因折叠而重建客户端。

用户图片仍在本机临时路径，可能被清理；问题文字不能依赖图片存在：
- 设置页：`C:/Users/EEG/AppData/Local/Temp/agent-temp/images/clip-20261023-144023-fc52ab31/clipboard-d4a6cc279c5b4ec99582dea63a162772.png`
- 侧栏：`C:/Users/EEG/AppData/Local/Temp/agent-temp/images/clip-20261023-144457-03d7afed/clipboard-1aa9d867a9a440fa9f556b3a8736efa0.png`
不要把包含实际对话的整张截图复制到 Git。

## Pending and Next

1. 核对工作区仍在主目录当前分支，按上面的已知因果先修代码字体和 K/M，补到真实受影响元素/locale 的回归；不要重跑字体成因猜测。
2. 补 Desktop Resume 的可见等待反馈，连同必要的有限进度传输与清理。验证开始等待、正常结束、失败/取消，以及尚无 Runtime 时的反馈；不扩成任务调度框架。
3. 对设置页给出具体改良候选并调整现有组件，保存/导入行为不变；UI 字体独立设置的未决范围单独说清，不用主题或侧栏的大改拖住前三个问题。
4. 在 issue 中更新实际结果，保留主题/侧栏待讨论。只对实际改动扩大验证，完成时更新 RESULT/ORCH 并 checkpoint。
5. 交付修复包：源码改变不会改变旧 ZIP。重新打包、验证新的归档并记录其 hash，明确哪个包已修。不要仅交源码却让用户继续试旧包，也不要擅自合 main、改版本或发布。

## 验证接缝与现有命令

- 代码 family 解析单测：`apps/pi-client/test/host/readChatTypography.test.ts`，它验证设置语义，不会检测浏览器 UA 的字体覆盖。真正的 CSS 回归应扩展 `apps/desktop/test/smokeMain.ts` 的现有 typography 检查到 `pre code`；不要只测父级。打包验证脚本是 `apps/desktop/scripts/verify-package.mjs`。
- Resume adapter 可从 `apps/desktop/test/desktopHost.test.ts` 扩展；UI/时序需要受控 Electron 验证，不能以 stub 被调用代替可见反馈。
- 设置已有 store/controller/import 测试在 `apps/desktop/test/`，不要为重排布局复制或替换它们。共享 UI 的 DOM 测试设施目前在 `apps/vscode/test/unit/`；按 `.agents/skills/dual-maintenance/SKILL.md` 选归属。
- 开发验证：`pnpm --dir apps/desktop build` 后 `pnpm --dir apps/desktop test:smoke`。公共 UI/Host 边界完成后按影响跑 `pnpm check`。不需要每次小改都把所有 E2E/打包重复一遍。
- 最终包：`pnpm package:desktop`、`pnpm verify:desktop`。`--real-pi` 是可选的真实 Pi 离线探针，仍不使用模型/凭据，不等于真实模型历史和 Stop 验收。具体命令约定在 `.dev/docs/release.md`。
- 905 测试、旧包 20 checks、受控 Pi、真实 Pi 离线命令、真实模型体验是不同证据，不能互相替代。现有包尚有本轮 bug，本身就说明旧通过不等于这些新问题不存在。

## User Guidance

用户明确反对把 session read 用作交接偷懒手段：必要判断和工作知识应在本文交代；历史仅用于规避 unknown unknown、查漏与高分辨率核实，不强迫继任者通读长历史。

常规委派使用便宜模型。用户原话：“如果是便宜任务，请交给便宜的 deepseek-flash”。选适合的 preset 并确认模型，必要时显式 `opencode-go/deepseek-v4.1-flash`；不要 `NO_PRESET` 又省略模型而继承昂贵 Sol。不要用额外评审/泛化改造拖延明确的交付。

不要读取真实 settings/profile 来猜字体，不用真实模型/凭据跑 UI 诊断，不干预用户 VS Code/更新器。维持 VS Code 为参考环境，不改 `--vscode-*` 语言，不让共享组件依赖产品运行时，不新增全局 Pi 并发锁。

## Source Session（可选查漏，不是必读材料）

文件：`C:/Users/EEG/.pi/agent/sessions/--H--SrcCode-playground-FrostPi--/2026-10-22T07-59-45-641Z_01a1629f-8bd3-71be-a563-1cccecc26d8f.jsonl`。固定 leaf：`4aaf69f0`。需要时加载 read-pi-session-history skill，以 `--dialogue --leaf 4aaf69f0 --entry <ID>` 定点读，不机械通读。

- `401ade66`：完整 UI 反馈；`273daac4`：Agent 诊断/候选方案；`65ee08a1`：用户逐项确认/延期。
- `1c80fc94`：便宜 subagent 要求；`12a01d32`：用户对上一版 handover 的质量纠正。
