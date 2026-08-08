---
title: 未确认工具结果落点说明
status: shaping
---

# 未确认工具结果落点说明

本变更消除工具卡片在 Pi 已无法继续执行时仍显示“运行中”的错误状态。它不尝试推断工具是否完成、失败或产生了外部副作用：Pi 的 `toolResult` 仍是成功/失败的唯一权威记录。

复用现有 `ToolCallStatus` 的 `cancelled` 值，面向用户显示为“未收到最终结果／可能已中断”。这里的 `cancelled` 表示 FrostPi 在收到 `toolResult` 前失去该次执行的实时追踪；它不表示操作已回滚，也不表示没有执行过。

`running` 只允许存在于 FrostPi 仍可能收到该工具实时更新的期间。以下边界后，仍为 `running` 的工具改为 `cancelled`：完整历史替换完成、`agent_settled`、SessionRuntime 主动停止 Pi、Pi 连接失败。若后续收到持久化 `toolResult`，既有持久化更新逻辑仍以它覆盖 `cancelled` 为 `complete` 或 `error`。

**核心数据变更在 `ConversationItemStore`。** 它已独占工具的位置索引和不可变 ViewModel 更新，因此由它将 running 工具转为 cancelled。`ConversationProjection` 只保留“何时触发收口”的会话语义；`SessionRuntime` 只报告 Pi 已不能继续执行。

## 文件落点

### Extension Host：会话投影与生命周期

```text
apps/vscode/src/extension/conversation/
├── ConversationProjection.ts             modify  +10–15/-0
│   公开一个仅供 SessionRuntime 使用的“终结未确认工具”入口；完整历史替换和
│   agent_settled 在各自已经确认的最终边界调用它。它只决定何时触发，不遍历或
│   直接修改工具 ViewModel。
│
├── ConversationItemStore.ts              modify  +20–30/-0
│   **核心变更点**：在已有不可变更新和工具位置索引内，将全部 running tool item
│   转为 cancelled，保留输入、已收到的局部输出和位置索引；不合成输出、错误或结束时间。
│
└── conversation-projection.SPEC.md       modify  +5–10/-0
    固化 cancelled 的含义，以及完整历史/最终生命周期边界不得保留 running 工具的规则。

apps/vscode/src/extension/sessions/
└── SessionRuntime.ts                     modify  +2–5/-0
    在 stop() 终止子进程前、connection.onFailure() 中通知 ConversationProjection。
    Runtime 仅报告“Pi 已不可继续执行”；状态解释仍留在 conversation 模块。
```

`packages/pi-rpc`、`SessionEntryState`、Host-Webview bridge、shared `ToolCallStatus` 均不修改：`cancelled` 已是现有共享状态，Pi RPC 不提供也不需要新的事件或持久化字段。

### Webview

```text
apps/vscode/src/webview/features/conversation/
└── ToolActivity.svelte                   modify  +10–20/-2–5
    为 cancelled 显示非旋转、非成功的警告/停止图标；其悬浮提示和无障碍名称说明
    “未收到最终工具结果，执行可能已中断”。现有 complete/error/running 呈现保持不变。
```

不增加全局样式或新的 UI 状态；状态颜色和图标规则属于该组件的 scoped style。

### 验证

```text
apps/vscode/test/unit/
├── ConversationProjection.test.ts        modify  +45–70/-0
│   覆盖：完整历史中 toolCall 缺少 toolResult → cancelled；agent_settled 后缺少
│   tool_execution_end → cancelled；后到的 toolResult 覆盖为 complete/error。
│
└── SessionRuntime.test.ts                 modify  +25–45/-0
    用 fake Pi 产生 running tool 后，分别触发 runtime.stop() 与 Pi 进程失败，
    断言 ViewModel 不再含 running tool。
```

不为单一图标分支创建新的 Webview 测试基础设施；TypeScript 检查保证状态穷尽性，投影和 Runtime 测试保护用户可观察的状态合同。

## 跨模块规则

1. **结果权威不变**：只有实时 `tool_execution_end` 或持久化 `toolResult` 可以声明 `complete`/`error`。`cancelled` 只表达最终结果缺失。
2. **终结边界集中**：`ConversationProjection` 决定工具何时不再允许为 `running`；`ConversationItemStore` 只负责原子地替换现有 ViewModel 项；`SessionRuntime` 不直接写工具状态。
3. **完整替换与增量更新不同**：只在 `replaceEntries()` 收口历史中的未确认工具，绝不在 `reconcileEntries()` 中收口。增量期间 Pi 仍可能正常执行工具。
4. **可被权威结果纠正**：`cancelled` 不是持久化事实。相同 `toolCallId` 的后到 `toolResult` 必须覆盖该状态。
5. **不伪造执行结果**：被取消标记的工具保留已有输入和局部输出，但不新增 error 文本、success 文本或 `endedAt`；外部副作用是否发生不可从 FrostPi 当前记录得出。

## 已知边界与明确不做

- 不改变 `AgentTurnStatus`。本变更修复工具卡片的错误“运行中”指示；回合级 completed/aborted/error 的既有含义不被工具结果缺失重新解释。
- 不以超时判定工具结束，也不在 `message_end(stopReason: "toolUse")` 时收口；两者都可能处于正常执行期间。
- 不区分“用户主动终止”与“Pi 意外中断”。若将来产品需要分别呈现或统计两者，应新增状态来源和用户可见语义，而不是把该差异猜入当前记录。
- 不恢复、重放或重新执行中断前的工具调用。

## 依赖前提

- Pi 的持久化 `toolResult` 仍按既有合同以 `toolCallId` 对应工具调用，并且其成功/失败内容优先于本地临时状态。
- `agent_settled`、Pi 进程停止和连接失败后，FrostPi 不再能从旧进程接收该轮工具执行的更新；session lifecycle 已规定重启后旧工具不存活。
- 历史自动加载只在 session 非 streaming 时执行；加载过程中若有新实时事件，现有缓冲与回放机制会在历史替换后应用它们。
