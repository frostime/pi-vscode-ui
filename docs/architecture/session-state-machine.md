---
title: Session State Machine
description: Session, turn, restart, and concurrent-session behavior.
scope:
  - /apps/vscode/src/extension/sessions/**
  - /apps/vscode/src/extension/conversation/**
updated: 2026-07-27
---

# Session State Machine

```text
stopped ─ request start ─> queued ─> starting ─ handshake ─> ready ─ agent_start ─> running
   ▲                                  │                     ▲                    │
   └──────── stop <──────────── stopping       failed <─────┴──── agent_settled ─┘
```

Prompt RPC success means accepted, not completed. A turn settles at `agent_settled`; message and tool events remain ordered activities inside that turn. Assistant protocol errors remain errors even when a later settled event closes the run. Tool failures stay visible but do not by themselves imply that the whole turn failed.

`abort` stops the current run but keeps the subprocess. Restart closes pending extension UI, stops the process, then starts `pi --mode rpc --session <recorded-file>`. Persisted history survives; active network streams, tools, and pending requests do not. A disruptive explicit restart requires confirmation.

One selected session supplies the Webview conversation. Other processes remain independent background sessions. Process starts and complete-entry history loads use separate serialized queues; agent execution is not serialized. Large histories require explicit loading and do not prevent Pi from reaching `ready`.

A new local session is temporary until its first accepted prompt or explicit rename. Replacing a selected temporary session closes it and excludes it from workspace persistence. A message fork follows the same temporary rule. Pi's successful Fork response is the commit boundary: the original local id remains with a stopped original runtime, while a new local id adopts the live fork runtime. Cancellation stops the child and restarts the original; post-commit reconciliation failure performs the same user-visible rollback. `/compact` does not commit a temporary session.

Tree navigation is a guarded mutation while the runtime remains `ready`: Host interaction selects a target and summary mode, the bundled private Pi extension commits the active leaf, and Runtime rebuilds the same session/process from complete entries. Pre-commit failure leaves the projection loaded. A confirmed commit followed by entry-load or projection failure moves only `historyStatus` to retryable `failed`; it does not change runtime identity or reverse Pi's leaf.

Proxy, executable, and process-environment changes take effect only on a new/restarted process. Multiple sessions are isolated processes but can race while modifying the same workspace; FrostPi does not serialize edits.
