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
Svelte Webview
  ├─ ordered conversation presentation
  ├─ Composer and local disclosure/scroll state
  └─ no Node, VS Code API, or raw Pi events
          ⇅ versioned, schema-validated messages
Workspace Extension Host (local, SSH, WSL, or Dev Container)
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

`SessionRegistry` owns the runtime collection, active selection, and metadata persistence. Within a runtime, `SessionEntryState` owns the persisted entry cursor/tree and active path, `ConversationProjection` owns persisted/live conversation identity and order, and `SessionViewState` owns session scalar state. Their detailed behavior belongs to adjacent SPECs.

Runtime flow is `Webview → shared contracts ← Extension Host → @frostime/pi-rpc → Pi`. The Host is authoritative for conversation order and turn membership; the Webview renders that order and owns only presentation state such as disclosure and scroll position. Raw Pi events and session entries never cross the bridge.

Pi owns conversation JSONL, provider credentials, model/session state, and file writes. VS Code workspace state stores FrostPi session metadata only. Ordinary Composer drafts and pasted images are not persisted; `/editor` uses a temporary Host-owned file, and Host-projected Fork/tree seeds remain runtime-only. FrostPi file mentions expose paths and line references without injecting file content.

## Dependency and trust boundaries

`packages/pi-rpc` owns subprocess, JSONL framing, and request mechanics without VS Code dependencies. `extension` owns VS Code integration and product policy; `shared` contains serializable contracts and pure helpers; `webview` contains browser/Svelte code without Node or `vscode` imports. Boundary exceptions require an explicit architecture decision.

The Webview is untrusted input: Host actions require complete schema validation and bounded payloads. Process environment and proxy changes apply only when a Pi process starts or restarts; FrostPi never silently interrupts a running turn to apply them.

Diagnostic exports omit prompt and response content and redact common credentials. Workspace paths and third-party stderr can still be sensitive and require review before sharing.
