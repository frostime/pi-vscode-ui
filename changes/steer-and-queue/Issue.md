# Issue：FrostPi UI 仅支持一种入队方式（followUp），缺少 steer 第二路径

- **状态**: 已实现，待 VS Code 真机交互验收（见 [RESEARCH.md](./RESEARCH.md)）
- **影响面**: webview composer / extension SessionRuntime / conversation 投影
- **预期修复形态**: 在 UI 层提供与 Pi TUI 等价的两种入队方式（Enter = steer、Alt+Enter = followUp 或等价交互），并为 steer 队列提供可见性

## 问题陈述

FrostPi 的 composer 只有**单一提交路径**（Ctrl+Enter / 发送按钮）。agent 流式运行时，消息的排队方式完全由全局设置项 `frostpi.composer.streamingBehavior` 决定（`enum: ["steer", "followUp"]`，**默认 `followUp`**）：

- 用户无法在**发送时逐条选择**入队方式（Pi TUI 中 Enter = steer、Alt+Enter = followUp）；
- 配置为 `steer` 时消息直接透传 RPC，本地**无任何排队气泡反馈**——用户看不到"已排队待投递"状态；
- 仅 `followUp` 模式有可见队列（`queuedFollowUps` 气泡），steer 队列完全不可见。

## 现状证据（定位）

| # | 位置 | 事实 |
|---|---|---|
| 1 | `apps/vscode/src/webview/features/composer/PromptEditor.svelte` | 键位只有 `Enter`（换行）与 `Mod-Enter`（提交），**无 Alt+Enter** |
| 2 | `apps/vscode/src/webview/features/composer/Composer.svelte` `submit()` | webview 唯一发送出口，`postToHost({ type: "sendPrompt" })`；webview 目录对 `steer` **零引用** |
| 3 | `apps/vscode/src/extension/sessions/SessionRuntime.ts` `sendPrompt()` | 唯一本地排队分支硬编码 `configuration.streamingBehavior === "followUp"`（本地气泡 + RPC `followUp`）；steer 仅通过配置直传 RPC，无本地状态 |
| 4 | `apps/vscode/package.json` | `frostpi.composer.streamingBehavior` 设置项定义，`"default": "followUp"` |
| 5 | `apps/vscode/src/extension/conversation/ConversationProjection.ts` | 仅有 `#queuedFollowUps` 队列及提升逻辑，无 steering 概念 |
| 6 | `apps/vscode/src/webview/features/conversation/ConversationView.svelte` | 仅渲染 `queuedFollowUps`（"Queued" 徽章） |
| 7 | 全量检索 `apps/vscode/src` | `"steer"` 字符串仅出现在 `readConfiguration.ts` 的类型联合 `"steer" \| "followUp"` 中 |

## 期望行为（对照 Pi 标准语义，见 RESEARCH.md §3-§5）

- 流式且 Composer 有内容时提供两种显式入队动作：
  - **Steer**：当前回合 tool call 后、下次 LLM 调用前注入（打断/纠偏）；
  - **Queue**（RPC `followUp`）：agent 将停止时注入（跑完再追加）。
- 两种队列都有可见状态；Stop 固定在最右侧，Split 发送键从其左侧出现。
- `Ctrl+Enter` 使用当前 session 记忆的方式，`Alt+Enter` 显式 Queue；空闲时均为普通发送。
- 保留全局设置作为每个 session 的初始默认值，不作为唯一途径。

## 相关文档

- [RESEARCH.md](./RESEARCH.md) — Pi steer/followUp 机制调研（含 RPC 层语义、事件判定链）
- `apps/vscode/src/extension/sessions/session-lifecycle.SPEC.md` — followUp 排队/提升的既有契约（改动需保持或修订）
- [steer-and-queue.MAP.md](./steer-and-queue.MAP.md) — 任务代码导航地图
