# 调研报告：Pi 的 steer 与 queue（followUp）消息机制

> 独立调研报告，面向 FrostPi（VS Code 扩展 + 直接 Pi RPC 客户端）对接 Pi 消息发送机制。
> 调研对象版本：`@earendil-works/pi-coding-agent@0.84.1`（含 `pi-agent-core@0.84.1`）
> 源码依据：npm 全局安装目录 `node_modules/@earendil-works/pi-coding-agent/`（下文简称 `<pi-root>`）。

---

## 1. 结论摘要（TL;DR）

- Pi 在 agent 运行期间允许用户继续提交消息，消息进入两条**独立的队列**：**steering 队列**和 **follow-up 队列**。
- 二者投递时机不同，这是全部语义差异的核心：
  - **steer（转向消息）**：在**当前 assistant 回合的 tool call 执行完后、下一次 LLM 调用之前**注入，可中途打断、纠偏正在进行的运行。
  - **followUp（后续消息）**：只在 agent **将要自然停止时**（无更多 tool call、steer 队列为空）才注入，让当前工作完整跑完后追加一轮。
- TUI 中 **Enter = steer**，**Alt+Enter = followUp**（用户记忆正确）；Esc 中止并恢复队列消息到输入框，Alt+Up 手动取回。
- RPC 中无按键，对应为：`prompt` + `streamingBehavior` 字段，或专用命令 `steer` / `follow_up`；队列状态通过 `queue_update` 事件推送，最终完成以 `agent_settled` 事件为准。
- 默认投递模式 `one-at-a-time`（每回合只取一条），可配置为 `all`。

---

## 2. 机制总览：分层架构

消息发送机制横跨四层，语义逐层一致：

```
┌─────────────────────────────────────────────────────────────┐
│ 入口层      TUI (Enter/Alt+Enter) │ SDK │ RPC │ 扩展 sendUserMessage │
├─────────────────────────────────────────────────────────────┤
│ 会话层      AgentSession.prompt(streamingBehavior)          │
│             AgentSession.steer() / followUp()               │
├─────────────────────────────────────────────────────────────┤
│ 核心层      Agent.steeringQueue / followUpQueue             │
│             (PendingMessageQueue: one-at-a-time | all)      │
├─────────────────────────────────────────────────────────────┤
│ 执行层      agent-loop.runLoop 双层循环                      │
│             内层: tool call 循环, 每轮前取 steer             │
│             外层: agent 将停止时取 followUp                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 核心语义：投递时机差异（执行层）

`<pi-root>/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js` 的 `runLoop()` 是语义的最终裁决点，结构为双层循环：

```js
// agent-loop.js L82-170 (精简)
async function runLoop(initialContext, newMessages, initialConfig, signal, emit, streamFunction) {
    let pendingMessages = (await config.getSteeringMessages?.()) || [];   // L83 开局先取 steer
    while (true) {                                                       // L85 外层循环
        let hasMoreToolCalls = true;
        while (hasMoreToolCalls || pendingMessages.length > 0) {         // L88 内层循环
            // 注入 pending 消息（steer）到上下文，再请求 LLM 响应        // L96-104
            // 执行 tool call；hasMoreToolCalls 由 tool 批次决定
            ...
            pendingMessages = (await config.getSteeringMessages?.()) || []; // L160 每回合结束重取 steer
        }
        // 内层退出 = agent 本要停止
        const followUpMessages = (await config.getFollowUpMessages?.()) || []; // L163
        if (followUpMessages.length > 0) {                               // L164
            pendingMessages = followUpMessages;                          // L166 转成 pending 继续
            continue;
        }
        break;                                                           // 无 followUp → 真正结束
    }
}
```

| 队列 | 检查时机 | 效果 |
|---|---|---|
| **steer** | `L83`（开局）与 `L160`（每个 assistant 回合结束后） | 只要 agent 还在跑（含 tool call 之间），下一条 LLM 调用前就会注入 → **打断当前运行** |
| **followUp** | `L163`（内层循环退出、agent 将要停止时） | 当前所有 tool call 与 steer 处理完才注入 → **让当前工作跑完再追加** |

`PendingMessageQueue`（agent.js L51-79）默认 `one-at-a-time`：`drain()` 每次只取队首一条，agent 每回合消费一条；`mode = "all"` 时一次清空整队。

---

## 4. TUI 入口：Enter / Alt+Enter

`<pi-root>/docs/usage.md` L62-70：

> - **Enter** queues a steering message, delivered after the current assistant turn finishes executing its tool calls.
> - **Alt+Enter** queues a follow-up message, delivered after the agent finishes all work.

键位绑定（`docs/keybindings.md` L155）：`app.message.followUp` = `alt+enter`；提交键 `tui.input.submit` = `enter`。

实现（`dist/modes/interactive/interactive-mode.js`）：

```js
// L2462  Enter → onSubmit → 流式时以 steer 方式排队
await this.session.prompt(text, { streamingBehavior: "steer" });

// L3246  Alt+Enter → handleFollowUp → 流式时以 followUp 方式排队
await this.session.prompt(text, { streamingBehavior: "followUp" });
```

补充行为：
- **空闲时** Alt+Enter 等同 Enter（L3250-3253 直接触发 `onSubmit`）；
- **compaction 期间** 消息入本地补偿队列（`queueCompactionMessage(text, "steer"|"followUp")`，L2453 / L3237），compaction 结束后回放；
- **Esc** 中止运行并把队列消息恢复到输入框；**Alt+Up**（`app.message.dequeue`）手动取回排队消息。

---

## 5. RPC 入口（FrostPi 对接层）

`<pi-root>/docs/rpc.md`，命令分发在 `dist/modes/rpc/rpc-mode.js` L303-326。

### 5.1 映射表

| TUI 按键 | RPC 命令 |
|---|---|
| Enter（steer） | `{"type": "prompt", "message": "...", "streamingBehavior": "steer"}` 或 `{"type": "steer", "message": "..."}` |
| Alt+Enter（followUp） | `{"type": "prompt", "message": "...", "streamingBehavior": "followUp"}` 或 `{"type": "follow_up", "message": "..."}` |
| Esc（中止） | `{"type": "abort"}` |
| 底部 pending 显示 | `queue_update` 事件 / `get_state` 的 `pendingMessageCount` |
| settings `steeringMode`/`followUpMode` | `set_steering_mode` / `set_follow_up_mode`（`"all"` 或 `"one-at-a-time"`，默认 `one-at-a-time`） |

### 5.2 `prompt` vs 专用命令

- `prompt` 走完整输入管线：扩展命令（`/xxx`）**立即执行**（即使流式中）、skill 命令与模板展开；流式中**不带** `streamingBehavior` 直接报错。
- `steer` / `follow_up` 是纯入队操作：拒绝扩展命令（`use prompt instead`），支持 `images` 字段，同样展开 skill 命令与模板。

### 5.3 响应与事件语义（RPC 客户端必须注意）

- `prompt` 的 `response` 在**预检通过（已接受/入队）时立即返回** `success: true`，不等待执行完成；此后一切通过事件流异步到达。**response ≠ 完成信号。**
- 事件判定链：
  - `queue_update`（rpc.md L1017）：队列变化即推送，字段 `steering` / `followUp` 为当前排队文本数组；
  - `agent_end`（L870）：一个 run 结束，但**可能还有 retry、compaction、队列续跑**；
  - `agent_settled`（L882）：完全 settle，不再自动继续——**followUp 的"交付完毕"以此为准**。

### 5.4 空闲时行为差异（与 TUI 不同）

TUI 空闲时 Alt+Enter 等同 Enter（直接提交）；但 RPC 的 `steer` / `follow_up` 在空闲时**只入队不触发运行**（rpc-mode.js 直接调 `session.steer()`，无空闲分支）。空闲 agent 要跑起来仍需发 `prompt`。

---

## 6. SDK / 扩展入口

`<pi-root>/docs/sdk.md` L182-234：

```ts
// 流式时必须指定排队方式，否则抛错
await session.prompt("Stop and do this instead", { streamingBehavior: "steer" });
await session.prompt("After you're done, also check X", { streamingBehavior: "followUp" });

// 显式排队
await session.steer("New instruction");      // 当前回合 tool call 后注入
await session.followUp("After you're done, also do this");  // agent 停止时注入
```

- 扩展层：`pi.sendUserMessage(text, { deliverAs: "steer" | "followUp" | "nextTurn", triggerTurn })`（docs/extensions.md L1401-1433）。
- 会话层实现（`dist/core/agent-session.js` L986-1040）：`steer()`/`followUp()` 先拒绝扩展命令 → 展开 skill 命令与模板 → 推入本地 `_steeringMessages`/`_followUpMessages`（供 UI 显示）→ 调 `agent.steer()`/`agent.followUp()` 入核心队列 → 发 `queue_update`。

---

## 7. 边界与注意事项

1. 扩展命令（`/xxx`）流式中仍立即执行，**不能被排队**；skill 命令与文件模板会被展开后排队。
2. Windows Terminal 默认抢占 Alt+Enter（全屏），需要 remap 才能让 pi 收到（docs/usage.md L72-74）。
3. `steeringMode`/`followUpMode` 可独立配置投递粒度（one-at-a-time / all）。
4. FrostPi 的 `packages/pi-rpc` 是 RPC 协议客户端，无 UI 按键语义；若扩展需要"排队"能力，应暴露 `streamingBehavior` / `steer` / `follow_up` 对应的 UI 动作，并用 `queue_update` + `agent_settled` 重建"排队中/已交付/已完成"状态。

---

## 8. 源码证据溯源表

| 层 | 文件 | 行号 | 证据点 |
|---|---|---|---|
| 执行层 | `<pi-root>/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js` | L83, L88, L96-104, L160, L163-166 | runLoop 双层循环；steer 每回合检查、followUp 停止时检查 |
| 核心层 | `<pi-root>/node_modules/@earendil-works/pi-agent-core/dist/agent.js` | L51-79 | PendingMessageQueue（drain 语义） |
| 核心层 | 同上 | L128-129 | 默认 `one-at-a-time` |
| 核心层 | 同上 | L173-177 | `steer()`/`followUp()` 分别入两条队列 |
| 核心层 | 同上 | L316-324 | `getSteeringMessages`/`getFollowUpMessages` 接线 |
| 会话层 | `<pi-root>/dist/core/agent-session.js` | L91-93, L986-1040, L1155-1159 | steer/followUp 展开与入队、队列查询 |
| TUI | `<pi-root>/dist/modes/interactive/interactive-mode.js` | L2236, L2462, L3225-3253 | Alt+Enter 绑定；Enter→steer、Alt+Enter→followUp |
| RPC | `<pi-root>/dist/modes/rpc/rpc-mode.js` | L303-326 | prompt/steer/follow_up 命令分发 |
| 文档 | `<pi-root>/docs/usage.md` | L62-70 | 官方 Message Queue 语义描述 |
| 文档 | `<pi-root>/docs/keybindings.md` | L155 | `app.message.followUp` = `alt+enter` |
| 文档 | `<pi-root>/docs/rpc.md` | L43-124, L336-370, L841-884, L1017-1027 | RPC 命令、模式、事件定义 |
| 文档 | `<pi-root>/docs/sdk.md` | L182-234 | SDK 排队 API |
| 文档 | `<pi-root>/docs/extensions.md` | L1401-1433 | sendUserMessage deliverAs |

## 9. 参考文档

- `docs/usage.md`（Message Queue 一节）
- `docs/keybindings.md`
- `docs/rpc.md`（Prompting / Queue Modes / Event Types）
- `docs/sdk.md`（Prompting and Message Queueing）
- `docs/extensions.md`（sendUserMessage）
- `docs/settings.md`（steeringMode / followUpMode）
