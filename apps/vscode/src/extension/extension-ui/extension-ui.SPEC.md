---
title: Pi Extension UI Contract
description: Supported structured UI methods, timeout behavior, session ownership, and unsupported custom UI.
scope:
  - /apps/vscode/src/extension/extension-ui/**
  - /apps/vscode/src/extension/question-tool/**
  - /apps/vscode/src/shared/question-tool/**
  - /apps/vscode/src/webview/features/extension-ui/**
  - /apps/vscode/src/webview/features/question-tool/**
updated: 2026-07-25
---

# Pi Extension UI Contract

## Blocking methods

`select`, `confirm`, `input`, and `editor` create a pending card owned by the emitting session. A user action produces exactly one `extension_ui_response`. Cards cannot migrate between sessions and cannot be answered after removal.

When Pi supplies a timeout, Pi owns the default resolution. FrostPi removes the card at expiry and sends no late cancellation or value. Stopping/closing a session is different: FrostPi explicitly sends `{ cancelled: true }` for each still-pending request before terminating the process.

FrostPi never auto-confirms a request. Multiple blocking requests may be pending in one session; the coordinator retains each by RPC request id and sends at most one response for each.

## Private Question specialization

When `frostpi.questionTool.enabled` is applied at Pi process start, FrostPi injects its bundled `question` extension. The extension publishes a bounded JSON request in a per-runtime temporary directory, then calls `ctx.ui.input()` with a versioned marker containing a random per-runtime token and request id. The Extension Host handles an input as a Question request only after the marker, token, request-file identity, size, and schema all validate. Other `input` requests retain the standard card behavior.

Question requests enter the same `ExtensionUiCoordinator` pending lifecycle as standard blocking methods. The Webview submits structured answers to the Host; the Host validates exactly one answer per question and serializes the result into the standard `extension_ui_response` value. Cancel, abort, stop, and close use the same cancellation path. No second pending-response owner, response file, watcher, or polling mechanism exists.

A Webview remount restores Host-owned pending requests but not unsubmitted drafts. A Pi process restart cancels pending requests and creates a new token and temporary directory. Configuration changes never interrupt a running process; session state exposes when restart is required.

## Fire-and-forget methods

- `notify` appends a sanitized notice, including its severity, to the emitting session's conversation timeline. During an active turn it appears where first observed among turn activities; while idle it remains a session-level timeline item. Notices remain in the live projection but are not persisted across session rehydration or process restart.
- `setStatus` upserts/deletes keyed status text.
- `setWidget` upserts/deletes keyed line widgets above or below the composer.
- `setTitle` changes the owning session title.
- `set_editor_text` updates the active session composer; for an inactive session, the host retains the latest text until that session becomes active.

## Unsupported UI

Arbitrary custom TUI components, custom headers/footers/editors, raw terminal input listeners, and theme APIs are not emulated. Unknown structured methods are ignored rather than rendered from arbitrary JSON. This boundary prevents FrostPi from becoming a terminal UI runtime or executing extension-provided presentation code in the Webview.
