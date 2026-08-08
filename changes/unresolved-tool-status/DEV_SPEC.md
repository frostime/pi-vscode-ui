---
title: 未确认工具结果状态
status: clarified
---

# 问题陈述

FrostPi 的工具调用卡片有时会在工具执行已不可能继续时持续显示“运行中”。典型情形是 Pi 在记录工具调用后、记录最终工具结果前被停止或异常退出；恢复该 session 时，FrostPi 能恢复工具调用，却不会收到旧进程的实时结束事件。

“运行中”应表示 FrostPi 仍可能收到该工具的实时更新，而不是“历史中出现过工具调用”。当最终结果缺失时，FrostPi 不能据此断言工具成功、失败或未产生外部副作用；但也不能继续显示它在运行。

成功标准是：终结后的未确认工具不再转圈，并明确告知用户最终结果未被记录；已记录的成功与失败工具保持现有显示和内容。

# 核心方法

复用现有工具状态 `cancelled`，将其用户语义定义为：FrostPi 在收到最终结果前失去了该次工具执行的实时追踪。界面采用“未收到最终结果／可能已中断”的表达，而非“成功”或“失败”。

Pi 的 `toolResult` 仍是工具成功或失败的唯一持久化权威。`cancelled` 是本地投影状态，不写回 Pi，也可被相同工具调用标识的后到 `toolResult` 覆盖。

实现布局和模块落点见同目录的 `unresolved-tool-status.LAND.md`；本 SPEC 只定义行为与约束。

# 行为契约

## 工具状态

- 工具刚开始执行或收到执行更新时为 `running`。
- 实时 `tool_execution_end` 将工具设为 `complete` 或 `error`，保留现有输出和错误行为。
- 持久化 `toolResult` 将对应工具设为 `complete` 或 `error`；它优先于临时状态。
- 下列终结边界到达后，仍为 `running` 且没有最终结果的工具必须变为 `cancelled`：
  - 完整持久化历史已替换到会话视图；
  - agent 已发出 `agent_settled`；
  - FrostPi 正在主动停止该 Pi 进程；
  - Pi 连接发生失败。
- `cancelled` 工具保留调用参数和已收到的局部输出，不补造成功文本、失败文本或结束时间。
- 若最终 `toolResult` 在工具已被标为 `cancelled` 后才可用，它必须把该工具更新为实际的 `complete` 或 `error` 状态。

## 显示

- `running` 显示旋转中的状态图标。
- `complete` 显示成功图标，`error` 显示错误图标，保持现有行为。
- `cancelled` 必须显示为既非旋转也非成功的状态，并提供“未收到最终工具结果，执行可能已中断”的可发现说明。
- `cancelled` 不是错误结果：除非已有最终结果明确报错，它不应被计为工具错误。

## 边界

- 正在增量同步历史时，不得仅因工具调用尚未有 `toolResult` 就将它标为 `cancelled`；Pi 仍可能继续执行。
- 不使用时间阈值推断工具结束。
- 不在 `message_end` 的 `stopReason: "toolUse"` 时终结工具；该消息是正常工具执行链的一部分。
- 不重新执行、补发或重放任何未确认的历史工具调用。
- 本变更不重新解释回合级状态：工具状态为 `cancelled` 本身不改变该回合既有的 completed、aborted 或 error 状态。

# 技术决策

- 工具条目的实际批量状态替换由会话项存储组件负责，因为它独占工具位置索引和不可变 ViewModel 更新。
- 会话投影组件负责识别历史替换和 agent 完成等终结边界，并请求存储组件终结未确认工具。
- 会话运行时只在 Pi 不再可继续执行时发出该生命周期信号，不直接修改工具 ViewModel。
- 不新增 Pi RPC 事件、持久化字段、共享 ViewModel 状态或 Host-Webview bridge 协议；使用已有的 `cancelled` 状态。
- 不区分用户主动终止、进程停止和意外连接失败的原因。三者在当前范围内都表示“最终工具结果未确认”。

# 验收标准

## 自动化检查

- 完整历史仅含工具调用、缺少匹配的 `toolResult` 时，投影中的该工具为 `cancelled`，而非 `running`。
- 完整历史含匹配的成功或失败 `toolResult` 时，工具分别为 `complete` 或 `error`，输出和错误内容不回归。
- 实时工具未收到结束事件但 agent 已 settled 时，工具转为 `cancelled`。
- 已被标为 `cancelled` 的工具在收到匹配的持久化 `toolResult` 后，更新为 `complete` 或 `error`。
- FrostPi 主动停止 Pi 或 Pi 连接失败后，Session ViewModel 中不保留 `running` 工具。
- 增量同步中尚在执行的工具仍保持 `running`。
- 聚焦单测通过：
  `pnpm --dir apps/vscode exec vitest run test/unit/ConversationProjection.test.ts test/unit/SessionRuntime.test.ts`
- 完整静态检查和构建通过：`pnpm check`、`pnpm build`。

## 用户检查

- 在工具开始后立即停止或异常终止 session，再恢复该 session：没有最终结果的工具不再显示旋转图标，且可得知结果未被记录。
- 正常完成的工具仍显示成功，工具失败仍显示错误；两者均不被误标为 `cancelled`。
- 在窄宽度、VS Code 浅色、深色和高对比度主题下，未确认状态与成功状态可区分。

# 延后范围

- 区分“用户取消”和“进程中断”的独立工具状态、文案或统计。
- 用工具的未确认状态推导或替换 agent turn 的状态。
- 对工具外部副作用是否已发生作出结论。

# 术语

- **最终工具结果（`toolResult`）**：Pi 持久化记录中与一个工具调用标识对应的结果；它是 FrostPi 判断该工具成功或失败的权威依据。
- **未确认工具**：已看到工具调用，但 FrostPi 未得到其最终工具结果的工具。
- **`cancelled`**：本变更中的本地终态，表示 FrostPi 在取得最终结果前失去实时追踪；不表示外部操作已回滚或未执行。
