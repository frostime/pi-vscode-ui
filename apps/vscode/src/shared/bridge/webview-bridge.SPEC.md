---
title: Webview Bridge Compatibility Contract
description: Host authority, per-presentation synchronization, validation, correlation, and recovery semantics.
scope:
  - /apps/vscode/src/shared/bridge/**
  - /apps/vscode/src/extension/webview-host/**
  - /apps/vscode/src/webview/bridge/**
updated: 2026-08-17
---

# Webview Bridge Compatibility Contract

The Extension Host is authoritative. One sidebar `WebviewConnection` follows `SessionRegistry.activeSessionId`; each Session Tab has an independent Connection pinned to one Session id. Presentation snapshots explicitly carry surface identity, the true sidebar `activeSessionId`, and the Session displayed by that Connection. A pinned Session is never represented by changing or reinterpreting `activeSessionId`.

A mounted Webview sends `ready` and receives a complete presentation snapshot plus the latest Host Composer draft. Sidebar selection changes snapshot the sidebar Connection. Same-target updates use deltas. Each Connection computes and caches deltas only for its displayed Session, advances that cache only after successful delivery, and owns one file-search cancellation scope. Hidden, failed, newly visible, or recreated projections recover through a fresh authoritative snapshot; browser persistence is not a recovery source.

On `ready` and supported VS Code Chat typography changes, the Host sends `setChatTypography`. Message font settings apply to rendered Markdown, message size also applies to code blocks, editor font family applies to the Composer and code blocks, and editor font size applies to the Composer.

`conversationItems` is one Host-ordered collection per displayed Session. `upsert` requires unchanged prefix order; removal or reordering requires `replace`. Writers replace changed objects rather than mutate them so keyed Webview disclosure state survives reconciliation. `conversationContentRevision` identifies projected conversation-content changes for presentation behavior; scalar Session updates such as stats and runtime status do not advance it.

## Authorization and validation

`BRIDGE_VERSION` is an opaque identifier compared for exact equality in both directions. Unknown versions are rejected; required-field or delta-semantic changes require a new value. Every Webview action is validated as a complete discriminated union with bounded payloads. Prompt, file-search, Fork, and other request/response flows use correlation ids; stale or unknown responses have no effect. Invalid, oversized, unknown, incompatible, or cross-Session messages perform no Host action.

The Host authorizes actions from immutable Connection context. Panel messages may target only the pinned Session, regardless of any client-supplied id. New, Resume, selection, rename, close/restart, externalization, configuration, diagnostics, and other Session-management actions are sidebar-only and are rejected from panels even if manually posted. `/resume` is Host-local and is rejected from a panel with sidebar guidance.

File actions carry validated locations only; relative paths resolve from the Session displayed by the originating Connection. Session-tree actions carry stable ids and draft presence only: the Host refetches authoritative entries and owns native interaction. Complete entries, prompt/image content, private tokens, and summary content do not cross that action boundary. Host-projected Fork/tree Composer seeds are non-persisted and applied once per Webview mount until submission.

## Composer synchronization

The Host keeps one transient revisioned Composer draft per Session, containing only text and image attachments. Webviews send each mutation immediately with a monotonically increasing revision; text edits carry attachment ids and only newly added attachments carry image bytes, while the Host ignores stale replacements. A snapshot or `draftReplacement` replaces local state without echo. Synchronization never relies on a debounce or disposal-time flush.

Submission carries the submitted revision. The Host snapshots it, clears the authoritative draft, and retains a failure snapshot. Success discards that snapshot; failure restores it only when no newer draft exists. Tab closure preserves the current cache; Session removal and Extension Host disposal release it. Drafts are not workspace/session persistence and do not survive Extension Host restart. Scroll, disclosure, Composer expansion, and partially entered Question/extension-form answers remain presentation-local.
