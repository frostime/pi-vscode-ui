---
title: Webview Bridge Compatibility Contract
description: Host authority, ordered synchronization, validation, correlation, and recovery semantics.
scope:
  - /apps/vscode/src/shared/bridge/**
  - /apps/vscode/src/extension/webview-host/**
  - /apps/vscode/src/webview/bridge/**
updated: 2026-07-28
---

# Webview Bridge Compatibility Contract

The Extension Host is authoritative. A mounted Webview sends `ready` and receives a complete snapshot; active-session changes also snapshot, while same-session updates use deltas. Reload recovery is always a fresh snapshot, never browser persistence.

On `ready` and supported VS Code Chat typography changes, the Host sends `setChatTypography`. Message font settings apply to rendered Markdown, message size also applies to code blocks, editor font family applies to the Composer and code blocks, and editor font size applies to the Composer.

`conversationItems` is one Host-ordered collection. `upsert` requires unchanged prefix order; removal or reordering requires `replace`. Writers replace changed objects rather than mutate them so keyed Webview disclosure state survives reconciliation.

`BRIDGE_VERSION` is an opaque identifier compared for exact equality in both directions. Unknown versions are rejected; required-field or delta-semantic changes require a new value. Every Webview action is validated as a complete discriminated union with bounded payloads. Prompt, file-search, Fork, and other request/response flows use correlation ids; stale or unknown responses have no effect. Invalid, oversized, unknown, or incompatible messages perform no Host action.

File actions carry validated locations only; relative paths resolve from the active Session cwd. Session-tree actions carry stable ids and draft presence only: the Host refetches authoritative entries and owns native interaction. Complete entries, prompt/image content, private tokens, and summary content do not cross that action boundary. Host-projected Fork/tree Composer seeds are non-persisted and applied once per Webview mount until submission.
