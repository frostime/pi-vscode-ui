---
title: Architecture Overview
description: Cross-module process topology, ownership, trust, persistence, and dependency boundaries.
scope:
  - /apps/vscode/**
  - /packages/pi-rpc/**
updated: 2026-10-03
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
     Pi-compatible child --mode rpc × N
```

## Product and process boundary

FrostPi is a self-contained VS Code GUI adapter over Pi's native RPC surface. A small `runtimeCompatibility` policy selects executable and directory defaults, Pi-settings projection rules, and product capabilities; a selected RPC dialect handles runtime message differences. FrostPi is not a generic agent backend or ACP compatibility layer. One `SessionRuntime` owns one child process; sessions execute independently, and FrostPi adds no global execution or file-write lock.

Local workspaces run the child process locally. Remote SSH, WSL, and Dev Containers run it in that workspace's Extension Host; there is no local-to-remote process bridge. Untrusted and virtual workspaces are unsupported because the child may execute commands and modify files.

## Runtime compatibility boundary

`apps/vscode/src/extension/configuration/runtimeCompatibility.ts` owns profile defaults, Pi-settings projection rules, and product capability declarations. Runtime RPC vocabulary and startup negotiation belong to the selected dialect in `packages/pi-rpc`; non-isomorphic feature behavior belongs above it in explicit product compatibility modules. Session scanning, model selection, and child-runtime-specific configuration retain their existing owners. See [OMP compatibility maintenance](omp-compatibility.md) before extending OMP support; it defines translation criteria, current support boundaries, and the rollout and archival workflow.

## State and data ownership

`SessionRegistry` owns the runtime collection, sidebar active selection, and metadata persistence. `SessionWebviewCoordinator` owns disposable sidebar/editor-tab projections and transient Composer draft handoff; editor-tab placement is not persisted. Within a runtime, `SessionEntryState` owns the persisted entry cursor/tree and active path, `ConversationProjection` owns persisted/live conversation identity and order, and `SessionViewState` owns session scalar state. Their detailed behavior belongs to adjacent SPECs.

Runtime flow is `Webview → shared contracts ← Extension Host → @frostime/pi-rpc → Pi-compatible child`. The Host is authoritative for conversation order and turn membership; the Webview renders that order and owns only presentation state such as disclosure and scroll position. Raw child-runtime events and session entries never cross the bridge.

The selected child owns conversation JSONL, provider credentials, model/session state, and file writes. VS Code workspace state stores FrostPi session metadata only. Composer text and pasted images are held transiently by the Extension Host while presentations hand off, but are not persisted and do not survive Extension Host restart; `/editor` uses a temporary Host-owned file, and Host-projected Fork/tree seeds remain runtime-only. FrostPi file mentions expose paths and line references without injecting file content. Markdown local images are a separate, bounded presentation resource: the Host mediates filesystem reads for the displayed Session and returns bytes only to the requesting Webview Connection.

## Dependency and trust boundaries

`packages/pi-rpc` owns subprocess, JSONL framing, chunk reassembly, request mechanics, and runtime RPC dialects without VS Code dependencies. `extension` owns VS Code integration and product policy; `shared` contains serializable contracts and pure helpers; `webview` contains browser/Svelte code without Node or `vscode` imports. Boundary exceptions require an explicit architecture decision.

The Webview is untrusted input: Host actions require complete schema validation and bounded payloads. Process environment and proxy changes apply only when a Pi process starts or restarts; FrostPi never silently interrupts a running turn to apply them.

Diagnostic exports omit prompt and response content and redact common credentials. Workspace paths and third-party stderr can still be sensitive and require review before sharing.
