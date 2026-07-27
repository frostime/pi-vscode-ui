---
title: Webview Bridge Compatibility Contract
description: Stable synchronization, validation, and recovery semantics between the Extension Host and Svelte Webview.
scope:
  - /apps/vscode/src/shared/bridge/**
  - /apps/vscode/src/extension/webview-host/**
  - /apps/vscode/src/webview/bridge/**
updated: 2026-07-27
---

# Webview Bridge Compatibility Contract

The Extension Host is authoritative. A newly mounted Webview sends `ready` and receives a complete `snapshot`, followed by `setChatTypography`. Active-session changes also force a full snapshot; ordinary updates use `workspaceDelta`. `setChatTypography` is resent only when `chat.fontFamily`, `chat.fontSize`, `chat.editor.fontFamily`, or `chat.editor.fontSize` changes. `chat.fontFamily` affects rendered Markdown messages; `chat.fontSize` affects rendered Markdown messages and code blocks. `chat.editor.fontFamily` affects the Composer and code blocks; `chat.editor.fontSize` affects the Composer.

`conversationItems` is the single Host-ordered conversation collection. A visual turn may contain its own ordered items; the Webview must not merge independent collections or sort by timestamp. `upsert` is valid only while existing top-level order is an unchanged prefix; removal/reordering requires `replace`. Projection code replaces changed objects instead of mutating them so the bridge can avoid repeatedly copying large Markdown, output, and image payloads while preserving keyed Webview disclosure state.

Every Webview command is validated as a complete discriminated union. `openFile` carries a path plus an optional one-based line, column, or inclusive end line; relative paths resolve from the active Session working directory. Line ranges cannot include a column and must be ordered. Message Copy sends raw text to the Extension Host, which writes it through VS Code's clipboard API without logging or persisting it. Prompt acceptance is correlated by request id. File-suggestion and message-fork requests and responses are also correlated; stale or unknown responses have no effect. A successful fork changes the active logical session id; the original draft therefore stays under the original id. The host snapshot carries a non-persisted Composer seed for the fork, identified so each Webview mount applies it once. Cancel Fork is addressed to either the source id or the new fork id while replacement is active. `openComposerEditor` opens a host-owned temp markdown file for one session; closing that tab reads the file and sends `setComposerText` for the same session id so the Webview replaces draft text without touching attachments.

Session-tree Webview actions carry only the active FrostPi session id, a stable Pi entry or branch-point id (`null` for the virtual root), and whether the Composer currently has a draft. The Host refetches authoritative entries, owns all QuickPick/InputBox/confirmation interaction, and returns results through normal session projection updates. Complete entries, prompt text, images, private tokens, and summary content never cross this action boundary. Fork and Tree navigation share the non-persisted Composer seed contract; Tree seeds may replace a draft under the same session id only after Host confirmation. The `checkPiIntegration` action carries only a session id; Host performs a fresh `get_commands` source-provenance probe and reports availability through native VS Code messaging.

`BRIDGE_VERSION` is an opaque string compared for exact equality in both directions. Dotted values such as `"2.1"` are identifiers, not semantic versions: the bridge performs no ordering, range, or backward-compatibility inference. Required-field or delta-semantic changes assign a new value. Unknown values are rejected rather than guessed, and recovery is a fresh snapshot.
