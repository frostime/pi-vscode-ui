---
title: Architecture Overview
description: Cross-module process topology, ownership, trust, persistence, and dependency boundaries.
scope:
  - /apps/vscode/**
  - /packages/pi-rpc/**
updated: 2026-07-28
---

# Architecture Overview

```text
Svelte Webview × N
  ├─ one sidebar projection following activeSessionId
  ├─ zero or more editor-tab projections pinned to Session identity
  ├─ ordered conversation presentation and local disclosure/scroll state
  └─ no Node, VS Code API, or raw Pi events
          ⇅ independently versioned, schema-validated connections
Workspace Extension Host (local, SSH, WSL, or Dev Container)
  ├─ SessionWebviewCoordinator
  │    ├─ per-Webview synchronization and action authorization
  │    ├─ SessionPanelManager
  │    └─ transient per-Session ComposerDraftCache
  ├─ SessionRegistry
  │    └─ SessionRuntime × N
  │         ├─ SessionEntryState
  │         ├─ ConversationProjection
  │         ├─ SessionViewState
  │         └─ PiRpcApi
  ├─ proxy/process policy
  └─ workspace, editor, diff, and diagnostics integration
          ⇅ LF-delimited JSONL over stdio
     pi --mode rpc × N
```

## Product and process boundary

FrostPi is a self-contained Pi-only VS Code GUI adapter over Pi native RPC. It does not define a generic agent backend or target ACP compatibility. One `SessionRuntime` owns one Pi process; sessions execute independently, and FrostPi adds no global execution or file-write lock.

Local workspaces run Pi locally. Remote SSH, WSL, and Dev Containers run Pi in that workspace's Extension Host; there is no local-to-remote process bridge. Untrusted and virtual workspaces are unsupported because Pi may execute commands and modify files.

## State and data ownership

`SessionRegistry` owns the runtime collection, sidebar active selection, and metadata persistence. `SessionWebviewCoordinator` owns disposable sidebar/editor-tab projections and transient Composer draft handoff; editor-tab placement is not persisted. Within a runtime, `SessionEntryState` owns the persisted entry cursor/tree and active path, `ConversationProjection` owns persisted/live conversation identity and order, and `SessionViewState` owns session scalar state. Their detailed behavior belongs to adjacent SPECs.

Runtime flow is `Webview → shared contracts ← Extension Host → @frostime/pi-rpc → Pi`. The Host is authoritative for conversation order and turn membership; the Webview renders that order and owns only presentation state such as disclosure and scroll position. Raw Pi events and session entries never cross the bridge.

Pi owns conversation JSONL, provider credentials, model/session state, and file writes. VS Code workspace state stores FrostPi session metadata only. Composer text and pasted images are held transiently by the Extension Host while presentations hand off, but are not persisted and do not survive Extension Host restart; `/editor` uses a temporary Host-owned file, and Host-projected Fork/tree seeds remain runtime-only. FrostPi file mentions expose paths and line references without injecting file content.

## Dependency and trust boundaries

`packages/pi-rpc` owns subprocess, JSONL framing, and request mechanics without VS Code dependencies. `extension` owns VS Code integration and product policy; `shared` contains serializable contracts and pure helpers; `webview` contains browser/Svelte code without Node or `vscode` imports. Boundary exceptions require an explicit architecture decision.

The Webview is untrusted input: Host actions require complete schema validation and bounded payloads. Process environment and proxy changes apply only when a Pi process starts or restarts; FrostPi never silently interrupts a running turn to apply them.

Diagnostic exports omit prompt and response content and redact common credentials. Workspace paths and third-party stderr can still be sensitive and require review before sharing.
