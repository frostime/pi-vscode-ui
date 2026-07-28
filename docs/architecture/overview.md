---
title: Architecture Overview
description: Runtime topology, ownership boundaries, and dependency direction for FrostPi.
scope:
  - /apps/vscode/**
  - /packages/pi-rpc/**
updated: 2026-07-28
---

# Architecture Overview

```text
Svelte Webview
  ├─ ordered conversation presentation
  ├─ CodeMirror composer
  └─ local disclosure/scroll state
          ⇅ versioned application messages
VS Code workspace Extension Host
  ├─ SessionRegistry
  │    └─ SessionRuntime × N
  │         ├─ SessionEntryState
  │         ├─ ConversationProjection
  │         ├─ SessionViewState
  │         ├─ ExtensionUiCoordinator
  │         └─ PiRpcApi
  ├─ WorkspaceFileSearch
  ├─ proxy/process environment policy
  └─ editor, diff, diagnostics integration
          ⇅ LF-delimited JSONL over stdio
     pi --mode rpc × N
```

One FrostPi session owns one Pi subprocess. Sessions may run concurrently; switching the rendered session never transfers ownership or stops background work.

`SessionRuntime` is the lifecycle orchestrator for three sibling state owners:

- `SessionEntryState` owns the `get_entries` cursor, current leaf, content-free complete-tree index, active path, and incremental-continuation validation.
- `ConversationProjection` owns persisted/live conversation identity, visual-turn grouping, tool correlation, branch-edge placement, and final presentation order.
- `SessionViewState` owns session-level status, model, configuration, statistics, and extension UI state.

`sessionTreeProjection` remains stateless. It derives active branch edges from the retained index and operation-local picker choices from freshly fetched complete entries.

Runtime data flow is `Webview → shared contracts ← Extension Host → @frostime/pi-rpc → Pi`. The Webview may reuse Pi model metadata types at compile time, but it does not consume RPC messages, raw Pi events, or session entries. The Host sends one ordered conversation collection; the Webview does not infer Pi order. `WorkspaceFileSearch` exposes paths only. Proxy policy is resolved at process start and remains outside the RPC protocol.

FrostPi is intentionally a Pi-only VS Code GUI adapter. It follows Pi's native RPC model and preserves Pi-specific capabilities rather than defining a generic agent-backend interface or translating Pi through ACP. Other Pi clients may inform behavior comparisons during development, but they are not FrostPi backends or compatibility targets.
