---
title: steer-and-queue Context Map
created: 2025-07-27
updated: 2025-07-27
---

# steer-and-queue Context Map

任务：FrostPi UI 层补充第二种消息入队方式（steer），与既有 followUp 并行，对齐 Pi 标准语义。Issue 见 `changes/steer-and-queue/Issue.md`，Pi 机制调研见同目录 `RESEARCH.md`。

## Core Files

- `apps/vscode/src/webview/features/composer/PromptEditor.svelte` — composer 键位绑定（Enter 换行 / Mod-Enter 提交），加第二提交键在此
- `apps/vscode/src/webview/features/composer/Composer.svelte` — `submit()` 唯一发送出口，`postToHost({ type: "sendPrompt" })`；发送动作分发层
- `apps/vscode/src/shared/bridge/webviewToHost.ts` — webview→host 消息 zod schema（`sendPrompt` 定义处），加字段在此
- `apps/vscode/src/extension/sessions/SessionRuntime.ts` — `sendPrompt()`：唯一排队分支（硬编码 followUp）+ RPC 透传；核心改造点
- `apps/vscode/src/extension/conversation/ConversationProjection.ts` — `#queuedFollowUps` 队列、`enqueueFollowUp()`、promote 逻辑；steer 队列投影参照此实现
- `apps/vscode/src/webview/features/conversation/ConversationView.svelte` — `queuedFollowUps` 气泡渲染（"Queued" 徽章）；steer 可见性参照
- `apps/vscode/src/shared/model/sessionViewModel.ts` / `conversationModel.ts` — `QueuedFollowUpView`、`queuedFollowUps` 视图模型
- `apps/vscode/src/extension/configuration/readConfiguration.ts` — `composer.streamingBehavior` 读取（`"steer" | "followUp"`，默认 followUp）
- `apps/vscode/package.json` — `frostpi.composer.streamingBehavior` 设置项定义
- `apps/vscode/src/extension/sessions/session-lifecycle.SPEC.md` — followUp 排队/提升既有契约（改动必须保持或同步修订）
- `packages/pi-rpc/src/PiRpcApi.ts` — RPC 客户端 `prompt()` 已支持 `streamingBehavior` 透传；可选 `steer()`/`followUp()` 专用方法
- `packages/pi-rpc/src/protocol/` — RPC 协议类型/事件（`queue_update` 事件通道，steer 队列投影可选来源）

## Navigation

- 理解 Pi 侧 steer/followUp 语义 → 读 `changes/steer-and-queue/RESEARCH.md`（含 RPC 命令与事件判定链），不必重读 Pi 源码
- 理解 FrostPi 现状 → `PromptEditor.svelte`（键位）→ `Composer.svelte`（提交）→ `SessionRuntime.sendPrompt()`（排队决策）→ `ConversationProjection.ts`（队列投影）
- 队列可见性链路：`SessionRuntime` → `ConversationProjection` → `sessionViewModel` → `ConversationView.svelte`
- 契约边界：webview 零 `vscode`/Node 依赖，只经 `webviewToHost.ts` 消息与 host 通信；改契约需同步两端的 zod schema 与 handler
- 单元测试定位：相关 SPEC 契约测试在 `apps/vscode/src/extension/**/*.spec.ts`（沿用 `pnpm --dir apps/vscode exec vitest run <pattern>` 局部跑）

## Discovered Later

<!-- append-only：实现调研中发现的新文件/符号追加在此 -->

- `apps/vscode/src/webview/features/composer/StreamingSendButton.svelte` — streaming + 非空草稿时出现的 Steer/Queue split action
- `apps/vscode/src/webview/features/composer/composerStreamingBehaviorStore.svelte.ts` — Webview 生命周期内的 per-session 投递方式记忆
- Pi 0.84.1 RPC 没有 dequeue/clear queue 命令；TUI 的 Alt+Up 调用进程内 `AgentSession.clearQueue()`，因此 FrostPi 不能安全实现单条气泡撤回
