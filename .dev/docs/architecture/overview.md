---
title: Architecture Overview
description: How the two products share Pi application behavior, where state lives, and which boundaries adapters must preserve.
scope:
  - /apps/**
  - /packages/pi-rpc/**
  - /packages/provider-usage/**
updated: 2026-10-24
---

# Architecture Overview

## Pi GUI, shared application, separate products

FrostPi provides a GUI for Pi through its native RPC mode. Pi executes agent work, communicates with model providers and owns conversation files. FrostPi presents that work and provides session interaction; it does not replace Pi's execution engine.

The project has two parts: a VS Code extension as the primary product, and a Desktop App maintained alongside it. `apps/pi-client` contains their common UI, session behavior and message contracts. It is FrostPi application code, not a general-purpose host SDK. The products share source, not a background service or running session state.

```text
VS Code Webview                         Electron renderer
       |                                       |
VS Code message endpoint                finite preload bridge
       |                                       |
Workspace Extension Host                Electron main process
       +------- shared Registry / Runtime -----+
                         |
                    Pi children
```

The Windows Tauri migration candidate replaces the Desktop shell with a local WebView2 window plus one external Node backend, assembled by `apps/desktop/src/main/createDesktopBackend.ts`. Rust exposes finite application requests and translates only backend-authorized native operations; Registry, Runtime and Pi ownership remain unchanged. Electron remains the verified/default entry while native parity is evaluated.

Each product has its own Registry and Pi processes. VS Code sessions run in the workspace Extension Host, including SSH, WSL and Dev Containers; Desktop runs locally. There is no local-to-remote relay. Untrusted and virtual VS Code workspaces remain unsupported.

VS Code is the reference environment and vocabulary. Its adapter binds real services; Desktop translates the finite capabilities declared in `apps/pi-client/src/host/clientHost.ts`. Unsupported editor services are hidden or rejected, not successful no-ops. Desktop does not constrain plugin development to a lowest common denominator or emulate the whole VS Code SDK.

## Session authority and presentation

A `SessionRuntime` owns one Pi child and its recorded cwd. `SessionRegistry` owns the live collection, selection, metadata lifecycle and startup/history queues. Starts and history loads have separate queues; agent execution is concurrent. Switching presentation does not stop another Pi, change its configuration scope or take ownership of its files. The lifecycle contract is `apps/pi-client/src/host/session-lifecycle.SPEC.md`.

Within a Runtime, `SessionEntryState` retains entry/tree identity, `ConversationProjection` builds persisted/live conversation order, and `SessionViewState` holds scalar status. The Host sends projected models to the UI, not raw Pi events. These owners live under `apps/pi-client/src/core/`; the conversation projection SPEC governs their reconciliation.

One ClientApp/store/transport serves each browser document. VS Code's sidebar follows Registry selection; editor tabs are pinned projections. `SessionWebviewCoordinator` handles native panel placement and draft handoff, not Runtime lifetime. Scroll, disclosure and form state belong to the presentation. Revisioned Composer drafts are transient; their handoff and authorization rules are in `apps/pi-client/src/shared/bridge/webview-bridge.SPEC.md`.

Desktop adds Project ownership and navigation around the same client. A Project is both the browsing context and the New/Resume target. Its last Session or empty state is shown; an opened identity belongs to the initiating Project even when its cwd is a linked worktree. This grouping is Desktop metadata, not a second session lifecycle. The optional Header roster filters navigation only: the complete presentation still carries all live identities so grouping cannot accidentally release another Session's drafts or review state. Read `apps/desktop/SPEC.md` before changing this policy.

## Settings and compatibility have distinct owners

VS Code reads its real configuration; Desktop has independent settings and an explicit first-run import preview. Both use the existing setting keys and generated FrostPi definitions. They do not continuously synchronize settings. Environment-specific values such as proxy mode `vscode` require Desktop adaptation rather than a new meaning in shared parsing. Process invocation and proxy changes take effect on start/restart, not by interrupting a turn.

Shared UI retains VS Code theme variables, FrostPi's semantic mappings and Codicons. VS Code supplies the Webview environment; Desktop supplies corresponding variables and resources. This is not compatibility with Workbench internals or every theme extension. See `.dev/docs/design/ui-spec.md` for cross-feature rules.

Host adaptation is separate from Pi/OMP runtime compatibility. `apps/pi-client/src/core/configuration/runtimeCompatibility.ts` owns runtime defaults, setting projection and product capabilities; `packages/pi-rpc` owns protocol mechanics and dialects. Read `.dev/docs/architecture/omp-compatibility.md` before moving a runtime difference between those layers.

## Data ownership and lifetime

FrostPi has no telemetry endpoint or hosted account service. Pi/model-provider traffic and explicit Provider Usage queries are external data flows, not a claim that the GUI never uses the network.

| Data | Owner and location | Lifetime and boundary |
|---|---|---|
| Session index and selection | Shared SessionPersistence through VS Code workspace state or Desktop `state.json` | Metadata only; Provisional/Ephemeral exclusions remain in the lifecycle contract |
| Desktop Projects and navigation | Desktop `state.json` in the application profile | Includes ownership, last-viewed selection and sidebar layout, not conversation bodies or running-task snapshots |
| User settings | VS Code configuration or Desktop `settings.json` | Original keys; Desktop import is a preview until Save and is not ongoing sync |
| Conversation and runtime state | Pi process and its configured session files | Pi owns writes, migration and restoration; storage paths vary with runtime and session-directory settings |
| Composer text and images | Browser state and Host draft cache | In-memory interaction state, not a cross-restart draft store |
| File-mention candidates | Host-side search/cache | Path metadata; mentions do not inject file contents. Explicit file/image operations have separate validated Host paths |
| Credentials | Pi configuration/environment; VS Code proxy authentication separately uses SecretStorage | Provider Usage may read credentials in the Host to query official APIs, but does not refresh/write them or bridge them to UI. Desktop rejects credentials in persisted proxy URLs |
| Provider Usage reports | Browser cache keyed by provider | Safe reports only; no disk persistence. Cache/source lifetime is defined by the Provider Usage and bridge SPECs |
| Logs and diagnostics | Host logging; diagnostic export where the product supports it | No conversation/image payloads; redact common credentials and URL authentication. Paths and third-party stderr still require review before sharing |

These are storage boundaries, not another conversation database or credential manager. Product-specific persistence and error handling belong in the product SPECs; query/credential behavior belongs in `packages/provider-usage/SPEC.md`.

## Dependency and trust boundaries

- `packages/pi-rpc` owns child processes, JSONL framing, correlation and runtime dialects, with no product host dependency.
- Shared `core` and `host` modules must not import product entries, renderers, VS Code or Electron. Inject host services rather than duplicating shared algorithms in adapters.
- `src/shared` contains serializable contracts and pure helpers; `src/ui` contains browser code. Neither may import Node/backend runtime code.
- Product browser entries install transport before mounting and sending ready. Desktop exposes finite preload operations, not Node or raw IPC. Main validates the sender/frame; common messages also pass version/schema and session-target authorization.

File references, Markdown images and interaction responses resolve against their originating Session, not a later foreground Project. Filesystem reads and returned image bytes remain Host-mediated and transient. Changing navigation cannot grant filesystem authority or redirect a pending request to another Pi.
