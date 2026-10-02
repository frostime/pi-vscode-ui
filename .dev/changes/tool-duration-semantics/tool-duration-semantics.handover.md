---
title: Tool duration semantics — implementation handover
created: 2026-10-02T02:10:00+08:00
consumed: true # 接收方读完请置 true
---

# Tool duration semantics — implementation handover

## Assume Reader

新会话的 Pi Coding Agent 将接手调查后的实现决策与代码修复。它无法恢复本次对话，但可以读取本仓库和本文件。

本次调查在独立 worktree 完成：

- Worktree: `D:/Arsenal/PlayCode/pi-vscode-ui/.worktrees/tool-duration-semantics`
- Branch: `research/tool-duration-semantics`
- 状态: clean；本 worktree 没有实现改动
- 当前基线包含 issue #7 的 elapsed timer 实现

主工作区当前在别的任务分支，**不要操作主工作区，也不要将本 worktree 的研究分支直接 merge**。后续 Agent 应按用户重新确认后的范围实现。

## User Goal

用户发现工具卡片旁的完成耗时可能远大于 bash 等命令的真实运行时间，要求先研究语义与可行性，不立即盲目修改。

核心目标：

1. 运行期间显示的耗时应尽量代表单个工具调用本身的 wall-clock 生命周期。
2. 不修改 Pi session 文件，不注入额外 session entry，不拦截 Pi 文件写入（FrostPi 的非侵入边界）。
3. 允许历史 / resume 场景是估算值，但希望正常单工具场景达到秒级误差。
4. 需要准确回答 issue #7 的问题：

   > Will the final wall-clock display persist after agent finishes its turn / VS Code restarts?

## Current Product Behavior

当前功能只对硬编码列表 `bash`、`powershell`、`codemode` 显示 elapsed timer。相关代码：

- `apps/vscode/src/webview/features/conversation/ToolActivity.svelte`
- `apps/vscode/src/webview/features/conversation/ToolElapsedTimer.svelte`
- `apps/vscode/src/webview/features/conversation/toolElapsedTimers.ts`
- `apps/vscode/src/shared/model/toolCallModel.ts`

`ToolCallView` 已有：

```ts
startedAt: number;
endedAt?: number;
```

Webview 的 `ToolElapsedTimer` 每秒用 `now - startedAt` 更新；终态用 `endedAt - startedAt` 格式化。问题不在格式化，而在 extension projection 提供的起止点语义。

## Main Finding

当前的 `startedAt` 通常不是工具真正开始执行的时间。

### Live path

1. Assistant 消息被投影时，`assistantActivities()` 为 tool activity 创建 `startedAt`，来源是 assistant message 的 `timestamp`：

   - `apps/vscode/src/extension/conversation/ConversationProjection.ts:988-997`

2. Pi 随后发出 `tool_execution_start`。FrostPi 虽然在 `#applyToolStart()` 中传入了新的 `Date.now()`（`ConversationProjection.ts:559-573`），但 `ConversationItemStore.upsertTool()` 使用：

   ```ts
   currentTool?.startedAt ?? input.timestamp
   ```

   位置：`apps/vscode/src/extension/conversation/ConversationItemStore.ts:248-253`。

3. 因此已有 assistant 时间戳优先，真正的 tool start 时间被丢弃。

4. `endedAt` 在 `#applyToolEnd()` 中用收到 `tool_execution_end` 时的 `Date.now()` 记录（`ConversationProjection.ts:591-608`）。

当前 live duration 更接近：

```text
assistant message timestamp -> tool_execution_end received
```

而不是：

```text
tool_execution_start received -> tool_execution_end received
```

Pi 的 `pi-agent-core` 执行顺序也确认了：`tool_execution_start` 事件在 `prepareToolCall()` / tool execute 之前发出，`tool_execution_end` 在 execute 和 after-tool processing 之后发出。因此以这两个事件为边界，表示的是 Pi 的工具调用生命周期；对普通 bash 命令，它通常接近 shell wall-clock 时间，但如果存在权限确认、before/after hook 或参数准备，它也会包含这些时间。

### Why the observed value can be much too large

Pi 的常见 provider 会在创建 assistant stream output 时设置 assistant `timestamp: Date.now()`。所以模型响应生成花费的时间可能已经进入 FrostPi 的 tool `startedAt`，即使 bash 子进程尚未启动。

这与用户观察的“bash 实际很快，但旁边显示的数值明显更大”一致。

### Post-settle overwrite

Agent settle 后，`SessionRuntime.#refreshAfterSettled()` 会刷新 persisted entries：

- `apps/vscode/src/extension/sessions/SessionRuntime.ts:807-842`

assistant takeover 使用 persisted assistant entry timestamp 重建 activity。`ConversationItemStore.#preserveToolExecutionState()` 只保留当前工具的：

- `status`
- `isError`
- `output`
- `endedAt`

位置：`ConversationItemStore.ts:373-390`。

它**没有保留当前 live `startedAt`**。所以工具完成后，历史刷新可能把原来的 live 起点替换成 persisted assistant entry 起点，最终显示值可能改变。

## Live vs Resume Semantics

两者当前不是同一个东西。

| 场景 | 当前起点 | 当前终点 | 语义 |
|---|---|---|---|
| live running | assistant message timestamp | 本地收到 `tool_execution_end` 的时间 | 可能包含模型/工具准备时间 |
| live terminal before refresh | 同上 | 本地 `Date.now()` | 不是纯 tool execution duration |
| after persisted refresh | assistant session entry timestamp | toolResult session entry timestamp | entry 间隔估算 |
| VS Code restart / resume | assistant session entry timestamp | toolResult session entry timestamp | 重新推导的历史估算 |

Pi session entry 的 timestamp 是 Pi `SessionManager.appendMessage()` 生成的 ISO timestamp。Pi 的 `tool_execution_start` / `tool_execution_end` event contract 不包含 timestamp，toolResult message 也没有 persisted execution-start field。

因此 VS Code 重启后不会恢复原始的 per-tool live start time；只会从 session entries 重新估算。

## Historical Estimation Limits

### Single tool in one assistant response

对于一个 assistant response 只有一个工具调用的正常场景：

```text
assistant entry timestamp -> toolResult entry timestamp
```

通常接近工具调用生命周期：

- assistant entry 在 message_end 后写入，接近工具开始前；
- toolResult entry 在工具结束后的 message_end 写入，接近工具结束后。

正常无权限等待、无重型 hook 的情况下，误差预计通常是几十到几百毫秒，UI 按秒四舍五入后一般小于 1 秒。

这只是经验边界，不是协议保证。

### Multiple tools in one assistant response

session 中没有每个工具的 execution-start timestamp。如果一个 assistant response 包含 A/B/C：

```text
assistant entry
  |-- tool A result
  |-- tool B result
  `-- tool C result
```

无法从持久数据判断：

- A/B/C 是顺序执行还是并行执行；
- 每个工具分别何时真正开始；
- 哪个 result 对应的时间间隔属于哪个 tool 的执行。

当前算法让全部工具共享 assistant entry 起点。若三个工具顺序各运行 10 秒，历史上可能显示约 `10s / 20s / 30s`，后续工具误差达到 10-20 秒。

在“不写额外 metadata”的约束下，不存在能保证多工具历史场景秒级准确的算法。

## Feasibility Matrix

| Requirement | Feasible under non-invasive constraint? | Notes |
|---|---:|---|
| Live timer uses tool call lifecycle | Yes | Stamp local `Date.now()` at received `tool_execution_start/end` |
| Live terminal value remains stable after settle | Yes | Preserve live `startedAt` through persisted assistant takeover |
| Single-tool resume estimate | Usually | Entry timestamps are close boundaries; normally sub-second to low-second error |
| Exact multi-tool resume duration | No | Pi does not persist individual execution starts |
| Exact duration after VS Code restart | No | Requires Pi metadata or FrostPi sidecar persistence |
| Approximate historical display | Yes | Must be documented as derived/approximate, especially for multi-tool batches |

## Recommended Implementation Shape

### Phase 1 — fix live semantics (recommended first)

No protocol or session-file changes.

1. Extend the placement/update path so an explicit execution start can override the provisional assistant timestamp. Possible shape:

   ```ts
   type ToolPlacementUpdate = {
     // existing fields...
     startedAt?: number;
     endedAt?: number;
   };
   ```

2. In `ConversationProjection.#applyToolStart()`, pass one local `startedAt = Date.now()` explicitly.
3. In tool update/end events, preserve that start; do not reset it.
4. In `ConversationItemStore.#preserveToolExecutionState()`, preserve `current.tool.startedAt` when persisted assistant activities replace live activities.
5. Keep `endedAt` from the live execution end event through settle reconciliation.
6. Use one `const now = Date.now()` per start/end event rather than calling `Date.now()` twice.

### Phase 2 — define historical display policy

The user has not yet selected one of these policies:

- **Policy A: approximate history** — show entry-derived duration after resume; add an accessible/title indication that it is estimated when the source is not live.
- **Policy B: conservative history** — show duration only for single-tool assistant responses; hide or show batch duration for multi-tool responses.
- **Policy C: exact persistence** — requires Pi to persist per-tool start/end metadata, or a FrostPi sidecar. This conflicts with the current non-invasive/no-extra-write boundary and should not be silently introduced.

Recommended default: **Policy A for single-tool history; Policy B or an explicit approximate marker for multi-tool history.** Do not claim exact post-restart wall-clock persistence.

## Acceptance Criteria for Phase 1

- A bash command whose assistant response took 20 seconds but whose process ran for 1 second displays approximately `1s`, not `21s`.
- A running timer starts when FrostPi receives `tool_execution_start`, not when the assistant message begins.
- A completed live value does not change after `agent_settled` or persisted entry reconciliation.
- Separate tool calls have separate live starts.
- Failed tool calls retain their live duration.
- Cancelled calls without `endedAt` still do not invent a duration.
- No Pi session entry, toolResult payload, or FrostPi sidecar is written by the fix.
- Unit tests cover fake clock start/end, persisted takeover preservation, and multiple tools with independent live starts.

## Issue #7 Response Boundary

Safe current wording:

> The live duration is measured locally from `tool_execution_start` to `tool_execution_end`, so it does not require modifying Pi's session file. The final value remains visible after the turn completes. After VS Code restarts, FrostPi can reconstruct an estimated duration from persisted session entry timestamps, but Pi does not persist per-tool execution start times, so the resumed value may differ from the live value, especially when one assistant response contains multiple tool calls.

Do not promise that the exact live wall-clock value survives a VS Code restart unless a persistence design is separately approved.

## Verification Plan

Run from the worktree after implementation:

```bash
pnpm --dir apps/vscode exec vitest run test/unit/ConversationProjection.test.ts test/unit/ConversationItemStore.test.ts test/unit/ToolActivity.test.ts
pnpm check
```

Behavioral tests should use a controllable clock or explicit timestamp injection. Do not test only rendered markup; test the projected `ToolCallView.startedAt` and `endedAt` across:

1. assistant toolCall projection;
2. live `tool_execution_start`;
3. live `tool_execution_end`;
4. persisted assistant takeover;
5. persisted toolResult reconciliation;
6. complete history replacement / resume.

## Evidence Map

Repository:

- `apps/vscode/src/extension/conversation/ConversationProjection.ts`
- `apps/vscode/src/extension/conversation/ConversationItemStore.ts`
- `apps/vscode/src/extension/conversation/messageAssembler.ts`
- `apps/vscode/src/extension/sessions/SessionRuntime.ts`
- `apps/vscode/src/shared/model/toolCallModel.ts`
- `apps/vscode/src/webview/features/conversation/ToolElapsedTimer.svelte`
- `apps/vscode/src/webview/features/conversation/ToolActivity.svelte`
- `apps/vscode/src/extension/conversation/conversation-projection.SPEC.md`

Installed Pi evidence inspected during this research (version may differ for successor):

- `D:/AppData/npm/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js.map`
  - public tool execution events have no timestamps;
  - message_end persistence calls `SessionManager.appendMessage()`.
- `D:/AppData/npm/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js.map`
  - `appendMessage()` assigns `timestamp: new Date().toISOString()`.
- `D:/AppData/npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js.map`
  - emits `tool_execution_start` before tool preparation/execution;
  - emits `tool_execution_end` after execution/finalization;
  - toolResult message receives `timestamp: Date.now()`.
- `D:/AppData/npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/*.js.map`
  - common provider assistant output messages initialize their timestamp at stream creation.

## Open Decisions

| # | Decision | Recommended answer | Status |
|---|---|---|---|
| 1 | Should live duration mean tool lifecycle or child-process-only time? | Tool lifecycle bounded by `tool_execution_start/end` | User preference supports this; confirm before implementation |
| 2 | Should resumed multi-tool history show approximate values? | Mark approximate or show batch duration; do not claim per-tool exactness | Needs user decision |
| 3 | Is sidecar / Pi upstream persistence allowed for exact restart recovery? | No under current non-invasive boundary | Explicitly deferred |
| 4 | Should `ToolCallView` expose duration source/approximate marker? | Recommended if historical estimate remains visible | Needs implementation decision |

## Clarifications & Discussion

The next Agent should append new questions and answers here rather than silently changing the boundary.

| # | Question | Answer |
|---|---|---|
| | | |
