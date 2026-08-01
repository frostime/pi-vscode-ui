---
title: FrostPi retry 后最终回复重复渲染问题交接
created: 2026-08-01T03:28:09+08:00
round: R1-investigation
continuation: ./DEV_SPEC.md
---

# Current Status

本文件保留 R1 问题溯源与取证结果。当前 change contract、待确认产品语义和验收边界以同目录 `DEV_SPEC.md` 为准；截至 R1 尚未修改产品代码。

已经在基线 HEAD `0ebea53aaca4f3ba5011626d8d1a7997f5a58291` 上完成问题定位和最小复现：长 agent 执行期间发生 provider/network 自动重试，最终成功后，FrostPi GUI 会把同一条最终成功回复显示两次；重新 reload session 后重复消失。

根因已验证，位于 Extension Host 的 `ConversationProjection` 增量 reconciliation，不在 Pi session、RPC transport、Host-Webview bridge 或 Svelte DOM 渲染。

进入实现前必须先在 `DEV_SPEC.md` 中确定期望的 visual turn 分组语义和修复范围。

# Task Context

## 用户观察到的问题

现场截图：`tmp/error-1.jpg`。

一个长 agent 执行经历复杂网络波动和自动重试，最后正常完成。完成后 GUI 中出现两份内容相同的最终回复：

- 第一份位于一个 `Failed · ...` visual turn 下；
- 第二份位于后续 `Worked · ...` visual turn 下；
- reload session 后只剩一份最终回复；
- 用户确认这不代表 Pi session 中存在两条相同的最终成功消息。

## 必须区分的三个概念

1. **Pi 底层执行 attempt**：一次 `agent_start` 开始的模型执行。自动重试会开始新的 `agent_start`。这不等于创建一条新的用户消息。
2. **Pi session entry**：Pi 追加保存的消息记录。合法 retry 序列通常是 `user U → failed assistant M1 → successful assistant M2`。`M1` 和 `M2` 是不同 assistant 消息；最终成功回复 `M2` 只保存一次。
3. **FrostPi visual turn**：FrostPi 为 GUI 自己构造的分组，不是 Pi session 中的原生 turn node。本 BUG 是同一个 `M2` activity 被留在两个 visual turn 中。

`agent_settled` 表示本次 session-level 执行已经完全结束，不会再自动 retry、compact retry 或继续 queued follow-up。FrostPi 在此事件后读取增量 `get_entries` 并将 live GUI 状态与持久化记录对账。

# Verified Root Cause

## Pi 的合法 retry 行为

事件和消息可简化为：

```text
用户消息 U
  → agent_start（attempt 1）
  → assistant M1，stopReason=error
  → agent_end(willRetry=true)
  → auto_retry_start
  → agent_start（attempt 2）
  → assistant M2，stopReason=stop，包含最终回复
  → agent_settled
```

Pi 对每个 `message_end` 追加 session entry，包括失败的 assistant `M1`。retry 前，Pi 会从 **agent 工作上下文** 删除 `M1`，以便重新请求模型；它明确保留 **session history** 中的 `M1`。因此不能把“从工作上下文移除”理解成“从 session 删除”。

相关证据：

- `C:/Users/EEG/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:355`：`message_end` 持久化 user/assistant/toolResult。
- 同文件约 `2123-2167`：`_prepareRetry()`；源码注释为 `Remove error message from agent state (keep in session for history)`。
- `C:/Users/EEG/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js:58`：retry continuation 发出新的 `agent_start`。
- `C:/Users/EEG/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/types.d.ts:279`：`AssistantMessage` 没有稳定 `id`，但有 `timestamp`。
- 安装的 Pi Coding Agent 版本：`0.81.1`。

## FrostPi live 阶段

`ConversationProjection` 在 attempt 1 失败后仍保留原 `#activeTurnId`。retry 的第二个 `agent_start` 会复用这个 active visual turn，并将状态重新设为 running。因此成功消息 `M2` 首先正常显示在原 live turn 中。

证据：

- `apps/vscode/src/extension/conversation/ConversationProjection.ts:353-365`：`#startAgentTurn()` 复用已有 active turn。
- 同文件 `376-407`：assistant live message 被投影到 active turn。
- 同文件 `899-903`：live 和 persisted 的同一 `M2` 通常都得到 `assistant-${message.timestamp}` identity。

此时只有一个 GUI turn，也只有一份最终回复。重复尚未发生。

## agent_settled 后的错误 reconciliation

`SessionRuntime` 在 settle 后调用增量 `get_entries`，再调用 `ConversationProjection.reconcileEntries()`：

- `apps/vscode/src/extension/sessions/SessionRuntime.ts:769-800`。

投影追加 entries 时发生以下步骤：

1. persisted user entry `U` 与原 live turn 配对。
2. persisted failed assistant `M1` 被投影到该 turn。
3. 因为 `M1.stopReason !== "toolUse"`，代码将该 visual turn 标记为 error，并执行 `#persistedTurnId = null`：
   - `apps/vscode/src/extension/conversation/ConversationProjection.ts:293-308`。
4. 接着处理 successful assistant `M2`。由于 `#persistedTurnId` 已为空，`#persistedTurn()` 新建一个没有 user message 的 visual turn：
   - 同文件 `567-578`。
5. `M2` 在 live 阶段已经位于旧 turn。`#messageItems` 也记录了旧 `{ turnId, itemId }`。但是 `#replaceMessageItems()` 只遍历这次传入的目标 turn；当目标变成新 turn 时，它没有从旧 turn 删除 `M2`，随后又把 `M2` 加入新 turn：
   - 同文件 `666-688`。

最终 Host ViewModel 变成：

```text
Failed visual turn  → failed M1 + stale M2
Worked visual turn → M2
```

两处 `M2` 是同一个协议消息 identity 的两个 GUI activity 位置，不是 Pi 返回了两条最终回复。

## reload 为什么恢复

full reload 调用 `replaceEntries()`，先清空 live items、active/persisted turn state 和 identity maps，再完全按 Pi entries 重建：

- `apps/vscode/src/extension/conversation/ConversationProjection.ts:76-90`。

重建时不存在旧 live turn 中遗留的 `M2`，结果为：

```text
Failed visual turn  → failed M1
Worked visual turn → M2
```

因此最终回复只出现一次。reload 清除的是 FrostPi 错误留下的临时投影，不是修复或修改 Pi session。

# Minimal Reproduction Evidence

已直接通过 `pnpm exec tsx` 执行当前 `ConversationProjection`，输入以下合法序列：

```text
appendUserPrompt
agent_start
message_start(user)
message_start/end(failed assistant M1)
auto_retry_start
agent_start
message_start/end(successful assistant M2 = "FINAL RESPONSE")
agent_settled
reconcileEntries([U, M1, M2])
```

实际输出：

```text
before reconcile
  turn-local-user-1: completed
  responses = [transient provider error, FINAL RESPONSE]

after incremental reconcile
  turn-local-user-1: error
  responses = [transient provider error, FINAL RESPONSE]

  turn-a-final: completed
  responses = [FINAL RESPONSE]

after full reload / replaceEntries
  turn-u1: error
  responses = [transient provider error]

  turn-a-final: completed
  responses = [FINAL RESPONSE]
```

该输出逐项解释截图中的 `Failed` turn、`Worked` turn、重复最终回复，以及 reload 后恢复。

独立 `code-reviewer` subagent 已根据当前代码和 Pi 0.81.1 实现反证审查，结论相同：根因是 terminal-assistant visual turn closure 与跨-turn message replacement 不执行 relocation 的组合。

# Ruled Out

以下方向已经检查，不应在下一轮重新作为主要假设：

- **Pi session 存在两条相同最终回复**：不成立。Pi 有失败 `M1` 与成功 `M2`，成功内容只在 `M2` 中保存一次。
- **Pi retry 创建两个指向同一批消息的 session turn node**：不成立。Pi 追加消息 entry；FrostPi visual turn 是产品自己的投影。
- **Host-Webview collection delta 自行复制**：不成立。`collectionDelta.ts` 和 `applyHostMessage.ts` 按顶层 item id upsert/replace。
- **Svelte keyed each 或 DOM ghosting**：不成立。Webview 忠实渲染 Host 已经重复的两个不同 turn；同一 nested activity id 位于两个独立 turn 作用域，都会显示。
- **必须存在事件丢失、message id mismatch 或 compaction 才能触发**：不成立。普通 auto-retry 的最小合法序列已稳定复现。

相关桥接/渲染文件：

- `apps/vscode/src/extension/webview-host/collectionDelta.ts:7-19`
- `apps/vscode/src/webview/bridge/applyHostMessage.ts:103-111`
- `apps/vscode/src/webview/features/conversation/ConversationView.svelte:87`
- `apps/vscode/src/webview/features/conversation/AgentTurn.svelte:30`
- `apps/vscode/src/webview/features/conversation/collapseTurnTrace.ts:23-69`：解释为什么 stale `M2` 会作为 `Failed` turn 的最后 response anchor 可见。

# Current Contracts and Test Gap

必须先读：

- `apps/vscode/src/extension/conversation/conversation-projection.SPEC.md`
- `apps/vscode/src/extension/sessions/session-lifecycle.SPEC.md`
- `apps/vscode/src/shared/bridge/webview-bridge.SPEC.md`
- `docs/protocol/pi-rpc-compatibility.md`

现有 contract 要求 live reconciliation 保留 view identity，并通过 stable protocol identity 更新 assistant/tool activities。当前跨-turn relocation 行为违反这一目标，也使 incremental reconciliation 与 full replacement 不等价。

现有测试缺口：

- `apps/vscode/test/unit/ConversationProjection.test.ts` 覆盖普通 live/persisted identity 对账和两个独立 user turn，但没有覆盖一个 user 下连续出现 `failed assistant → successful assistant` 的 retry 序列。
- `apps/vscode/test/unit/SessionRuntime.test.ts` 和 `apps/vscode/test/e2e/fake-pi.cjs` 的 fake Pi 没有完整 `agent_end(willRetry) / auto_retry_* / second agent_start` fixture。

# Solution Boundary Still Open

用户下一步要讨论解决方案策略。当前未确认应选择哪种 observable guarantee：

## Candidate A: 最小一致性修复

当同一 message identity 已位于另一个 turn 时，插入目标 turn 前先从旧位置删除，实现真正的跨-turn relocation。

预期结果：incremental reconciliation 与当前 full reload 的分组/内容一致；失败 attempt 与成功 attempt 可以继续显示为两个 visual turn，但最终回复全局只出现一次。

优点：局部、直接修复已验证的重复原因。

需要检查：`#messageItems` 可能有多个 activity（reasoning/text/tool），跨-turn 删除和 tool identity map 必须保持一致；不能误删同 turn 中正常的多-part assistant activity。

## Candidate B: 改变 retry 的 visual turn 分组语义

让同一个用户请求下的失败 attempt、retry trace 和最终成功回复在 live 与 reload 后始终属于一个 visual turn。

这会改变持久化 entries 到 visual turn 的分组规则，范围和行为影响明显更大。Pi entries 本身没有 FrostPi visual turn id，需要定义可证明的分组边界，不能靠文本或 timestamp 猜测。

在选择 Candidate B 前应使用 `govern-complexity-by-responsibility` / architecture reasoning，明确 FrostPi 是否要承担跨低层 agent run 的逻辑 turn 语义。

这两个候选不是同一个修复：Candidate A 修复重复和增量/全量不一致；Candidate B 重新定义用户看到的 retry 分组体验。可以先做 A，也可能在明确产品语义后设计 B，但不要默认 B 是必需条件。

# Required Verification for the Fix

至少新增行为测试：

1. 构造 `U → failed M1 → successful M2` live retry 序列。
2. settle 后增量 reconcile。
3. 断言最终响应 `M2` 在整个 conversation projection 中只出现一次。
4. 对同一 entries 执行 full `replaceEntries()`，断言增量与全量投影在消息归属、顺序和状态上满足选定 contract。
5. 若修改 `#replaceMessageItems()`，覆盖同一 assistant 的 reasoning、多个 text/image part、tool call 以及跨-turn relocation，防止 identity map 残留。
6. 根据风险运行聚焦测试，之后按 `docs/testing.md` 扩大验证范围。

# Relevant Artifacts

- 原始截图：`tmp/error-1.jpg`
- 第一张机制白板：`tmp/conversation-retry-duplication.svg`
- 更朴素的纵向消息生命周期白板：`tmp/pi-retry-message-lifecycle.svg`
- 两张 SVG 和截图位于 git-ignored `tmp/`，不是产品代码变更。
- 本轮没有修改任何 tracked source/test/spec 文件。
