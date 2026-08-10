---
title: Pi 0.84 升级兼容性预调研观察
created: 2026-08-09T01:20:35+08:00
status: observation
paired-record: chat-export@26-08-09T01-02_Pi 0.84 升级预调研与兼容性分析.xml
---

# Assume Reader

本文供没有当前对话上下文的 fresh agent 阅读。配套的完整对话导出位于：

`changes/pi-084-compatibility-research/chat-export@26-08-09T01-02_Pi 0.84 升级预调研与兼容性分析.xml`

本文只记录已经观察到的事实、暴露的问题、影响边界和未决信息，不记录实现方案、执行步骤或任务分工。

# 观察范围

调查对象是 FrostPi 当前仓库与 Pi 0.84.0 Release Notes 的 Breaking Changes 部分：

- Pi Release Notes：<https://pi.dev/news/releases/0.84.0>
- Pi RPC 文档：<https://pi.dev/docs/latest/rpc>
- Pi 0.84 RPC 文档：<https://github.com/earendil-works/pi/blob/v0.84.0/packages/coding-agent/docs/rpc.md>
- Pi 0.84 JSON event 转换实现：<https://github.com/earendil-works/pi/blob/v0.84.0/packages/coding-agent/src/modes/json-event.ts>

当时的本地环境中，PATH 下的 `pi --version` 为 `0.83.0`。FrostPi 仓库没有将 Pi 作为 npm 依赖、运行时包或 lockfile 内容；它启动用户环境中的外部 Pi 可执行文件，并且项目兼容性文档明确说明 FrostPi 不捆绑、不 pin Pi 版本。

# Pi 0.84 Breaking Changes 的事实分布

Release Notes 列出 12 项 Breaking Changes，可按边界分为三组。

## Provider / SDK / Extension API

以下变化属于 Pi 内部或扩展开发者使用的 API：

1. `ModelsStreamTransforms` 更名为 `ModelsRequestTransforms`。
2. `ModelRegistry.getApiKeyAndHeaders()` 返回 `ProviderHeaders`，header value 可为 `string | null`，`null` 表示删除 header。
3. `ModelRegistry.refresh()` 改为接收 `ModelsRefreshOptions` 并返回 `ModelsRefreshResult`。
4. `ModelRuntime.setRuntimeApiKey()` 改为接收认证取消选项；远程刷新由单独的 `refresh({ providers, signal })` 完成。
5. Provider OAuth 的 `refreshToken(credentials, signal)` 必须接收并使用具体的 AbortSignal。
6. 手写 Provider 的动态刷新上下文从可读写 `context.store` 改为只读 `context.stored` 与 generation-checked 的 `context.publish()`。

FrostPi 源码、package manifest、lockfile 中没有发现 `ModelRegistry`、`ModelRuntime`、`registerProvider`、OAuth Provider、`ModelsStreamTransforms` 或相关 pi-ai 类型依赖。FrostPi 的模型刷新是 `PiRpcApi.getAvailableModels()` 对 Pi RPC `get_available_models` 的调用；`SessionRuntime.refreshModels()` 的同名方法不是 Pi 的 `ModelRegistry.refresh()`。

## RPC 事件协议

第 2 项改变了 JSON 和 RPC 的 `message_update`：

- 0.83 的事件带有累计的顶层 `message`，并且 `assistantMessageEvent` 带有 `partial`。
- 0.84 只保留 `assistantMessageEvent` delta。
- 需要实时显示的客户端必须从 `message_start` 的初始消息和后续 `contentIndex` delta 组装临时消息。
- `message_end.message` 是最终权威消息。
- 新版 delta 类型包括 `text_*`、`thinking_*`、`toolcall_*`；旧版的 `start`、`done`、`error` delta 类型不再出现在 0.84 RPC 文档中。
- `toolcall_delta.delta` 是需要缓存的参数片段；`toolcall_end.toolCall` 提供完整工具调用。

### 上游实现证据

上述事件序列不是对事件形状的臆测，但也不是对 Pi 0.84 实际 stdout 的现场抓取。依据是 `v0.84.0` release tag 的上游源码和 RPC 文档：

- `packages/agent/src/agent-loop.ts` 的正常 assistant stream 路径在收到 provider `start` 时发出 `message_start`，在后续内容事件中发出 `message_update`，在 `done`/`error` 或 stream fallback 时发出 `message_end`：
  <https://github.com/earendil-works/pi/blob/v0.84.0/packages/agent/src/agent-loop.ts#L317-L370>
- `packages/coding-agent/src/modes/rpc/rpc-mode.ts` 将订阅到的 session event 通过 `toJsonEvent(event)` 写到 RPC stdout：
  <https://github.com/earendil-works/pi/blob/v0.84.0/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L353-L357>
- `packages/coding-agent/src/modes/json-event.ts` 明确删除 `message_update` 的累计快照和 `assistantMessageEvent.partial`，只输出 `assistantMessageEvent`：
  <https://github.com/earendil-works/pi/blob/v0.84.0/packages/coding-agent/src/modes/json-event.ts#L21-L39>
- Pi 0.84 RPC 文档给出了相同的事件格式、delta 类型和 `message_end.message` authoritative 语义：
  <https://github.com/earendil-works/pi/blob/v0.84.0/packages/coding-agent/docs/rpc.md#L915-L956>

因此，当前记录能够确认的是“v0.84.0 tag 的实现和文档定义了该序列”；没有确认的是任意 Provider、异常路径或具体安装包在真实运行时的全部事件时序。

这一项直接穿过 FrostPi 的 Pi RPC 进程边界，并且是目前发现的唯一确定的 FrostPi 自有代码行为问题。

## pi-agent-core Harness / Session / Remote Client API

以下变化属于直接嵌入 Pi SDK、Harness 或 Remote Client 的调用者：

1. 继承的 pi-agent-core Harness session 模型替换为 v4 lane-based `Session`、`SessionStorage`、`SessionRepo`，包含 durable operation records、global facts、shared sequence numbers 和 tree-scoped lane views。
2. v2 Session 与 `AgentHarness` 从 experimental entrypoint 提升为默认导出，并移除 experimental subpaths。
3. legacy JSONL repository 与 in-memory repository API 移除，改用 v4 `JsonlSessionRepo` 或 `InMemorySessionRepo`。
4. 自定义 Harness FileSystem 必须提供同一文件系统语义的 `FileSystem.renameFile()`。
5. Remote session 列表由运行态摘要改为 durable `SessionMetadata`；phase、model、thinking、attachment、lock 等运行态信息改由 acquired `SessionSnapshot` 提供。

FrostPi 不 import pi-agent-core、pi-ai、Pi Remote Client 或这些 repository 类型。Pi 自己的 CLI 进程负责这些内部实现，FrostPi 只观察 RPC 边界。

# FrostPi 当前架构中的接触面

## 进程与 RPC

- `packages/pi-rpc/src/PiRpcConnection.ts` 启动外部 `pi --mode rpc`，负责子进程、JSONL framing、请求响应和事件分发。
- `packages/pi-rpc/src/PiRpcApi.ts` 只封装 RPC 命令，例如 `prompt`、`get_state`、`get_entries`、`fork`、`get_available_models`、`set_model` 和 `get_session_stats`。
- `packages/pi-rpc/src/protocol/rpcTypes.ts` 的 `RpcEvent` 是 `{ type: string; [key: string]: unknown }`，没有要求具体事件字段。
- `PiRpcConnection.#handleRecord()` 只检查 JSON 和顶层 `type`，因此缺失 `message` 的 0.84 事件不会造成连接级协议错误。

## 会话与投影

- `apps/vscode/src/extension/sessions/SessionRuntime.ts` 将收到的非 UI Pi 事件交给 `ConversationProjection`。
- `ConversationProjection.applyEvent()` 在 `message_start`、`message_update`、`message_end` 上调用同一个 assistant 事件处理路径。
- `ConversationProjection.#applyAssistantMessageEvent()` 当前先读取 `event.message`，在 `message` 缺失或 role 不是 assistant 时直接返回。
- `assistantActivities()` 以 `message.content` 作为完整累计内容，构造 reasoning、response 和 embedded tool-call activities。
- `ConversationItemStore` 负责 live/persisted assistant ownership、view identity、tool activity location、persisted takeover 和 tool execution 状态保留。
- Webview 只收到 Host 投影后的 `conversationItems`；raw Pi events 不会直接进入 Webview。

相关代码范围：

- `apps/vscode/src/extension/conversation/ConversationProjection.ts:214-225`
- `apps/vscode/src/extension/conversation/ConversationProjection.ts:438-498`
- `apps/vscode/src/extension/conversation/ConversationProjection.ts:818-861`
- `apps/vscode/src/extension/conversation/ConversationItemStore.ts`
- `apps/vscode/src/extension/sessions/SessionRuntime.ts:701-724`

# 已暴露的直接问题：新版实时 assistant delta 被丢弃

Pi 0.84 的典型事件序列为：

```text
message_start { message: assistant 初始消息 }
message_update { assistantMessageEvent: text/thinking/toolcall delta }
message_end { message: assistant 最终消息 }
```

FrostPi 当前 `ConversationProjection.#applyAssistantMessageEvent()` 在 `message_update` 阶段要求 `event.message` 存在。因而 0.84 的 delta-only 事件会静默返回。

观察到的行为边界：

- `message_end.message` 仍可能让最终文本在 turn 结束时出现。
- 实时文本流在结束前不可见。
- thinking 流在结束前不可见。
- assistant 消息内部的 tool-call 增量在结束前不可见。
- 独立的 `tool_execution_start/update/end` 仍由另一条事件路径处理。
- RPC 连接、请求响应和 JSONL framing 不会因此失败。
- Pi 的持久化 JSONL 与 `get_entries` 结果仍是历史恢复的权威来源。
- 当前 `delta.type === "error"` 分支属于旧事件模型；0.84 的终态错误主要通过 `message_end.message.stopReason` 表达。

这是静默的投影行为回归，不是进程启动失败或协议 envelope 解析失败。

# 测试与证据链暴露的缺口

- `packages/pi-rpc/test/PiRpcConnection.test.ts` 已经发送没有顶层 `message` 的 `message_update`，但只验证传输层事件到达。
- `apps/vscode/test/unit/ConversationProjection.test.ts` 的主要 live assistant 场景直接发送 `message_start` 和 `message_end`，没有覆盖 0.84 的 delta-only 序列。
- `apps/vscode/test/e2e/fake-pi.cjs` 没有模拟真实的 `message_update` 流。
- 因此当前测试可以证明 RPC 能传递新事件，但不能证明 FrostPi 能够把新事件投影为实时 conversation 内容。
- 当前本地 Pi 是 0.83.0，未用真实 0.84.0 进程完成端到端运行验证；0.84 事件形状依据 Release Notes、官方 RPC 文档、v0.84.0 tag 的 `rpc.md` 和 `json-event.ts` 检查。

# Session / JSONL 范围内观察到的关系

FrostPi 确实接触 Pi session，但接触点是 CLI 参数、RPC entries 和有限的只读文件扫描，不是 Pi 0.84 新增或替换的 repository API：

- `SessionRuntime.ts:545-550` 启动时添加 `--session <path>` 或 `--no-session`。
- `SessionRuntime.ts:677-682` 通过 `get_entries` 恢复历史。
- `SessionRuntime.ts:806-834` 使用 `get_entries(since)` 做增量刷新，必要时回退完整刷新。
- `SessionCatalog.ts:71-115` 读取 JSONL 的 `session` header、`session_info` 和用户消息预览。
- `SessionFileScanner.ts` 扫描顶层 `session` 与 `session_info` 记录。
- `SessionPersistence.ts` 保存的是 FrostPi 自己的 workspace metadata，而不是 Pi SessionRepo。

对比 Pi v0.83.0 与 v0.84.0 tag 的 `packages/coding-agent/docs/session-format.md`，内容没有变化，仍然描述 v3 JSONL session format。对比两版 RPC 文档时，观察到的协议差异集中在 `message_update`，未看到 `get_entries`、`fork`、`get_state`、session 启动参数的对应破坏性变化。

FrostPi 内置 Pi extensions 中的 `node:fs/promises.rename()` 只用于临时 Question 请求文件和 session-tree 结果文件的原子发布；它们不是 Pi Harness 的自定义 FileSystem 实现，因此与 `FileSystem.renameFile()` Breaking Change 不是同一边界。

# 内置扩展和外部扩展边界

FrostPi 自带的：

- `apps/vscode/pi-extensions/question-tool.ts` 使用 `registerTool` 和 `ctx.ui.input(..., { signal })`。
- `apps/vscode/pi-extensions/session-tree.ts` 使用 `registerCommand`、`context.waitForIdle()`、`context.navigateTree()` 和 `context.sessionManager.getLeafId()`。

对比 Pi 0.83/0.84 的 coding-agent ExtensionCommandContext 与 ReadonlySessionManager 定义，以上调用仍存在，未观察到与本次 Breaking Changes 的直接冲突。

另一方面，FrostPi 会加载用户自己的 Pi extensions、Provider 和 OAuth 配置，但这些外部代码不属于当前仓库审计范围。若它们直接使用 ModelRegistry、OAuth refresh、provider refresh context 或 pi-agent-core Harness API，其兼容性不能由本次 FrostPi 源码检索结果推断。

# 当前未决的讨论空间

以下内容在本次观察中尚未形成实现结论：

- 0.84 delta 组装状态与现有 assistant ownership、tool execution location、retry/error/abort 生命周期之间的具体交互。
- 多个 `contentIndex`、thinking/text 交错、toolcall 参数片段和异常/中断事件的投影细节。
- FrostPi 是否长期支持 0.83 与 0.84 两种 wire shape，还是采用其他外部 Pi 版本边界；当前仓库没有 Pi 版本 pin。
- 真实 Pi 0.84 运行时是否会在特定 Provider、扩展或失败路径产生额外未记录字段变化。
- Pi 0.84 内部 atomic JSONL publication 对 FrostPi 活跃 session 扫描时序的实际表现；当前没有发现格式层面的变化。

这些未决项属于后续分析和设计空间，不是本文的实现建议。

# 相关文件地图

## 核心协议和投影

- `docs/protocol/pi-rpc-compatibility.md`
- `packages/pi-rpc/SPEC.md`
- `packages/pi-rpc/src/PiRpcConnection.ts`
- `packages/pi-rpc/src/PiRpcApi.ts`
- `packages/pi-rpc/src/protocol/rpcTypes.ts`
- `apps/vscode/src/extension/conversation/ConversationProjection.ts`
- `apps/vscode/src/extension/conversation/ConversationItemStore.ts`
- `apps/vscode/src/extension/conversation/conversation-projection.SPEC.md`

## 会话和文件边界

- `apps/vscode/src/extension/sessions/SessionRuntime.ts`
- `apps/vscode/src/extension/sessions/SessionRegistry.ts`
- `apps/vscode/src/extension/sessions/SessionPersistence.ts`
- `apps/vscode/src/extension/sessions/catalog/SessionCatalog.ts`
- `apps/vscode/src/extension/sessions/catalog/SessionFileScanner.ts`
- `apps/vscode/src/extension/sessions/session-lifecycle.SPEC.md`
- `apps/vscode/src/extension/sessions/catalog/session-catalog.SPEC.md`

## 现有验证材料

- `packages/pi-rpc/test/PiRpcConnection.test.ts`
- `apps/vscode/test/unit/ConversationProjection.test.ts`
- `apps/vscode/test/e2e/fake-pi.cjs`
- `apps/vscode/pi-extensions/question-tool.ts`
- `apps/vscode/pi-extensions/session-tree.ts`
