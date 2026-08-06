---
title: Ephemeral Session Context Map
created: 2026-08-01
updated: 2026-08-01
---

# Ephemeral Session Context Map

> 任务范围的代码导航索引。行为与意图以 `changes/ephemeral-session/DEV_SPEC.md` 为准，本文件只回答"相关代码在哪里、彼此如何衔接"。

## Core Files

### Extension Host

- `apps/vscode/src/extension/sessions/SessionRegistry.ts` — 会话生命周期编排：创建、持久化过滤、重启策略、关闭确认
  - `createSession()` / `#createSessionInDirectory()` — 创建入口，需接收 ephemeral 参数
  - `#temporarySessionIds` — 现有"未转正"过滤模式；ephemeral 不进入此集合
  - `#persist()` — 持久化出口，需过滤 ephemeral 记录
  - `retrySession()` / `restartAllSessions()` / `#restartRuntime()` — 重启路径，ephemeral 拒绝/跳过
  - `#handleRuntimeChange()` — 记录更新时保留 ephemeral 标志
  - `rename()` / `sendPrompt()` — 现有"首条 prompt/重命名转正"逻辑，对 ephemeral 不生效
  - `closeSession()` / `confirmClose()` — 关闭确认；ephemeral 文案改为"内容将丢失"
  - `#discardActiveTemporarySession()` — 切换会话丢弃逻辑，ephemeral 不参与
- `apps/vscode/src/extension/sessions/SessionRuntime.ts` — 单个 Pi 进程的 RPC/生命周期编排
  - `#startInternal()` — 启动参数拼装处，ephemeral 追加 `--no-session`
  - `start()` — 启动入口，需透传 ephemeral 标志
- `apps/vscode/src/extension/sessions/SessionViewState.ts` — 会话级 ViewModel 状态；构造时初始化 `isEphemeral` 字段
- `apps/vscode/src/extension/sessions/sessionTypes.ts` — `PersistedSessionRecord` 增加 ephemeral 标志（仅内存，不落盘）
- `apps/vscode/src/extension/sessions/SessionPersistence.ts` — Memento 读写；ephemeral 记录不经过 `save()`，通常无需改动
- `apps/vscode/src/extension/sessions/session-lifecycle.SPEC.md` — 契约文档；"Temporary sessions" 章节需扩展 ephemeral 语义

### Webview 与桥接

- `apps/vscode/src/webview/features/sessions/SessionHeader.svelte` — launcher 菜单；Temporary mode toggle（新增）、New session 按钮文案、Restart 按钮置灰、restartRequired 文案区分
- `apps/vscode/src/webview/features/sessions/SessionList.svelte` — 会话列表项；ephemeral 显示「临时」徽标
- `apps/vscode/src/shared/bridge/webviewToHost.ts` — `createSession` 消息 zod schema，需加 ephemeral 字段
- `apps/vscode/src/extension/webview-host/WebviewBridge.ts` — `createSession` 消息分发 → `registry.createSession()`
- `apps/vscode/src/shared/model/sessionViewModel.ts` — `SessionViewModel` / `SessionSummaryView` 增加 `isEphemeral`

### 测试

- `apps/vscode/test/unit/SessionRegistry.test.ts` — 持久化过滤、重启拒绝/跳过、重启后不恢复
- `apps/vscode/test/unit/SessionRuntime.test.ts` — 启动参数断言（已有 launch args 记录模式，可断言 `--no-session`）

## Navigation

- 理解现有 temporary 机制 → `SessionRegistry.ts`：`#temporarySessionIds`、`#persist()`、`#discardActiveTemporarySession()`、`sendPrompt()`/`rename()` 的转正点
- 理解进程启动参数 → `SessionRuntime.ts` 的 `#startInternal()`；Pi 侧 `--no-session` 语义见 Pi docs/sessions.md（in-memory SessionManager）
- 理解创建入口链路 → `SessionHeader.svelte`（按钮）→ `webviewToHost.ts`（schema）→ `WebviewBridge.ts`（分发）→ `SessionRegistry.createSession()`
- 理解重启链路 → `registerCommands.ts`（命令）→ `SessionRegistry.retrySession()`/`restartAllSessions()` → `SessionRuntime.stop()`/`start()`

## Module Boundaries

- Webview 不能直接创建/重启会话：一切经 bridge 消息（zod 校验）到达 registry
- Pi 进程参数只在 `SessionRuntime.#startInternal()` 一处拼装；ephemeral 标志在 registry 决定、runtime 执行
- 持久化只在 `SessionRegistry.#persist()` → `SessionPersistence.save()`；ephemeral 在此被过滤，永不落盘

## Discovered Later

<!-- append-only：实现过程中新发现的相关文件/符号追加于此 -->
