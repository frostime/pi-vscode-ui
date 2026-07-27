---
title: Host–Webview Synchronization
description: Versioning, validation, turn deltas, and recovery for the Webview bridge.
scope:
  - /apps/vscode/src/shared/bridge/**
  - /apps/vscode/src/extension/webview-host/**
  - /apps/vscode/src/webview/bridge/**
updated: 2026-07-27
---

# Host–Webview Synchronization

The Host sends a complete snapshot after `ready` and whenever the active session changes. Stable-session updates replace scalar fields and transport one ordered `conversationItems` collection through a collection delta. A visual turn contains its own ordered items, so boundaries and branch controls may occur between agent activities without a second ordering channel. The Webview renders Host order directly and never sorts transcript items by timestamp.

On `ready` and when one of the supported VS Code Chat typography settings changes, the Host sends `setChatTypography`; the Webview applies the Chat message font size to rendered Markdown messages and code blocks, the Chat message font family to rendered Markdown messages, the Chat editor font family to the Composer and code blocks, and the Chat editor font size to the Composer.

Top-level `upsert` requires unchanged prefix order and carries appended or reference-changed objects. `replace` carries the full collection after removal/reordering. Projection writers must replace changed objects, not mutate them; keyed turn components then retain Webview-owned disclosure state across persisted identity reconciliation.

Webview commands are Zod-validated and versioned. Message Copy sends raw text to the Extension Host for VS Code clipboard access; the text is neither persisted nor logged. Prompt, file-search, and message-fork replies are request-correlated. Session selection changes presentation only; process ownership remains in `SessionRegistry`. Explicit large-history loading is a host command addressed to one session. Invalid, oversized, stale, unknown, or incompatible messages perform no host action. Recovery after Webview reload is always a fresh snapshot; browser persistence is not authoritative. Session-bar visibility and ordinary Composer drafts are local presentation state and reset on Webview reload. A temporary host-projected Fork Composer seed is included in the fresh snapshot and applied once per Webview mount until the first successful Composer submission.
