---
title: Pi 0.84 Message Streaming Context Map
created: 2026-08-09T12:09:51+08:00
updated: 2026-08-09T12:09:51+08:00
---

# Pi 0.84 Message Streaming Context Map

## Task Artifacts

- `changes/pi-084-compatibility/OBSERVATION.md` — Pi 0.84 breaking changes, repository contact surfaces, verified upstream evidence, and original open questions.
- `changes/pi-084-compatibility/pi-084-message-streaming.SPEC.md` — settled requirements, observable behavior, boundaries, and acceptance criteria for this code change.
- `changes/pi-084-compatibility/chat-export@26-08-09T01-02_Pi 0.84 升级预调研与兼容性分析.xml` — full record of the read-only compatibility investigation that preceded the SPEC.

## Core Files

- `apps/vscode/src/extension/conversation/ConversationProjection.ts` — turns Pi events and persisted entries into conversation activities.
  - `applyEvent()` — dispatches live Pi message and tool events.
  - `#applyAssistantMessageEvent()` — current live assistant path; currently requires a complete `event.message`.
  - `assistantActivities()` — converts complete assistant content into reasoning, response, and tool activities.
  - `replaceEntries()` and `completeTurn()` — important reset and finalization boundaries.
- `apps/vscode/src/extension/conversation/ConversationItemStore.ts` — owns stable assistant placement, live-to-persisted takeover, and tool activity locations.
  - `placeAssistant()` — preserves one assistant owner across live updates and persisted takeover.
  - `upsertTool()` — correlates tool execution events with an existing tool activity.
  - `#replaceAssistantInTurn()` — replaces streamed activities while preserving unrelated same-turn items.
  - `#recordAssistantLocations()` — maps real tool-call IDs to their current activity locations.
  - `finalizeUnresolvedTools()` — changes still-running tools to cancelled at finalization boundaries.
- `apps/vscode/src/extension/conversation/messageAssembler.ts` — existing helpers for content blocks, tool views, and safe extraction from untyped Pi data.
- `apps/vscode/src/extension/sessions/SessionRuntime.ts` — receives raw connection events, replays events buffered during history loading, owns process stop/failure/restart boundaries, and forwards events to the conversation projection.

## Shared Data and Webview

- `apps/vscode/src/shared/model/conversationModel.ts` — serializable conversation activities sent from the Extension Host to the Webview.
  - `ToolActivityView` — outer conversation item whose ID must stay stable while a pending tool becomes a real tool.
- `apps/vscode/src/shared/model/toolCallModel.ts` — serializable tool identity, status, arguments, output, and timing.
- `apps/vscode/src/webview/features/conversation/AgentTurn.svelte` — keyed rendering of turn items; stable item IDs preserve component instances.
- `apps/vscode/src/webview/features/conversation/ToolActivity.svelte` — tool-card title, status, expansion state, input, output, and file actions.
- `apps/vscode/src/extension/webview-host/collectionDelta.ts` — detects replacement view objects and sends collection updates to the Webview.
- `apps/vscode/src/webview/bridge/applyHostMessage.ts` — merges Host collection updates by item ID.

## Protocol Boundary

- `packages/pi-rpc/src/PiRpcConnection.ts` — process, JSONL framing, request correlation, and raw event delivery; should not assemble assistant messages.
- `packages/pi-rpc/src/protocol/rpcTypes.ts` — intentionally open `RpcEvent` envelope that accepts Pi 0.84 delta-only events.
- `packages/pi-rpc/src/PiRpcApi.ts` — typed command helpers; not responsible for live conversation presentation.

## Existing Contracts

- `docs/protocol/pi-rpc-compatibility.md` — cross-module Pi RPC compatibility and evidence policy.
- `packages/pi-rpc/SPEC.md` — transport-only contract and failure semantics.
- `apps/vscode/src/extension/conversation/conversation-projection.SPEC.md` — persisted authority, live reconciliation, stable identity, tools, retries, and turn lifecycle.
- `apps/vscode/src/extension/sessions/session-lifecycle.SPEC.md` — process lifecycle, retry, abort, history loading, stop, failure, and restart behavior.

## Tests and Fakes

- `apps/vscode/test/unit/ConversationProjection.test.ts` — unit coverage for live and persisted conversation behavior; currently lacks Pi 0.84 delta-only assistant sequences.
- `apps/vscode/test/unit/ConversationItemStore.test.ts` — ownership, takeover, same-turn replacement, notices, and tool-state preservation.
- `apps/vscode/test/unit/SessionRuntime.test.ts` — process event forwarding, history loading, stop, and failure behavior.
- `packages/pi-rpc/test/PiRpcConnection.test.ts` — proves a message-less `message_update` crosses the transport boundary, but not that it is projected.
- `apps/vscode/test/e2e/fake-pi.cjs` — fake Pi process used by VS Code end-to-end tests; currently emits complete start/end messages without realistic streaming updates.
- `apps/vscode/test/e2e/` — product-level tests that can verify a fake Pi delta sequence reaches the rendered conversation.

## Navigation

- To understand why Pi 0.84 updates are currently dropped → read `ConversationProjection.applyEvent()` and `#applyAssistantMessageEvent()`.
- To understand how repeated assistant updates keep one visible identity → read `ConversationItemStore.placeAssistant()` then `#replaceAssistantInTurn()`.
- To understand how an embedded tool call becomes the target of `tool_execution_*` events → read `assistantActivities()`, `#recordAssistantLocations()`, then `upsertTool()`.
- To understand why changing an activity ID loses expansion state → read `AgentTurn.svelte`, `ToolActivity.svelte`, `collectionDelta.ts`, then `applyHostMessage.ts`.
- To understand reset behavior across settle, stop, failure, restart, and history replacement → read `SessionRuntime.ts`, `ConversationProjection.replaceEntries()`, `ConversationProjection.completeTurn()`, and both lifecycle SPECs.
- To add protocol evidence without changing transport policy → extend the fake process and product projection tests; keep `PiRpcConnection` as a raw event boundary.

## Module Boundaries

- `packages/pi-rpc` owns subprocess and JSONL mechanics; it forwards typed top-level events without presentation-specific reconstruction.
- `apps/vscode/src/extension/conversation` owns reconstruction of live assistant content, turn placement, and reconciliation with persisted entries.
- `apps/vscode/src/shared` contains only serializable page data and pure shared types.
- `apps/vscode/src/webview` renders prepared conversation data and owns local disclosure state; it does not interpret Pi RPC events.

## Discovered Later

<!-- Append newly discovered task-relevant navigation pointers here. -->
