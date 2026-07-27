---
title: Conversation Projection
description: Persisted-entry authority, live reconciliation, ordering, and identity rules for FrostPi conversations.
scope:
  - /apps/vscode/src/extension/conversation/**
  - /apps/vscode/src/extension/sessions/SessionEntryState.ts
  - /apps/vscode/src/shared/model/conversationModel.ts
updated: 2026-07-27
---

# Conversation Projection

## Authority and order

Pi `get_entries` plus `leafId` is the persisted conversation authority. FrostPi follows `parentId` from the leaf to the root, reverses that chain, and projects the complete active path. Abandoned branches remain only in the content-free tree index. `get_messages` is LLM context and must not hydrate the Webview transcript.

Parent-chain order is presentation order. Append order is only an incremental cursor; timestamps are display metadata. A missing or cyclic selected parent chain fails history loading instead of falling back to append order.

The Host emits one ordered `conversationItems` collection. A visual turn has its own ordered `items`, allowing a branch edge or persisted boundary to occur between agent activities. The Webview renders this order directly and owns only disclosure and scrolling.

## Persisted entries

- A user `message` opens a visual turn and supplies its stable `sourceEntryId`.
- Assistant content becomes reasoning, response, and tool activities in protocol order.
- A tool result updates the activity identified by `toolCallId`; it is not a second visible activity.
- `compaction`, `branch_summary`, and `custom_message` are independent items at their active-path positions.
- Compaction never removes or hides earlier active-path items. Nested `retainedTail` values are LLM-context metadata and are not expanded into transcript items.
- Every `custom_message` with `display: true` renders generic text and image blocks. `display: false` messages and plain `custom` state entries are omitted.
- Persisted image content is validated against the same MIME, Base64, count, and size limits as prompt images before it enters the shared ViewModel.

A branch control represents an active parent-child tree edge. Its identity is derived from that edge, and its position is immediately before the active child entry. A true branch summary is never attached to, moved with, or inferred from a control.

## Live reconciliation

Optimistic prompts, streaming assistant content, tools, queued follow-ups, and notices appear before persistence refresh. A live turn becomes eligible for persisted user identity only after Pi emits its user message event. Eligible live turns pair with newly appended user entries in protocol FIFO order; text and timestamp equality are never identity rules. Rejected prompts and immediate extension commands without a Pi user event remain ineligible.

Reconciliation preserves the live turn's view identity, attaches the entry id as source identity, and updates assistant/tool activities through stable protocol identities. A live compaction pairs with the next persisted compaction without duplication. Newly persisted custom messages and boundaries appear even when no user identity is attached.

Incremental entries are accepted only when the reported leaf connects to the previous active leaf through the returned batch. Branch movement, an incomplete connecting chain, or a newly discovered control whose edge belongs before the appended segment requires a complete reload.

## Turn lifecycle

While an agent run is active, queued follow-ups remain outside persisted conversation order. Pi may emit a follow-up user message without another `agent_start`; promotion follows protocol FIFO order and closes the prior visual turn. Abort, process stop, and process failure clear the local queue.

Live activity updates replace existing view objects instead of mutating them. This is required for bridge deltas and Webview-owned disclosure state. Notices emitted during an active turn remain inside its ordered items; idle notices are top-level conversation items.
