---
title: Architecture Overview
description: Product entries, shared client, process topology, state authority, and trust boundaries.
scope:
  - /apps/**
  - /packages/pi-rpc/**
updated: 2026-10-20
---

# Architecture Overview

## Product and process boundary

FrostPi is a VS Code-first GUI over Pi's native RPC surface, with Desktop as an adapted second output. `apps/pi-client` owns the common application implementation, not a general-purpose SDK. Both products consume the same source; they do not share a background service or automatically synchronize their running Pi processes.

```text
VS Code product                         Desktop product
Svelte Webview                          Electron renderer
       │                                       │
VS Code message endpoint                finite isolated preload / IPC
       │                                       │
Workspace Extension Host                Electron main process
       └──── same client host/Runtime code ────┘
                         │
                  Pi RPC child × N
```

The finite [ClientHost](../../../apps/pi-client/src/host/clientHost.ts) concentrates the services actually consumed by the client. VS Code is the reference environment: `apps/vscode/src/extension/clientHost.ts` binds real workspace/configuration/native interaction/editor APIs; `apps/desktop` adapts those needs and adds Project navigation. No client runtime module imports `vscode` or Electron. An absent optional editor service fails explicitly; it is not a successful no-op or a requirement to emulate the whole SDK.

One `SessionRuntime` owns one child. Agent execution is independent; there is no global execution/file-write lock or file-write interception. Local, SSH, WSL and Dev Container plugin sessions still run in their workspace Extension Host, without a local-to-remote bridge. Desktop runs locally. Untrusted and virtual VS Code workspaces remain unsupported.

## Shared state and presentations

The shared `SessionRegistry` owns open Runtime identities, active Pi selection, metadata lifecycle, Fork recovery, startup/history queues and default VS Code session policy. Injected workspace/configuration/storage/interaction services supply the environment; they do not duplicate lifecycle algorithms. [Session lifecycle](../../../apps/vscode/src/extension/sessions/session-lifecycle.SPEC.md) remains the behavior reference.

Each Runtime owns its cwd. `SessionEntryState` owns persisted entry/tree identity, `ConversationProjection` owns persisted/live conversation order, and `SessionViewState` owns scalar state. Pi owns JSONL, provider credentials/model state and file writes. The Host sends projected conversation order and turn identity, never raw Pi events or entries.

One shared ClientApp and document-scoped UI store serve one presentation document. The VS Code sidebar follows the Registry selection; editor tabs are independently pinned projections. `SessionWebviewCoordinator` owns native panel placement and Composer handoff, not Runtime lifetime. Scroll/disclosure/form state is presentation-local. Revisioned drafts are transient, not conversation storage; see the [Bridge contract](../../../apps/pi-client/src/shared/bridge/webview-bridge.SPEC.md).

Desktop Project selection is a new/resume anchor, not a mutation of existing Runtime context. All registered Project roots remain available when the foreground changes. The outer Project navigation and shared Header consume the same open-Pi collection. Filtering/navigation must never be interpreted as session deletion and release another Pi's drafts or pending input.

## Configuration, theme, and compatibility

Shared setting parsing uses VS Code keys/defaults and scope terminology. The plugin reads real VS Code configuration; Desktop provides a separate source and explicitly rejects unsupported environment-specific values such as proxy mode `vscode`. No automatic read/write/synchronization of real VS Code settings is implied. Configuration and credential changes affect Pi only on explicit start/restart, never by silently interrupting a turn.

Shared styles preserve `--vscode-*`, existing `--frost-*` mappings, component classes and Codicons. VS Code supplies its real Webview theme environment; Desktop supplies corresponding variables/resources. VS Code Workbench internal DOM/SCSS and complete theme-extension/grammar execution are not compatibility surfaces. [UI constraints](../design/ui-spec.md) remain applicable to the shared UI.

`core/configuration/runtimeCompatibility.ts` owns Pi/OMP defaults, settings projection rules and product capabilities; dialects in `packages/pi-rpc` own isomorphic runtime vocabulary. Host capability adaptation is separate from Pi/OMP compatibility. See [OMP maintenance](omp-compatibility.md) before extending it.

## Dependency and trust boundaries

- `packages/pi-rpc`: child processes, framing, request mechanics and runtime dialects. No product host dependency.
- `apps/pi-client/src/core`: single-session execution/projection and Pi/OMP policy; `src/host`: shared application/bridge behavior and concentrated injected host interface. Neither imports a product entry, renderer, VS Code or Electron.
- `src/shared`: serializable contracts, bounded validation and pure helpers; no Node/core/host runtime dependency.
- `src/ui`: browser/Svelte implementation; no Node, backend or host API imports. Product browser entries explicitly install a transport before mounting and sending ready.
- Product entries own process placement, native capability implementations and packaging. Desktop renderer receives only the finite preload API, never Node or raw IPC. Main verifies sender/frame identity before actions; common messages still pass version/schema/session-target validation.

Messages carry bounded correlated inputs. File and Markdown-image operations resolve against the originating displayed session, not the selected Project; filesystem reads and returned image bytes remain Host-mediated and transient. Proxy/configuration URLs and child stderr must not leak credentials. Diagnostic exports omit prompt/response/image content and redact common credentials.

The read-only Provider Usage engine remains in `packages/provider-usage`: it reads Pi provider configuration and queries official APIs, while Pi retains token refresh/credential writes. Only safe reports cross the common bridge. Its browser cache is provider-scoped, not tied to the selected Project/Pi; detailed cancellation and authorization rules remain in the Bridge SPEC.
