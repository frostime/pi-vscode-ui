---
title: Pi Session Lifecycle
description: Observable session ownership, authorization, state, persistence, concurrency, mutation, and recovery rules.
scope:
  - /apps/vscode/src/extension/sessions/**
  - /apps/vscode/src/extension/conversation/**
  - /apps/vscode/src/extension/extension-ui/**
updated: 2026-08-09
---

# Pi Session Lifecycle

## Ownership and working directories

One `SessionRuntime` owns exactly one live `pi --mode rpc` process. `SessionRegistry` owns runtimes, sidebar selection (`activeSessionId`), metadata persistence, and arbitrary per-Session views; Pi owns session JSONL and conversation persistence. Sidebar and editor-tab Webviews are disposable presentations and never control Runtime lifetime.

New/Resume anchor to the active editor's workspace folder, otherwise the first folder. The anchor and existing non-bare, non-prunable worktrees of the same repository are allowed; a workspace opened below a worktree root maps that relative subdirectory into linked worktrees only when it exists. The Webview cannot provide a cwd.

Multi-root New/Resume does not aggregate repositories, but persisted records are validated against every open root. External worktree sessions inherit resource-scoped configuration from their anchor. Git authorization is refreshed on New, Resume, restoration, and before starting/restarting a stopped external session. Confirmed worktree removal drops FrostPi metadata without deleting JSONL; failed discovery neither drops uncertain records nor authorizes process start.

## Concurrency and initial restoration

Process starts are serialized; complete-history loads use a separate serialized queue. Agent execution remains concurrent, including sessions sharing a workspace. Selection changes presentation only. FrostPi adds no global execution lock, file-write interception, or conflict resolver.

Activation restores metadata only and creates no session. `frostpi.session.startOnOpen` may start the selected restored session but cannot invent an identity.

## State and turn semantics

```text
stopped ─ request ─> queued ─> starting ─ handshake ─> ready ─ agent_start ─> running
   ▲                              │                    ▲                    │
   └──────── stop <────────── stopping     failed <───┴──── agent_settled ─┘
```

`failed` ends the current child process but leaves retryable metadata. Queued/starting sessions reject submission and model mutation while retaining session actions; running sessions keep the Composer editable and expose Stop. Prompt RPC success means accepted, not completed; only `agent_settled` returns a running session to ready.

`agent_end` closes one model attempt, not necessarily the user turn. With `willRetry: true`, the session remains running and conversation projection keeps the pending assistant error in the same user turn; `auto_retry_start` supplies the transient retry notice. With `willRetry: false`, the pending error may become final. `agent_settled` is the completion boundary: Runtime returns the session to ready, refreshes persisted entries, and may issue the one normal-completion notification. Assistant protocol errors remain errors when no continuation succeeds, while a tool failure remains visible without by itself failing the whole turn. Unresolved tool semantics and finalization boundaries belong to [`conversation-projection.SPEC.md`](../conversation/conversation-projection.SPEC.md#unresolved-tool-results).

`abort` stops the current run and keeps the process. Process stop or connection failure first marks unresolved bound and preparing tools `cancelled`, preserving received arguments, then clears temporary assistant delta assembly. A restart cancels pending extension UI, stops the child, and starts Pi with the recorded session file; active streams, tools, pending requests, and partial assembly state do not survive. Disruptive explicit restart requires confirmation.

## Provisional sessions

A new local session is Provisional until Pi accepts its first non-empty prompt or the user renames it. Provisional Sessions are visible but not persisted; selecting/creating/resuming another session closes the selected Provisional Session without confirmation unless it has ever been projected into a Session Tab. Opening a Provisional Session in a tab retains it for the remainder of that provisional lifetime, including after tab closure; prompt acceptance or rename commits it normally. Resumed sessions are never Provisional, and closing a Provisional Session does not delete Pi-created files. Automatic fork naming and `/compact` do not commit it.

An Ephemeral Session is a separate, user-selected mode. It starts Pi with `--no-session`, never has a session file, never enters the Provisional promotion or switch-discard lifecycle, and is excluded from FrostPi persistence for its entire lifetime. It remains available in memory until explicitly closed or the Extension Host exits; prompts and renames never make it persistent.

A stopped or failed ephemeral process cannot restart because its conversation cannot be reconstructed. Single-session restart and automatic restart-on-send are rejected, bulk restart skips ephemeral sessions, and activation does not start a stopped ephemeral runtime. Fork is unavailable, while in-memory session-tree navigation remains available. Closing an ephemeral session that contains a user prompt always requires confirmation that its content will be permanently lost.

## Message Fork

Fork requires the selected session to be idle, fully loaded, free of pending extension UI and queued follow-ups, and the target to be a completed projected user message with a Pi entry id. The target is identified by entry id, never text. Attachment/seed validation follows the Composer contract.

Pi's successful Fork response is the commit boundary: the original FrostPi id receives a stopped original runtime, while a new Provisional id adopts the live fork runtime. The selected message is excluded from the copied path; Pi text plus projected valid images becomes a one-shot, non-persisted Composer seed. Sidebar-origin Fork selects the result in the sidebar. Session-Tab-origin Fork preserves the sidebar selection, keeps the source tab pinned to the original id, and opens the result in a distinct Session Tab.

Preflight failure or Pi cancellation changes no logical session or draft. Cancel Fork stops the child and restarts the original, preventing a late response from replacing recovery. Post-commit naming/state/history failure stops and removes the unfinished fork, restarts the original, and leaves any Pi-created JSONL on disk.

## Session-tree navigation

Tree navigation is capability-gated, selected-session, ready-state mutation of the same runtime, Pi session id, and JSONL. Runtime refetches complete entries and revalidates the target; Host interaction and Composer replacement policy remain outside the private adapter.

Failure or cancellation before Pi confirms commit preserves history and Composer. After commit, Pi is authoritative: Runtime rebuilds the active path/index and refreshes state without changing runtime identity. Entry-load or projection failure after commit sets only retryable history failure and never reverse-navigates automatically.

## Persistence

FrostPi persists only local session id, title, cwd, Pi session-file path, last-updated time, and active session id. It excludes messages, reasoning, tool output, images, credentials, keys, worktree/branch data, and anchor folder. Restoration rebuilds conversation from Pi `get_entries`; see `apps/vscode/src/extension/conversation/conversation-projection.SPEC.md`.

## Streaming queues and slash commands

A normal prompt accepted during streaming is parked in the session-level Steer or Queue projection selected by that submission. The Composer initializes its per-session selection from `frostpi.composer.streamingBehavior`; Ctrl/Cmd+Enter uses that selection and Alt+Enter explicitly selects Queue for one submission. Pi user-message events promote pending steering messages before follow-ups, matching Pi's delivery priority, with `agent_start` only an idle-gap fallback. Later normal prompts remain parked while either local queue exists. Abort, stop, or process failure clears the local projection; extension slash commands are not parked.

Current Pi RPC exposes queue updates but no dequeue or clear command. FrostPi therefore does not present a per-message remove action or claim that removing a local bubble would cancel Pi-side delivery.

Composer normalizes slash input. Host-local `/compact`, `/resume`, and `/editor` do not become ordinary user prompts; other slash commands use `prompt`. Manual compaction follows Pi semantics and may abort an active run; while compacting, submission is disabled and status is not persisted in the timeline. Success preserves prior turns and adds a summary boundary; failure preserves conversation and reports Pi's error. Pi extension commands may finish without `agent_start`/`agent_settled`, so cached command classification plus idle `get_state` checks closes their local turn. If a known Pi extension command exceeds the ordinary `prompt` response deadline while the process remains live, its completion is unconfirmed rather than failed: FrostPi closes the local turn and shows a warning that Pi may still be waiting for input or finish later. Prompt templates and skills remain ordinary agent turns.

## History and extension UI

A resumed process may reach ready before history finishes. Automatic loading disables/rejects submission; events arriving during load are replayed after replacement. Files over 8 MiB defer full history until explicit load, and tree actions remain unavailable. Failed history/projection is retryable and does not fail the live process. Incremental/complete-entry authority belongs to the conversation projection SPEC.

Blocking extension UI is session-owned and never auto-confirmed. It remains pending until response, Pi timeout, or explicit session cancellation; stop/close/restart cancels pending requests. Background owners are marked as requiring input. Detailed standard/Question behavior belongs to `apps/vscode/src/extension/extension-ui/extension-ui.SPEC.md`.

When notifications are enabled, only first pending input, transition to failed, and a normal turn closed by `agent_settled` notify; explicit abort, `/compact`, immediate extension commands, error turns, and repeated updates do not count as normal completion. A local Windows Extension Host may launch Windows PowerShell with fixed FrostPi notification text encoded as data; other hosts and native-delivery failures fall back to VS Code notifications.

## Recovery

Executable, proxy, and process-environment changes apply only after start/restart. A failed runtime restarts from its stored session file. Missing, corrupt, or incompatible files fail visibly; FrostPi never silently creates an empty replacement under the same UI identity.
