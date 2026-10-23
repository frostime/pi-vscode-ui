---
title: Desktop 独立候选 UI 验收修正接续
created: 2026-10-23T16:11:25+08:00
consumed: false # Reader: set to true once you have read this. Questions about missing context go under "Clarifications".
---

## Assume Reader

零上下文的新 session，从主目录 `H:/SrcCode/playground/FrostPi` 的 `feat/desktop-host` 接续，不回旧 worktree。产品代码基线为 `dd40c9d`；本文及问题记录可能位于随后文档提交，不要求 checkout 回该 hash。先读 TARGET-SPEC、ORCH 和本 change 的 `desktop-ui-feedback.ISSUES.md`；问题文件是本轮反馈/决定的唯一细化清单。

## Background Context / Trajectory

独立 Windows x64 ZIP 已交付，用户进入真实使用验收，反馈 Resume 无等待提示、代码字体、设置页、主题、Token 单位和侧栏。本轮只读调查并在隔离字体实验中定位问题；用户随后要求先交接。不是重新设计共享客户端，也不是重跑整个交付工程。

## Current Status

- 产品代码仍为 `dd40c9d`，没有实施本轮 UI 修复。交接前工作区除新 issue 文档外干净，无待处理 README 暂存改动；文档收尾提交后再核对 HEAD。
- 已有 `artifacts/FrostPi-0.15.5-win32-x64.zip`，解压运行 `FrostPi/FrostPi.exe`。基线记录：905 测试、双构建、VSIX、插件受控 E2E 与实际 exe 的 20 checks 通过。具体证据与边界见 `refactor/desktop-client.RESULT.md`，无需重复收集。
- 该 ZIP 尚含本轮 UI 问题，不能把旧验证说成本次修复验证。没有真实模型完整日常体验总验收；未合 main、未改版本、未签名/公开发布。
- 字体 probe、CDP 副本及输出仅在 `tmp/ui-font-*`，不属于产品代码。只读 subagent 的报告已接收，无待接收/运行中的子任务。

## Pending and Next

1. 处理问题清单中已确认的 **UI-01（Resume 反馈）、UI-02（代码字体）、UI-05（固定 K/M）**。UI-02 已有实际渲染证据，不需要重新猜用户字体配置；回归必须测真正的 `pre code`，而不只测 `pre`。
2. 调整 **UI-03 设置页**。用户确认要改，但具体视觉方案未定；按控件类型改善 checkbox/标题/说明布局，原始存储键和 Save/Reset/导入语义保持。UI 字体独立设置的键名及作用范围仍应在此方案中明确；不要说 `desktop.ui.*` 已存在。
3. **UI-04 主题、UI-06 侧栏仅记录，后续与用户讨论**。不得将上一条 Agent 的三档主题、折叠/调宽布局草图当作已批准实现。
4. 对实际 diff 选择聚焦验证，按 dual-maintenance 路由共享 UI/适配检查。修复完成后重新打包并验证新的 ZIP/hash，再更新 RESULT/ORCH；旧候选的测试/归档 hash 不自动证明新包正确。按已授权方式 checkpoint，不擅自合 main/发版。

## Key Information / User Guidance

- 用户最新决定：1、2 要 fix，3 要调整；4 与 6 延后讨论。对第 5 项的原话是 **“NO, 保持 1M；这不是应该翻译的东西”**：要求 K/M 不随语言翻译，不是保留当前 `100万`，也不是中文化 UI。
- 用户要求记录 theme issue，已落在 `desktop-ui-feedback.ISSUES.md`；侧栏同文件保留需求，不另起平行 backlog 或改 TARGET 的全局架构方向。
- 常规委派必须用便宜模型。用户原话：**“如果是便宜任务，请交给便宜的 deepseek-flash”**。使用合适 preset（如 worker/reader）并核对其模型；需要时显式选 `opencode-go/deepseek-v4.1-flash`。禁止随意 `NO_PRESET` 而省略模型，导致继承昂贵 Sol。
- 不读取用户真实 settings/profile 来猜问题，不用真实凭据/模型跑字体诊断。截图含实际对话，暂不复制整张到 Git。两张临时图片路径与复现细节已在 issue 文件记录。
- 维持 VS Code 主产品、共享实现与有限 Host 边界；Desktop 补适配，不重写聊天。原始 dot keys、`--vscode-*` 及已明确代码字号语义继续保留。

## File Reference Map

- `.dev/changes/desktop-host/desktop-ui-feedback.ISSUES.md`：六项反馈、确认/延期状态、字体实验、截图路径及定位。
- `apps/desktop/src/main/desktopHost.ts`、`apps/pi-client/src/host/catalog/SessionCatalogPicker.ts`：进度适配与会话扫描。
- `apps/pi-client/src/ui/styles/markdown.css`：代码实际文字元素的字体修复；`apps/pi-client/src/host/readChatTypography.ts`：既有语义。
- `apps/pi-client/src/ui/features/usage/ContextUsagePopover.svelte`：系统 locale 引入中文 Token 单位的位置。
- `apps/desktop/src/renderer/SettingsPanel.svelte`：设置 UI；`DesktopApp.svelte`、`theme.css`：后续侧栏/主题讨论的现实现。
- `.agents/skills/dual-maintenance/SKILL.md`、`.dev/docs/testing.md`、`.dev/docs/release.md`：源码归属、验证范围与 `package:desktop` / `verify:desktop` 流程。

## Source Session

加载 `read-pi-session-history` skill，只按需读对话原文，不机械通读工具日志。

- 文件：`C:/Users/EEG/.pi/agent/sessions/--H--SrcCode-playground-FrostPi--/2026-10-22T07-59-45-641Z_01a1629f-8bd3-71be-a563-1cccecc26d8f.jsonl`
- 固定 leaf：`b9df5123`（包含下面关键决定）。用 `read ... --leaf b9df5123 --dialogue --entry <ID>`。
- `401ade66`：用户完整 UI 反馈与图片；`273daac4`：诊断/方案回应，其中主题、侧栏等建议不能冒充确认；`65ee08a1`：用户逐项确认及交接要求；`1c80fc94`：便宜 subagent 模型要求。
