---
title: 主目录 Desktop 开发接续
created: 2026-10-22T15:49:19+08:00
consumed: false # Reader: set to true once you have read this. Questions about missing context go under "Clarifications".
---

## Assume Reader

零上下文的新 session，可访问仓库与本机 Pi 历史。从**包含本文档的主目录 `feat/desktop-host`** 接手，不切回旧 worktree。交接前 HEAD 为 `beae9ed`，最新产品代码 checkpoint 为 `d0dbc29`；无需回退到交接前提交。

先读仓库根目录下 `.dev/changes/desktop-host/desktop-host.TARGET-SPEC.md` 和 `desktop-host.ORCH.md`。前者是目标与边界，后者已有完整交付路线、当前节点和待决定项；本文不另建一份计划。

## Background / Trajectory

用户要求停止在 WIP worktree 施工。本轮以 `e2cdae9` squash 整合 `wip/desktop-client@7c3f671`，随后在主目录完成一批兼容修复。当前应从设置与维护闭环继续，不重新提取客户端或设计另一套聊天 UI。具体变化与证据见 `.dev/changes/desktop-host/refactor/desktop-client.RESULT.md`。

## Current Status

- 主目录 `feat/desktop-host` 干净；本地 `main@2ed69c1` 未改，未改产品版本、未发布。旧 `.worktrees/261019_desktop-bridge-inputs` 保持 `wip/desktop-client@7c3f671` 干净冻结，只作回退；旧 R1 worktree 也不是施工入口。
- **是核心可运行的开发预览，不是“首版开发完成、只差测试”。** Project、设置和客户端元数据仍在内存；没有完整设置功能、首次导入或正式退出/重开恢复，也没有独立桌面分发产物。用户反馈两端基础功能似乎可用，不是首版总验收。
- `d0dbc29` 的主目录检查：828 项测试、双端构建、VSIX 校验通过；增强 Electron smoke 连续 3 次通过。主目录离线 VS Code 1.129.1 的额外 E2E 启动被系统 `vscode-updating` mutex 阻塞，未运行到插件测试，不能记为通过。不要关闭用户 VS Code、干预更新器或绕过锁来凑通过。
- 没有待接收的后台工作结果。旧可复用 worker #5/#6 的 cwd 固定在冻结 worktree，不要续用它们写代码；需要委派时在主目录新建任务。

## Pending and Next

1. **先统一设置定义/默认值的权威来源。** 对照 `apps/vscode/package.json` 的 `contributes.configuration` 与 `apps/pi-client/src/host/readConfiguration.ts`：目前 16 项默认值一致，但 Native 用 manifest 默认值、Desktop 未配置时用 fallback。仅修改 manifest 会静默分叉；本轮已作内存模拟验证，没有实现修复。保持 VS Code 的 schema/键名语言，具体生成或一致性机制尚未定，不给 Desktop 另抄一张表。
2. 向用户给出设置/首次导入的具体方案并关闭影响行为的未决项，再实现独立配置与必要设置入口。用户期望“一次从 VS Code 导入 FrostPi 和实际依赖的字体等，之后维护 Desktop 自己的配置”。**尚未回答**导入用户级显式配置，还是当前窗口合成后的有效配置；文件位置、Project 覆盖和退出/重开策略也未确认。不要默认读取用户真实设置、合并工作区/Remote 配置，或将 Agent 建议当成已确认决定。
3. 日常使用闭环、主插件最终回归、独立桌面产物及总验收按 ORCH 推进。窗口/进程/草稿恢复的长期保证不能从临时预览反推；技术检查由 Agent 负责，用户只判断体验及产品取舍。
4. 维护规则收齐后增加 `.agents/skills/dual-maintenance/SKILL.md`：按改动类型指导源码归属、适配和最小验证，引用真实 SPEC/命令。它不替代类型/依赖/契约测试，不保存临时进度。公共扩展产物装配及其余共享 UI 测试归属也可按实际变更收尾，不扩大成通用平台。

## Key Information

- 独立审查针对旧快照 `7c3f671`。图标标签、Mermaid、双份样式入口、Desktop 硬编码字体和 streaming fixture 已在 `d0dbc29` 处理，不按旧报告重做：公共样式入口在 `apps/pi-client/src/ui/styles.ts`，字体解析在 `apps/pi-client/src/host/readChatTypography.ts`；两个产品实际消费它们。
- 兼容不是将 `import vscode` 重定向到假模块：共同代码调用有限 ClientHost，VS Code 薄绑定真实服务，Desktop 转换。接口形状通过不等于图标/搜索/配置等语义正确，适配测试必须有辨别力。VS Code 专属能力仍允许只改插件。
- Agent 曾建议“先导入一个选定 Profile 的用户级显式值；缺省键不写入配置，继续采用共享默认值”，这只是建议，用户未确认。`network.proxy.mode = vscode` 不得直接导入后静默改义；Pi 凭据仍由 Pi 管理。
- 从主目录启动：`pnpm --dir apps/desktop start`。锁定依赖和本机 Electron 开发二进制已就位。按节点及时 checkpoint，避免长期大 diff；未获授权不合 main、不发布。继续维护 ORCH 的整体路线，不缩回只有当前状态的交接清单。

## Source Session

加载 `read-pi-session-history` skill，按固定 leaf 用 `--dialogue` 按需读原话，不机械通读长历史。

- 本 session：`C:/Users/EEG/.pi/agent/sessions/--H--SrcCode-playground-FrostPi--/2026-10-19T13-32-51-716Z_01a1545d-6e83-77f7-a210-41067102430d.jsonl`，leaf `1881b4ce`。Entry `840593ea` 是首次设置导入与维护 SKILL 的原始建议；`019844f5` 是移回主目录施工的要求。早期产品目的可按 TARGET-SPEC 的历史指针恢复。
- 独立审查：`C:/Users/EEG/.pi/agent/sessions/--H--SrcCode-playground-FrostPi--/2026-10-21T13-35-23-721Z_01a15eac-7848-74c5-b642-96a28361e2fd.jsonl`，leaf `d4f222df`。结论基于旧快照；先对照当前源码与 RESULT 区分已修复项和剩余问题。
