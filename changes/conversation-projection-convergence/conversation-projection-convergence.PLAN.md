---
title: 会话投影收敛执行计划
created: 2026-08-01
status: implemented
spec: ./DEV_SPEC.md
terminology: ./TERMS.md
skeleton: ./conversation-projection-convergence.LAND.md
---

# 执行目标

修复 Pi 自动重试后最终回复重复的问题，并让实时信号与会话记录稳定收敛：一次用户请求及其 Pi 核心自动重试/上下文压缩后自动继续保持一个用户回合；最终成功回复只出现一次；失败尝试保留在默认折叠的工作记录中；增量对账与全量重建得到相同的稳定内容、顺序、归属和状态。

本计划遵循 `DEV_SPEC.md` 与 `TERMS.md`。实现不得扩大到 Pi 协议、FrostPi 私有持久化、Webview 正文去重或完整的“历史状态 + 实时覆盖层”双模型。

# 执行约束

- `ConversationProjection` 继续负责 Pi 生命周期、用户回合分组、关联冲突和 reload 决策。
- `ConversationItemStore` 独占有序会话项、assistant/tool/compaction 的物理位置和 persisted 接管状态。
- persisted assistant 的最终身份是 entry ID；message ID/timestamp 只作为 live/persisted 关联线索。
- 所有 persisted 增量关联冲突必须在公开状态写入前发现；冲突返回现有 `"reload"`。
- `Retrying` 使用现有 `running` 状态和 notice，不增加共享状态枚举，也不持久化通知状态。
- 普通内容转换、图片校验、queued follow-up、branch control 和无关 extension-command 行为保持现状。
- 不按回复正文、错误正文或时间接近程度去重。

# 委托执行合同

用户批准本 PLAN 后，可把实现交给一个没有 preset 的 code implementation subagent。委托任务必须把以下文件作为执行入口，而不是复述聊天记录：

- `changes/conversation-projection-convergence/DEV_SPEC.md`
- `changes/conversation-projection-convergence/TERMS.md`
- `changes/conversation-projection-convergence/conversation-projection-convergence.PLAN.md`
- `changes/conversation-projection-convergence/conversation-projection-convergence.LAND.md`
- `apps/vscode/src/extension/conversation/ConversationProjection.ts`
- `apps/vscode/src/extension/conversation/ConversationItemStore.ts`
- `apps/vscode/test/unit/ConversationItemStore.test.ts`

subagent 必须：

- 保留并继续当前未提交的 Phase 0 工作树，不得 checkout、reset 或重建这些文件；
- 按 phase 顺序实现并在 PLAN 中更新状态；
- 使用 `rg -n '<conversation-projection-convergence>::TODO'` 作为关键路线索引；
- 只在已确认边界内自行完成自然实现和测试；
- 对每阶段报告修改文件、验证命令和结果；
- 若发现必须修改 shared ViewModel、Pi RPC/session 格式、`SessionEntryState` 权威或 `SessionRuntime` 主流程，立即暂停并说明证据；
- 不自行替换为完整双层投影架构。

主 Agent 在接收结果后负责审查关键不变量、抽查源码证据、重跑验证，并决定是否接受 subagent 改动。

# Phases

### Phase 0: 方向骨架 ✅ done

- [x] 建立 `ConversationItemStore.ts` 最终模块落点。
- [x] 固定 persisted entry ID 与 live correlation key 的语义区别。
- [x] 固定四个核心操作：`preflightPersistedOwnership`、`placeAssistant`、`upsertTool`、`placeCompaction`。
- [x] 在 `ConversationProjection.ts` 的真实迁移点加入统一可检索 TODO 标记和语义化预期 diff。
- [x] 保留 `ConversationProjection` 既有正文；没有用摘要 skeleton 覆盖成熟模块。
- [x] 在 `ConversationItemStore.test.ts` 只记录高价值行为测试清单，不展开 fixture 或方法镜像测试。

**Agent Check**:

- `pnpm --dir apps/vscode exec tsc --noEmit --pretty false` 通过。
- `ConversationProjection.ts` 当前只有注释与保持 no-op 的 `agent_end` 接入点，没有删除既有实现。
- `rg -n '<conversation-projection-convergence>::TODO' apps/vscode/src/extension/conversation/ConversationProjection.ts apps/vscode/src/extension/conversation/ConversationItemStore.ts` 可定位全部关键节点。

### Phase 1: 实现唯一位置存储 ✅ done

- [x] 在 `ConversationItemStore` 中迁入 `#items`、assistant ownership、tool location 和 compaction ownership。
- [x] 从现有 Projection 机械迁入 append/find/turn metadata/branch-control 等 Store 所需 helper；不重新设计其语义。
- [x] 实现 `preflightPersistedOwnership()`：只有当一个 live 表示需要被多个 persisted entries 采用时才报告歧义；预检不得修改公开状态。
- [x] 实现 `placeAssistant()`：选择或沿用 view message ID，原子删除旧位置的全部 reasoning/response/tool-call parts，再发布新位置并同步 tool location。
- [x] 实现 persisted owner guard：一旦 persisted 接管，迟到 live update 返回 `ignored-persisted-owner`，不能创建 orphan turn。
- [x] 实现 `upsertTool()`：tool result/update 始终作用于唯一权威位置。
- [x] 实现 `placeCompaction()`：live/persisted 只按 `firstKeptEntryId` 关联；不同 persisted entry ID 永远保持独立；增量 entry 缺失关联字段时要求 full replacement。
- [x] 按 `ConversationItemStore.test.ts` 的行为清单补最小高价值测试，不测试私有 map、调用顺序或 trivial forwarding。

**Agent Check**:

- `pnpm --dir apps/vscode exec vitest run test/unit/ConversationItemStore.test.ts`
- 测试证明跨 turn 迁移后旧位置没有任何消息 part，tool 不会复活旧位置，timestamp 碰撞不合并 persisted entries，迟到 live replay 幂等。
- `pnpm --dir apps/vscode exec tsc --noEmit --pretty false`

### Phase 2: Projection 切换到 Store ✅ done

- [x] 在 `ConversationProjection` 中实例化 Store，并让 `read()` 保持现有 snapshot 形状。
- [x] 将 `#items`、`#messageItems`、`#toolItems`、`#pendingCompactionIds` 的直接所有权迁出 Projection。
- [x] 将 ordinary append/find/turn status/branch-control 调用改为 Store 操作，保持既有排序和 view identity 行为。
- [x] 删除 `ItemLocation`、`#replaceMessageItems()`、旧 `#upsertTool()` 及其他已被 Store 完整接管的 helper。
- [x] replacement 重置 Store；incremental 在任何 branch-control 或 persisted ownership 写入前完成全部预检。
- [x] 预检冲突保持当前 projection 不变并返回 `"reload"`；full replacement 按 entry ID 显示所有 persisted entries。
- [x] 保持 user prompt FIFO、queued follow-up、extension command、图片校验和 branch edge 的现有行为。

**Agent Check**:

- 现有 `ConversationProjection.test.ts` 全部通过。
- 补充普通成功、abort、toolUse/toolResult、branch movement 的增量结果与 full replacement 归一化结果对比。
- `pnpm --dir apps/vscode exec vitest run test/unit/ConversationProjection.test.ts`
- `pnpm --dir apps/vscode exec tsc --noEmit --pretty false`

### Phase 3: Assistant 身份、迁移与迟到事件收敛 ✅ done

- [x] 将 view message ID 生成与 live correlation key 推导拆开。
- [x] live correlation 优先使用显式 message ID；缺失时使用 timestamp；没有安全线索时不从正文推断。
- [x] persisted assistant 始终以 entry ID 作为 durable identity，并通过 Store 尝试采用匹配的 live view ID。
- [x] 对同一 correlation key 的多个 persisted entries保持独立；存在 live adoption 歧义时 incremental 返回 reload。
- [x] history replacement 已包含 assistant 后，重放相同 live message event 只成为 no-op，不移动 persisted 权威位置。
- [x] 同一 assistant 的 reasoning、response 和 embedded tool call 作为一个所有权单元迁移并保持 part 顺序。
- [x] 增加原始 BUG 回归：成功回复从旧 live turn 迁移后只出现一次。

**Agent Check**:

- `ConversationProjection.test.ts` 覆盖无显式 assistant ID、跨 turn relocation、multi-part assistant、timestamp collision、重复 reconciliation 和 stale replay。
- 对同一 active path，incremental 与 full replacement 的归一化结果相同。
- `pnpm --dir apps/vscode exec vitest run test/unit/ConversationItemStore.test.ts test/unit/ConversationProjection.test.ts`

### Phase 4: 自动重试与上下文压缩后的自动继续 ✅ done

- [x] 将 persisted turn 状态改为 `{ turnId, phase: "active" | "error-awaiting-continuation" }`。
- [x] persisted user entry 关闭此前回合并开启新回合。
- [x] persisted assistant `toolUse` 保持 active；`error` 保留自动继续锚点；success/abort 完成回合。
- [x] error 后的 overflow compaction 放入同一用户回合并保留 continuation；普通 compaction 继续保持当前 active-path 位置。
- [x] 中途 compaction refresh 不清除 error continuation；replacement 或 `agent_settled` 后刷新才最终完成。
- [x] 接入 `agent_end(willRetry)`：`true` 保持 running；`false` 才将 pending assistant error 设为最终 Failed。
- [x] `message_end(error)` 立即显示错误 activity，但不提前把用户回合稳定显示为 Failed。
- [x] `auto_retry_start` 在当前用户回合追加 retry notice；下一次 `agent_start` 复用同一回合。
- [x] 最终成功为 Worked，全部 retry 失败为 Failed；不新增 `retrying` shared status。
- [x] live 与 persisted compaction 均通过 `firstKeptEntryId` 收敛，移除 FIFO pending-id 机制；字段缺失时 full replacement 负责 persisted-only recovery。

**Agent Check**:

- Projection tests 覆盖一次/多次 retry 成功、最终失败、`message_end(error)` 早于 `agent_end`、overflow compaction 后成功、compaction stale replay。
- 每个场景均断言一个 user-anchored turn、正确最终状态、最终成功回复一次，以及 incremental/full/reload 等价。
- `pnpm --dir apps/vscode exec vitest run test/unit/ConversationProjection.test.ts`

### Phase 5: 工作记录折叠与错误摘要 ✅ done

- [x] 修改 `collapseTurnTrace.ts`，让最终回复之前的失败 assistant activity 和 turn 内 notice 可以进入折叠工作记录。
- [x] 默认折叠状态只展示最终成功回复；展开后保留失败尝试、错误和 retry notice。
- [x] error count 包含失败 tool、assistant error activity 和 error-level notice，不只计算 tool failure。
- [x] branch control、compaction、custom message 等结构性边界不因普通 trace 折叠规则被错误隐藏。
- [x] 不修改 shared conversation model；不根据错误正文识别 retry notice。
- [x] 按公开 `planTurnItems()` 结果编写行为测试，不测试 Svelte 内部状态。

**Agent Check**:

- `pnpm --dir apps/vscode exec vitest run test/unit/collapseTurnTrace.test.ts`
- 测试证明成功 retry 默认只见最终回复，展开可见失败过程，结构性边界仍在正确位置。

### Phase 6: Runtime 与 fake Pi 生命周期验证 ✅ done

- [x] 在 `fake-pi.cjs` 增加确定性 fixture：user → failed assistant → `agent_end(willRetry)` → `auto_retry_start` → next `agent_start` → successful assistant → `agent_settled`，并返回对应 persisted entries。
- [x] 在 `SessionRuntime.test.ts` 验证 settle 后增量刷新只产生一个用户回合和一份最终回复。
- [x] 增加 history snapshot 已包含 assistant/compaction 后 replay buffered event 的测试。
- [x] 验证 runtime completion notification 只在最终正常完成时触发，不在中间 retry error 触发。
- [x] 原则上不修改 `SessionRuntime.ts` 主流程；若测试证明现有事件顺序无法传递已确认语义，暂停并提交证据。

**Agent Check**:

- `pnpm --dir apps/vscode exec vitest run test/unit/SessionRuntime.test.ts`
- fake Pi fixture 可重复运行，不依赖真实网络、模型或时钟竞争。

### Phase 7: 合同收尾与完整验证 ✅ done

- [x] 更新 `conversation-projection.SPEC.md`：用户回合自动继续、entry ID 权威、唯一位置、预检冲突、迟到 live event 和 compaction 关联。
- [x] 更新 `session-lifecycle.SPEC.md`：`agent_end(willRetry)`、`agent_settled` 与 retry 通知的责任边界。
- [x] 将 `DEV_SPEC.md` 的技术决策从待定更新为实际落地，并记录没有采用的额外状态机制。
- [x] 解析并删除全部 `<conversation-projection-convergence>::TODO` 标记；自然 helper 不留下 change 专用 TODO。
- [x] 删除或标记 `conversation-projection-convergence.LAND.md` 为 implemented/superseded；不继续维护为长期设计文档。
- [x] 检查 diff，确认没有 Pi 协议、shared ViewModel、Webview 去重、sidecar 或无关重构。

**Agent Check**:

```bash
pnpm --dir apps/vscode exec vitest run \
  test/unit/ConversationItemStore.test.ts \
  test/unit/ConversationProjection.test.ts \
  test/unit/SessionRuntime.test.ts \
  test/unit/collapseTurnTrace.test.ts
pnpm check
pnpm build
rg -n '<conversation-projection-convergence>::TODO' apps/vscode/src apps/vscode/test
```

预期最后一条 `rg` 无匹配。

**User Check**:

1. 使用原始长对话故障路径触发一次失败后成功的自动重试。
2. retry backoff 期间看到 Retrying 语义，而不是已经终结的 Failed。
3. 最终界面只有一个用户回合和一份成功回复。
4. 默认折叠只展示最终回复；展开工作记录可见失败尝试与错误。
5. reload 后回复数量、顺序、用户回合归属和最终状态不变。

# 必须暂停并重新讨论的条件

出现以下任一事实时，执行者停止当前 phase，不自行扩展方案：

- 需要修改 Pi session JSONL、RPC event 或要求 Pi 增加稳定 message ID；
- 需要 FrostPi 持久化额外消息/用户回合关系；
- 需要新增 shared `retrying` 状态或修改 Host-Webview 数据结构；
- 需要让 Webview 按正文、时间或相邻关系去重；
- 需要把 `SessionRuntime` 改造成新的事件协调状态机；
- 需要完整拆分 persisted base/live overlay 才能满足已确认不变量；
- `firstKeptEntryId` 不可用且 full replacement 也无法安全恢复唯一 persisted compaction；
- 现有 branch、follow-up、extension-command 或 fork 行为必须改变。
