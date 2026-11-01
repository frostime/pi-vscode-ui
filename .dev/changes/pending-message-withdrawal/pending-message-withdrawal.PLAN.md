# Pending message recovery — PLAN

目标：同目录 `pending-message-withdrawal.TARGET-SPEC.md`（accepted）。实现前预测：`pending-message-withdrawal.SHAPE.md`（locked，不在实施中改写）。运行时事实：`RESEARCH.md`。接手入口：`handover/R1-implementation-checkpoint.HANDOVER.md`。

分支：`feat/pending-message-recovery`。同一任务内用 checkpoint commits，不按步骤开分支或 merge。

## Mainline

1. **RPC、恢复协调和实际内容投影 — 实现及聚焦验证完成。** [I1][I2]：专用 class、原始 API、Runtime 接线和恢复模式均已接入。核心/Projection/Runtime/OMP 聚焦运行曾通过 76 项。
2. **Host 草稿交付和共享 UI — 实现及聚焦验证完成。** [I3][I4]：来源授权、最新草稿、tab 关闭交接、关联结果及共享入口接通。受控子进程经真实 Host→Runtime 路径的测试及 root DOM 集成通过；真实安装 Pi/OMP 的 Runtime 验证通过。
3. **最终验收与漂移审查 — 暂停，待用户下一步安排。** [I5] << CURRENT
   - 用户明确允许以当前实现阶段完成为 checkpoint，不要求本轮继续全仓检查或 GUI。
   - 后续合并/发布前仍应完成全仓回归和真实 GUI 验收；不能将此次暂停写成检查已通过。

## Current Phase

**Now：** 按用户要求保存 handover，将实现、测试、契约和工作记录一起 commit。停止新增功能/验证；不合并、不推送。

当前完成定义为“功能实现与聚焦验证完成”，不是“最终验收完成/可发布”。用户不再判断内部队列细节；只在新事实改变目标、数据安全或核心架构时升级讨论。

### 已取得的证据

- `pnpm --dir packages/pi-rpc build`、共享 core TypeScript 检查曾通过；`pnpm --dir apps/pi-client build` 通过。
- 核心/Runtime/Projection/OMP 聚焦：4 文件、76 tests 通过。
- 既有 Host dispatcher/connection/cache：3 文件、26 tests 通过。
- 新 Host→Registry→Runtime→受控 child 测试最初 5 项通过；随后加入压缩边界测试，尚未重新运行该文件。
- 委派 UI 首轮 15 项、修正后 19 项通过；连同旧 UI 文件共 41 项通过。后续主 Agent 又调整 Host-applied 图片缺失反馈并将该用例参数化，尚未重跑该 UI 文件。
- `queuedPromptRecovery.integration.dom.test.ts`：真实 ClientApp 点击，经共享 bridge、真实 Registry/Runtime 和受控 child 回填草稿，Pi/OMP 两项通过；不是仅模拟一个结果。
- Desktop publisher 聚焦 4 项通过。`pnpm --dir apps/pi-client lint` 在 lint 修正后通过。
- `node tmp/queue-recovery-spike/client-runtime.mjs pi` / `omp` 最终均通过：实际安装 SDK + 实际 FrostPi Runtime + 合成 provider，3 条取回、admission、有序恢复、不停止活动流、持久 entry takeover；OMP 恢复实际返回 WebP，Pi 图片拒绝未删除输入。不是 GUI 验证。
- 独立只读审查未报告 Critical/Warning；审查不是全量验证替代。

### 尚未通过的完整 gate

两次 `pnpm check` 均在 lint 停止：第一轮新增 TS/test lint，第二轮 Desktop 测试 matcher 的 no-unsafe-assignment。已修正，但未再跑完整检查。日志：`tmp/pending-recovery-check.log`、`tmp/pending-recovery-check-r2.log`。不要使用子代理摘要里的“version 未运行”：root driver 实际先做版本检查，查看日志判断完成阶段。

全仓 typecheck/test、两端产品 JS build、bundle check 尚未整体取得成功证据；真实 GUI 未做。最后机械更正的 `runtimeCompatibility.test.ts` capability 预期也尚未重跑。

### 形状与边界

`SessionRuntime` 仍为约 20–40 行接线；无 transport/dialect 状态扩张或新队列框架。除 locked SHAPE 外的源文件触点有 `SessionHeader.svelte`：一个 pending-recovery externalization guard，防止 sidebar 本地结果尚未回填就将旧草稿转交 tab。这是既有草稿归属的有限协调，不是新协议；最终 diff 审查仍待完成。桥接 required field 变化升级为 `3.4`，相应测试 fixture 已调整。

## Issues

### I1 · 后端取回不能早于入队或导致重复破坏性操作

- Status：本阶段 done。
- `QueuedPromptRecovery` 拥有 admission、busy、disposed；OMP 部分成果保留，不自动重试未知 text-match mutation。Pi 只承诺 best effort，压缩 guard 在后端执行边界检查。

### I2 · 迟到用户事件不能借用另一条气泡的内容

- Status：本阶段 done。
- Projection 恢复模式使用实际 user event 内容；保留本地 FIFO 记账。持久刷新不结束模式，settled/queue reset 结束模式。Pi 竞态中的新气泡提前消失是明确接受的边界，不再追求精确同步。

### I3 · 回填不能覆盖新草稿或写错会话

- Status：本阶段 done。
- Host cache 以 token window 保持 tab 关闭期间归属；host-applied 不再次传 content；webview-merge 合并最新原会话草稿。新 Host 测试覆盖关闭期间编辑和竞争发送 rollback。

### I4 · 入口、附件和反馈必须真实接通

- Status：本阶段 done。
- 共享 UI group entry、busy、压缩/图片禁用和明确反馈；不自动发送。Desktop 发布边界提供相关联的 text-only/失败降级，无 IPC 分块。

### I5 · 最终验收不能以实验或局部单测代替

- Status：pending，按用户要求暂停本轮。
- 下一轮先核对 handover 中最后未重跑的修正，再执行合并前必要检查。只修实际发现的问题，不为测试数量扩张功能，不重开队列责任讨论。
