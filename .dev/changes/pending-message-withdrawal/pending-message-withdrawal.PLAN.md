# Pending message recovery — PLAN

目标：同目录 `pending-message-withdrawal.TARGET-SPEC.md`（accepted）。实现前预测：`pending-message-withdrawal.SHAPE.md`（locked，不在实施中改写）。运行时事实和残余风险：`RESEARCH.md`。

分支：`feat/pending-message-recovery`。同一任务内用 checkpoint commits，不再按步骤开分支或 merge。

## Mainline

1. **RPC、恢复协调和实际内容投影** — [I1][I2]。<< CURRENT
   - Gate：正常批量、admission、重复操作、OMP 部分成功及 Pi 真实内容回归通过；Runtime 只做接线。
2. **Host 草稿交付和共享 UI** — [I3][I4]。
   - Gate：合法来源请求到真实 Runtime 的路径接通；最新草稿、tab 关闭交接和两种 presentation 正确，压缩禁用及图片反馈可观察。
3. **完整验收与漂移审查** — [I5]。
   - Gate：真实 Pi/OMP 隔离路径、UI 交互、聚焦回归、共享边界及两端 JS build 的证据齐全；逐项报告未验证内容。未通过不能宣称完成。

## Current Phase

范围：[I1][I2]，先确定序列化契约，再实现原始 RPC 方法、专用协调 class、Runtime 接线和 Projection 局部修正。Host/UI 只在契约确定后并行推进，不抢先建立另一套状态。

- 主 Agent 持有模块边界、恢复事务和最终整合责任。
- 简单阅读/测试任务使用相应便宜 preset；并行写入须限定不重叠文件。
- 测试按 TARGET-SPEC 的语义选最少用例，不给每个薄包装配单测。
- 复用现有临时 spike 的结果，不再泛调研 Pi 队列；只有改变责任或核心架构的新事实才升级用户。

**Now:** 锁定已批准的方案，读取现有 API、Runtime 和草稿边界，开始核心实现。

## Issues

### I1 · 后端取回不能早于入队或导致重复破坏性操作

- Status：in progress，ready。
- 原因：两种后端操作不同；已有提交可能尚未确认；OMP 有部分成功和未知结果。
- Resolution：一个 process-scoped `QueuedPromptRecovery` 拥有 admission、互斥和失效处理；只恢复可交付内容，不 abort、重排或自动重试。压缩 guard 在后端执行边界生效。

### I2 · 迟到用户事件不能借用另一条气泡的内容

- Status：ready。
- 原因：现有 FIFO promotion 从本地队首生成对话，恢复后会错配文字/图片或漏掉用户回合。
- Resolution：恢复模式以真实事件生成对话，保持既有队列记账；验证首次事件、重试、持久刷新与下一轮清理。Pi 特殊竞态的气泡提前消失是已说明的边界，不再追求精确同步。

### I3 · 回填不能覆盖新草稿或写错会话

- Status：ready；blocked by [I1] 的关联结果/内容契约。
- 原因：sidebar 本地草稿与 tab Host 草稿具有不同归属和关闭交接。
- Resolution：沿原有 revision/ownership 路径合并完成时最新草稿；结果应用一次，来源会话固定，旧进程结果不污染新实例。

### I4 · 入口、附件和反馈必须真实接通

- Status：ready；blocked by [I3] 的交付边界。
- 原因：当前只有模拟原型，Pi 含图不可无损取回；OMP 与 Desktop 有有限响应约束。
- Resolution：共享 UI 接入按钮、忙状态、压缩/图片禁用和真实结果；按原型前置合并、聚焦、不自动发送；不新增待确认状态或 IPC 分块。

### I5 · 实验或局部单测不等于功能验收

- Status：ready；blocked by [I1]–[I4] 的完整接入。
- Resolution：执行实际 UI 操作路径、真实后端隔离实验和适当回归；区分实测/模拟/未验证，审查实际 diff 是否偏离 locked SHAPE。检查任务目标未被放宽或扩张。
