---
title: Dependency Rules
description: Import and ownership constraints that keep protocol, product policy, and UI separate.
scope:
  - /apps/vscode/src/**
  - /packages/pi-rpc/src/**
updated: 2026-07-27
---

# Dependency Rules

- `webview/**` may use browser/Svelte libraries and `shared/**`; it must not import `vscode`, Node built-ins, extension modules, or raw Pi events.
- `extension/**` may use VS Code, Node, `@frostime/pi-rpc`, and `shared/**`; it must not import Svelte components.
- `shared/**` contains JSON-serializable contracts and pure helpers only.
- `packages/pi-rpc/**` owns JSONL/process/request mechanics and has no VS Code dependency.
- `SessionEntryState`, `ConversationProjection`, and `SessionViewState` own disjoint persisted-tree, conversation, and session-scalar state. `SessionRuntime` orchestrates them without a forwarding facade.
- The Host owns conversation order and turn membership. The Webview may collapse or expand activities but must not reconstruct order from timestamps or parallel collections.
- `WorkspaceFileCatalog` returns paths/metadata only and never reads mentioned file content.
- `WebviewBridge` validates and transports messages; it does not infer Pi behavior.
- Proxy configuration types, defaults, UI, and credential policy belong in `extension/network`, while generic environment merging remains in `pi-rpc`.

Repeated import-rule exceptions indicate a boundary problem and require an explicit architecture decision.
