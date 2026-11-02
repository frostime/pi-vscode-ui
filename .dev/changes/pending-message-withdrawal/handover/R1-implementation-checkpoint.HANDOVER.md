---
title: Pending recovery implementation checkpoint
created: 2026-11-01T20:42:33+08:00
consumed: true # Consumed for branch review and the subsequent approved input-lock fix; current progress is in PLAN.
---

# Pending recovery handover

## Assume Reader

Fresh Agent，有当前仓库与 AGENTS.md，没有本次会话上下文。分支 `feat/pending-message-recovery`；此文档与实现一起提交，接手时应从包含本文的 checkpoint commit 开始。写文档前 HEAD 为 `edbd272`（锁定目标/SHAPE）；不要误把它当作包含实现的提交。

先读父目录 `pending-message-withdrawal.TARGET-SPEC.md`，再读 `pending-message-withdrawal.PLAN.md`。SHAPE 已 locked，是不可回改的预测，不是当前进度；RESEARCH 仅在需要运行时证据时读。**当前阶段已按用户意愿停止：实现与聚焦验证完成，最终验收待做。** 不要接手即自动扩大验证或开始新功能；先响应用户下一步安排。

## Source Session

本机会话：`C:/Users/EEG/.pi/agent/sessions/--h--SrcCode-playground-FrostPi--/2026-10-30T18-09-26-899Z_01a18e00-9b72-73cc-b7f7-4d56e589633a.jsonl`。

仅用于意外缺口或查证原话，正常接手不需要读全历史。搜索锚点：

- `不要把 branch 当作 step`：任务分支纪律。
- `就算出错`：失败应可理解，不为 Pi 建立精确同步保证。
- `我没有办法深入细节了`：Agent 承担技术取舍，不让用户选择私有队列机制。
- `不重要就当当前这个阶段完成了`：用户明确允许本阶段停止，完整 gate 留待最终验收。

## Background & User Guidance

实现 issue #10：非中断的批量取回 Steer/Queue，覆盖 Pi/OMP；issue 首选逐条但接受 bulk，用户选择保守 bulk。#11 Usage/百分比修复已经在此前 quasi-main 历史完成，不要混入本任务。

用户关键原话：

> 不要把 branch 当作 step 来用！

调研、原型、实现、验证保持同一分支，用 commits 记录，不新开步骤分支。

> Test 你先确认要做什么测试（语义上），我特别反感为了测试而测试

只测具体行为风险，不给薄 API、getter、字段复制铺测试。简单阅读/测试委派用便宜 preset；此前用户明确拒绝简单任务使用 NO_PRESET。

> 我没有办法深入细节了，因为技术性太强，参考 what-done-means SKILL，梳理我们上面提出的要求条件，然后你来整理方案吧。

用户随后批准 consolidated TARGET-SPEC/SHAPE。不要再让用户决定 FIFO、队列身份或修复类结构；只有改变产品目标/数据安全/核心架构才升级。

用户最近问完整 check 是否重要，并说：

> 不重要就当当前这个阶段完成了

Agent 说明全仓 gate 不阻止实现阶段 checkpoint，但合并/发布前仍需要；用户接着要求 handover + commit。**不是授权删掉验证要求，不是要求此刻继续跑全部检查。**

## Trajectory

1. **研究与原型（已确认）**：真实 RPC 证明 Pi clear_queue 是尽力文本取回，OMP 是确认的 first-text-match 移除；无共同逐条 ID。用户批准批量、不 abort、不重排、保留草稿和附件保守边界；原型 group-level Restore all、前置空行合并已获同意。
2. **Pi 投影 spike（已验证事实，已收窄责任）**：旧输入已被选中，取回后仍会投递；当前 FIFO 会借用新气泡文字/图片，属于必须修的对话内容错误。真实四组 trace 又证明 Pi 自己的同文展示队列也可能错误归零。用户要求按概率与规避思路控制复杂度，最终不增加“待确认”气泡/影子队列/重试/精确同步。真实对话必须准确；竞态中气泡提前消失允许，取回反馈须说明不保证取消，重新发送是新提交。日常发生率未知，不称“已证实罕见”。
3. **设计锁定（`edbd272`）**：用户明确接受 `QueuedPromptRecovery` class，一个实例对应当前子进程；Runtime 只接线。持久身份归 Projection，草稿归原 Host/cache 或 Webview sync；locked SHAPE 未在实现中改写。
4. **实现（本 checkpoint）**：原始 API + class + Runtime/Projection、Host cache ownership window、bridge 3.4、共享入口和反馈、Desktop 有限超限降级全部接通。新集成 fixture 把实际 ClientApp/Host/Registry/Runtime 连到真实子进程传输，非仅孤立 mock 回填。相邻模块契约和 feature map 已更新。
5. **聚焦验证（通过但不是最终 gate）**：见 PLAN 精确记录。真实安装 Pi 1.4.0/OMP 18.12.6 与 FrostPi Runtime 已通过合成 provider 隔离探测；OMP 会把 PNG 转成 WebP，按实际返回图片恢复是正确行为，不应坚持恢复本地旧 PNG 字节。独立审查无 Critical/Warning。
6. **全仓 gate（尝试，未完成）**：两次 `pnpm check` 均在新增 lint 问题停止；相关修正已做，但最终未重跑全 gate。用户允许以实现阶段完成停止，本 handover 不宣称可发布。

## Current Status

- 单 worktree：`H:/SrcCode/playground/FrostPi`，分支 `feat/pending-message-recovery`。无新分支，无 merge/push。
- 写文档前 38 个 tracked 文件修改、9 个新生产/测试文件；随后更新 PLAN/RESEARCH 并新增本文。全部属于本任务，应随此次 checkpoint 提交；没有待续写的半成品文件。
- 新生产 owner：`apps/pi-client/src/core/sessions/QueuedPromptRecovery.ts`、`src/shared/model/queuedPromptRecoveryModel.ts`、`src/ui/features/composer/queuedPromptRecoveryStore.svelte.ts`。
- 核心接口：`restoreQueuedPrompts` 请求携带 requestId/sessionId/draftImageCount；结果分 `host-applied`（不带 content）与 `webview-merge`（前置合并最新草稿）。未知/重复结果不应用。
- Host tab 关闭中的恢复以 token window 保持 Host draft authority；Sidebar 在这个窗口同步新编辑。普通 Sidebar 仍是本地草稿，pending result 时暂时不能 externalize，避免转交旧草稿。
- Projection 的恢复模式不借队首内容；按实际 user event 渲染，保留旧 FIFO 记账。持久 refresh 不结束模式；settled、abort/stop/failure 的 queue reset 结束。
- 最后未再验证的改动：Host 测试增加压缩场景；UI Host-applied 图片缺失反馈参数化；Desktop lint matcher 修正；runtimeCompatibility 测试补新 capability 预期。不要把早先通过结果套到这些最后修正上。
- 所有委派工作已返回结果，无待回收任务。本轮未启动原生 GUI。`tmp/` 为 ignored 实验材料，不随 commit 提交，也不是新环境必须存在的依赖。

### 证据与限制

- 最后本机 core lint 已通过；共享 client build 曾通过。
- 核心/Runtime/Projection/OMP 76 项；旧 Host 26 项；新 Host 最初 5 项；UI 修正后 19 项、连同旧两文件 41 项；Desktop publisher 4 项通过，详见 PLAN 对后续修正的限制。
- `apps/vscode/test/unit/queuedPromptRecovery.integration.dom.test.ts` 两项最后通过，贯穿真实 root UI→Host→Registry/Runtime→受控 child→最新草稿；不等于真实 native GUI。
- ignored 日志：`tmp/pending-recovery-check.log`、`tmp/pending-recovery-check-r2.log`。第一轮 pi-client lint，第二轮 Desktop matcher lint；均未进入全仓 typecheck/test/build/bundle。两轮已做版本 gate，勿照抄子代理“version 未运行”的摘要错误。
- ignored Runtime 实验：`tmp/queue-recovery-spike/client-runtime.mjs`；最终 summaries 在 `client-pi-n2Pp4O/`、`client-omp-hGvXuI/`。Pi 0 network attempts；OMP 12 blocked startup attempts；无外部模型或真实凭据。
- 实际 GUI、完整全仓 gate、最终 diff/SHAPE 漂移审查待做；未合并/发布。

## Pending and Next

1. 先核对当前 HEAD、工作区和 PLAN，然后等待/响应用户安排；当前请求只要求保存并提交，不继续验证。
2. 若下一轮授权做最终验收，优先运行最后变更的聚焦检查：
   - `pnpm --dir apps/pi-client exec vitest run test/host/queuedPromptRecoveryDispatch.test.ts test/unit/QueuedPromptRecovery.test.ts test/unit/ConversationProjection.test.ts test/unit/runtimeCompatibility.test.ts`
   - `pnpm --dir apps/vscode exec vitest run test/unit/queuedPromptRecovery.dom.test.ts test/unit/queuedPromptRecovery.integration.dom.test.ts test/unit/clientUiCapabilities.dom.test.ts`
   - `pnpm --dir apps/desktop exec vitest run test/desktopPublisher.test.ts`
3. 再运行 `pnpm check`，大输出保存在 ignored tmp；按实际错误处理，不把 root driver 在 lint 停止说成后续测试失败。此前 #11 Desktop 默认并行曾超时、单 worker 174 项通过；这是历史线索，不是当前 gate 通过或擅自调大超时的理由。
4. GUI 验证依 `.dev/docs/testing.md` 的现有 Desktop CDP smoke/VS Code Host 路径；不要另建自动化框架。Desktop native GUI 要完整 build，JS build 不刷新嵌入 renderer，且应提前告知用户会打开窗口。不要求为了本 checkpoint 构建 Desktop native。
5. 最终 diff 与 locked SHAPE 对照：Runtime 仍为小接线，新增 SessionHeader guard 是有限草稿协调；可能的 UI 行数增长及测试 fixture 需如实记录，不改 locked SHAPE 来追认。合并前用户需另行授权；不要 push。

### 不要重复的死路

- 不以 text/timestamp 相等建立新身份；不相信 Pi pending 数量就宣称精确取消。
- 不清空后重排、不自动重试未知 text-match 移除、不直到整轮结束锁发送。
- 不恢复“待确认”气泡设计，不为了泛兼容无限扩建机制。
- 不为 OMP 图片转换改回本地旧附件猜测；恢复实际返回并按现有限制校验。
- 不改 locked SHAPE，也不把此 checkpoint 叫最终验收完成。
