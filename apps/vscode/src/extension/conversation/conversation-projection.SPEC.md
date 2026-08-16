---
title: Conversation Projection
description: Persisted-entry authority, live reconciliation, ordering, and identity rules for FrostPi conversations.
scope:
  - /apps/vscode/src/extension/conversation/**
  - /apps/vscode/src/extension/sessions/SessionEntryState.ts
  - /apps/vscode/src/shared/model/conversationModel.ts
updated: 2026-08-15
---

# Conversation Projection

## Authority and order

Pi `get_entries` plus `leafId` is the persisted conversation authority. FrostPi follows `parentId` from the leaf to the root, reverses that chain, and projects the complete active path. Abandoned branches remain only in the content-free tree index. `get_messages` is LLM context and must not hydrate the Webview transcript.

Parent-chain order is presentation order. Append order is only an incremental cursor; timestamps are display metadata. A missing or cyclic selected parent chain fails history loading instead of falling back to append order.

The Host emits one ordered `conversationItems` collection. A visual turn has its own ordered `items`, allowing a branch edge or persisted boundary to occur between agent activities. The projection owns the monotonic content revision consumed by presentation behavior; unrelated session state does not advance it. The Webview renders this order directly and owns only disclosure and scrolling.

## Persisted entries

- A user `message` opens a visual turn and supplies its stable `sourceEntryId`.
- Assistant content becomes reasoning, response, and tool activities in protocol order. The persisted assistant identity is the session entry ID; a Pi message ID or timestamp is only a live-to-persisted correlation clue and never merges two persisted entries.
- A tool result updates the activity identified by `toolCallId`; it is not a second visible activity. Assistant takeover relocates all reasoning, response, and embedded tool-call parts as one ownership unit, including the tool location.
- `compaction`, `branch_summary`, and `custom_message` are independent items at their active-path positions.
- Compaction never removes or hides earlier active-path items. Nested `retainedTail` values are LLM-context metadata and are not expanded into transcript items.
- Every `custom_message` with `display: true` renders generic text and image blocks. `display: false` messages and plain `custom` state entries are omitted.
- Persisted image content is validated against the same MIME, Base64, count, and size limits as prompt images before it enters the shared ViewModel.

A branch control represents an active parent-child tree edge. Its identity is derived from that edge, and its position is immediately before the active child entry. A true branch summary is never attached to, moved with, or inferred from a control.

## Live reconciliation

Optimistic prompts, streaming assistant content, tools, queued steering/follow-up prompts, and notices appear before persistence refresh. A live turn becomes eligible for persisted user identity only after Pi emits its user message event. Eligible live turns pair with newly appended user entries in protocol FIFO order; text and timestamp equality are never identity rules. Rejected prompts and immediate extension commands without a Pi user event remain ineligible.

Live assistant projection accepts both cumulative assistant messages and indexed delta-only updates. A complete assistant `event.message` wins for its event; its accompanying delta is not appended. Otherwise text, thinking, and tool arguments assemble independently by non-negative `contentIndex`. The first valid text or thinking end replaces temporary content and closes that part; later deltas and repeated ends for the part are ignored. Unknown, malformed, conflicting, or out-of-order deltas are ignored without a notice. `message_end.message` is the live final authority and can be projected without an observed start; persisted `get_entries` remains higher authority.

One adapter owned by `ConversationProjection` holds the active assembly state. Replacement `message_start`, a matching `message_end`, `agent_settled`, explicit turn completion, complete history replacement, process stop/failure, and restart clear that state. A delayed `message_end` whose identity conflicts with the current active stream is ignored and cannot close that stream. Clearing assembly never removes already displayed interrupted content.

Reconciliation preserves the live turn's view identity, attaches the entry id as source identity, and updates assistant/tool activities through stable protocol identities. Assistant activity identity derives from the adopted assistant view ID plus source content index in both live and persisted projection. A tool activity's outer ID is independent of Pi's real `toolCallId`, so preparing, bound, executed, and persisted forms update one Webview item. Persisted takeover owns the final physical location; a delayed live replay is ignored and cannot create an orphan turn or move an item back. Live and persisted compaction correlate only through `firstKeptEntryId`, never summary text. An incrementally appended compaction without that structural key requires full replacement, which discards provisional state and projects the persisted entry independently. Newly persisted custom messages and boundaries appear even when no user identity is attached.

Incremental ownership is preflighted before branch controls or conversation items are changed. If one live representation could be adopted by multiple persisted entries, reconciliation returns the existing reload result with the visible projection unchanged. Full replacement then projects every persisted entry independently by entry ID.

Incremental entries are accepted only when the reported leaf connects to the previous active leaf through the returned batch. Branch movement, an incomplete connecting chain, a correlation conflict, or a newly discovered control whose edge belongs before the appended segment requires a complete reload.

## Unresolved tool results

A tool is `running` only while FrostPi can still receive live execution updates. A persisted assistant `toolCall` records that an invocation exists; it does not prove that the invocation is still running or provide its final outcome.

An indexed `toolcall_start` creates a visible preparing activity with accumulated raw arguments but no fabricated Pi tool ID or name. `toolcall_end.toolCall` binds the real ID, name, and structured arguments at the same outer activity location; only then is the activity registered for `tool_execution_*` lookup.

Incremental assistant takeover therefore preserves the existing execution state and partial output for the same `toolCallId` while adopting persisted assistant ownership and placement. Only a matching persisted `toolResult` is authoritative for replacing that state with `complete` or `error`; delayed live tool events cannot replace content already owned by a persisted result.

A complete history replacement, `agent_settled`, process stop, or connection failure finalizes every still-running bound or preparing tool as `cancelled`. Here `cancelled` means live tracking ended before FrostPi received a final result. It preserves structured arguments or preparing raw arguments and any partial output, does not synthesize output, error, or end time, and does not alter the containing turn status. Incremental entry reconciliation alone is not a finalization boundary because the current Pi process may still be executing the tool.

## Turn lifecycle

A persisted user message closes the preceding visual turn and opens a user-anchored turn. Assistant `toolUse` keeps it active; an assistant error keeps an `error-awaiting-continuation` anchor so provider retry or context-overflow compaction continuation remains in that turn. A later success or abort closes it. A replacement, a new user entry, or the refresh after `agent_settled` finalizes an error that received no continuation.

Live `message_end(error)` displays the error activity but leaves the turn running until `agent_end` decides whether Pi will retry. `agent_end(willRetry: true)` keeps the running turn and `auto_retry_start` adds a notice; `willRetry: false` commits the pending error. This uses the existing turn statuses and does not persist retry notices.

While an agent run is active, queued steering and follow-up prompts remain outside persisted conversation order in separate local projections. Pi may emit queued user messages without another `agent_start`; steering is promoted FIFO before follow-ups, matching Pi's queue priority, and each promotion closes the prior visual turn. Abort, process stop, and process failure clear both local projections. Tool tracking at these lifecycle boundaries follows [Unresolved tool results](#unresolved-tool-results).

Live activity updates replace existing view objects instead of mutating them. This is required for bridge deltas and Webview-owned disclosure state. Documented assistant events provide an ID or timestamp correlation clue; a malformed live assistant without either is omitted until persisted refresh rather than emitted as an uncorrelatable duplicate. Within one valid assistant stream, timestamp and any ID present at start remain stable through end. Mid-stream identity changes are unsupported malformed input and recover only through authoritative history refresh; the Store does not maintain cross-clue aliases. Notices emitted during an active turn remain inside its ordered items; idle notices are top-level conversation items.

A completed turn has one turn-wide collapsible work trace before its final response. Failed assistant activities and notices on either side of a visible structural boundary belong to that trace; the boundary itself remains visible and is never counted or hidden as a work step.
