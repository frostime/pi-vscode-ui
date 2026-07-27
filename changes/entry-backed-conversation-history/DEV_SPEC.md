---
title: Entry-backed conversation history
created: 2026-07-27
status: clarified
---

# Problem Statement

FrostPi reconstructs Webview history from Pi RPC `get_messages`, then separates the result into turns, notices, compactions, branch summaries, and custom messages. The Webview merges those collections by timestamp. Session-tree controls are projected separately from `get_entries`.

This loses information that the UI needs:

- `get_messages` is Pi's compaction-aware LLM context, not the complete persisted transcript. Rehydration can therefore hide pre-compaction history that remains present in the session file.
- Splitting an ordered message sequence into independent collections and sorting by timestamp can reorder imported or reconstructed entries. Entry timestamps describe creation time; they do not define active-path order.
- Message identity and tree relationships are discarded and later approximated through timestamps, `fromId`, and parallel associations.
- A true `branch_summary` can be dropped or moved when it cannot be associated with a FrostPi branch control.
- Displayable extension messages are incomplete: generic custom-message text may be projected, but images are dropped and incrementally appended custom messages may not appear.

The target is a complete, correctly ordered FrostPi conversation for the current Pi session path, with live updates and FrostPi branch controls, implemented through one authoritative Host-side projection.

# Approach

Use Pi session entries as the persisted conversation authority:

```text
get_entries + leafId
  -> complete root-to-leaf active path
  -> Host conversation projection
  -> one ordered Webview conversation model
```

`get_messages` retains its Pi-defined meaning as current LLM context and does not supply FrostPi conversation history.

The Host keeps two distinct responsibilities:

1. Session-entry state owns the append cursor, current leaf, a content-free index of the complete tree, active-path selection, and incremental-continuation checks.
2. Conversation projection owns visible-entry filtering, turn/activity grouping, tool-result correlation, branch-control placement, live RPC updates, and reconciliation between temporary live state and persisted entries.

These responsibilities may use pure helper functions, but there must be one owner of final conversation order. The Webview receives ordered presentation data and must not reconstruct order from timestamps or independent collections.

FrostPi intentionally differs from Pi TUI after compaction: Pi TUI rebuilds from `buildContextEntries()` and hides summarized history, while FrostPi displays the complete active path and treats compaction as an annotation. For displayable custom messages and branch-summary ordering, FrostPi follows Pi's entry semantics and default-visible behavior.

# Behavior Contract

## Persisted history

- The displayed persisted transcript is the complete root-to-`leafId` path selected through `parentId` links.
- Entries on abandoned branches are excluded from conversation content. They remain available to session-tree navigation and branch counts.
- Parent-chain order is authoritative. Append order is used only for the `get_entries(since)` cursor. Timestamps are display metadata only.
- A non-null `leafId` that cannot produce a valid parent chain is a history-load failure; FrostPi must not silently render append order or an unrelated branch.
- Unknown and bookkeeping entry types may be omitted without changing the relative order of visible entries.

## Compaction

- A `compaction` entry renders as a collapsed conversation boundary at its active-path position.
- Every earlier active-path entry remains available and scrollable after compaction, process restart, Resume, Webview reload, and tree navigation.
- `retainedTail`, `firstKeptEntryId`, token cut points, and other LLM-context reconstruction fields are ignored when selecting transcript content.
- Values nested inside `retainedTail` are LLM-context metadata, not session entries. Only top-level entries on the active path are rendered, so nested retained-tail messages are never expanded into duplicate UI content.
- A successful live compaction appears promptly and later reconciles to the persisted compaction entry without duplication or removal of prior turns.

## Branches and branch summaries

- A FrostPi `<N branches>` control represents a tree edge where the parent has multiple reachable paths.
- The control is placed between the active-path parent entry and active child entry. A virtual-root branch control appears before the active root entry.
- A true `branch_summary` remains an independent visible boundary at its active-path position. It is never identified by text, `customType`, timestamp, or `details.sourceRole`.
- For the normal user-message branch flow, Pi's active path contains `branch_summary -> user message`; FrostPi inserts the branch control on the entering tree edge, producing `branch control -> branch_summary -> user message` without moving the summary.
- Pi may contain a branch created from an assistant, tool, or other non-user entry. The control remains at that tree edge, including when the edge occurs within a visual turn. Navigation itself does not generate a new assistant message; ordinary continuation waits for a new user message.
- Multiple summaries, root summaries, and summaries without an adjacent branch control all remain visible. No map or association may overwrite one summary with another.

## Extension messages

- Every active-path `custom_message` with `display: true` is visible using FrostPi's generic custom-message presentation.
- Generic custom-message content supports text and image blocks in protocol order.
- `display: false` custom messages are omitted.
- A `custom_message` remains a custom message even when its text or `details` describes a compaction or branch summary. The `session-prune` messages are the reference case.
- Plain `custom` entries are extension state and are omitted. Pi can display one only through a registered TUI-specific entry renderer whose terminal component is not available over RPC.
- Plugin-specific TUI renderers and an RPC-safe plugin rendering protocol are outside this change. Generic content remains visible even when FrostPi cannot reproduce plugin-specific terminal styling.

## Turns, tools, and live state

- A user prompt and its subsequent assistant/tool activity retain FrostPi's visual-turn behavior.
- The ordered presentation model must be able to place conversation boundaries and branch controls at their path positions without assigning order in the Webview.
- Tool results continue to update the tool call identified by `toolCallId`; they do not create duplicate tool activities.
- Optimistic user prompts, streaming assistant content, running tools, queued follow-ups, and non-persisted notices remain responsive before entries are fetched.
- Persisted entries become authoritative at a settlement boundary. Reconciliation must not duplicate, reorder, or visibly flicker the completed content.
- Stable keys and object replacement preserve Webview-owned disclosure state across streaming updates and durable reconciliation.
- A live turn becomes eligible for persisted user-entry identity only after FrostPi observes Pi's user message event for that turn. On a verified incremental continuation, eligible live turns and newly appended user-message entries are paired in protocol FIFO order after the previous leaf. Text and timestamp equality are never identity rules.
- Rejected prompts and immediate extension-command turns that emit no Pi user message event remain ineligible and must never acquire a later entry id.

## Reconciliation boundaries

FrostPi refreshes session entries after operations that may persist conversation content without a normal message event sequence, including:

- `agent_settled`;
- successful compaction;
- an immediate Pi extension command reaching idle;
- committed tree navigation;
- committed fork reconciliation.

For an incremental response:

- If the reported leaf extends the prior active leaf through entries present in the batch, append/reconcile those entries.
- If the leaf moved to another branch, the cursor is invalid, or the connecting chain is incomplete, request complete entries and rebuild the active path.
- Newly appended displayable custom messages and boundaries must appear even when no user entry needs identity attachment.

## History loading and size

- Existing deferred-history behavior remains: a large resumed session can become ready before conversation history is loaded, and explicit loading remains available.
- Deferred startup must not fetch and retain full message content merely to prepare branch controls. Tree actions remain unavailable until history is loaded.
- Once history is explicitly loaded, completeness is preferred over compaction-aware truncation. Future pagination or virtualization is a separate performance change.

## Failure and privacy

- A history projection failure does not fail the live Pi process. It sets the retryable history failure state and exposes a bounded user-visible error.
- FrostPi must not log entry message bodies, tool output, image bytes, credentials, or unredacted proxy URLs.
- Existing image validation and tool-output bounds remain enforced at the Host projection boundary.

# Implementation Decisions

- Replace `get_messages`-based history hydration with entry-backed hydration in initial load, tree navigation, and fork reconciliation.
- Replace the independent `turns`, `notices`, `compactions`, `branchSummaries`, `customMessages`, and branch-control placement mechanism with one ordered conversation contract. Locally queued follow-ups remain separate because they are not durable timeline items.
- The ordered contract may contain ordered parts within a visual turn when required for a mid-turn branch edge. The final TypeScript nesting is an implementation detail; it must preserve the behavior contract without timestamp sorting.
- Entry-backed boundaries use their Pi entry ids; branch controls use a stable parent/active-child edge identity; tool activities use `toolCallId`. A freshly hydrated user-started turn derives identity from its user entry. When a live turn is paired with that entry, it retains its existing view identity and receives the entry id as source identity so reconciliation does not remount its Webview disclosure state.
- Keep a content-free complete-tree index for branch navigation. Do not retain full content for abandoned branches after active-path projection.
- Centralize active-path construction and incremental leaf-continuation validation; remove duplicate parent walking from user-entry correlation and session-tree code.
- Historical user messages receive their `sourceEntryId` directly from their owning `message` entry. Timestamp queues are limited, if still required, to temporary live-to-persisted reconciliation and are not a history source.
- Remove branch-summary attachment from branch-control projection. Controls and summaries are ordered independently from tree edges and active-path entries.
- The Host-to-Webview bridge transports the ordered conversation as one collection delta. Reordering or rebuilding produces `replace`; unchanged-prefix updates use `upsert`.
- Raw `RpcSessionEntry` values and raw Pi events do not cross into Svelte components.
- Durable contract updates accompany implementation in the conversation projection SPEC, session lifecycle SPEC, Webview bridge SPEC, and UI design specification.

# Acceptance Criteria

1. Rehydrating an active path containing compaction preserves all pre-compaction user, assistant, and tool history and renders one compaction boundary at the entry position.
2. Abandoned-branch content never appears in the selected conversation.
3. The three `session-prune` custom messages at 1-based active-path entry positions 5, 112, and 229 remain in those relative positions despite their later reconstruction timestamps.
4. A `custom_message` whose details contain `sourceRole: "branchSummary"` remains a generic custom message.
5. `display: true` custom text and images render; `display: false` messages and plain `custom` state entries do not.
6. A normal user-message branch renders branch control, optional true branch summary, then the new user message in tree order.
7. Root branches, non-user branch targets, multiple summaries, and mid-turn branch edges remain navigable and preserve visible-entry order.
8. Incremental custom messages, compactions, and branch summaries appear after their persistence boundary without requiring a full process restart.
9. Normal settle reconciliation produces no duplicate user, assistant, tool, compaction, summary, or custom item.
10. Fork and Branch here use the exact persisted user entry ID, including for duplicate prompt text and equal timestamps.
11. Streaming and settle updates do not reset manually controlled disclosure state.
12. A missing/cyclic active parent chain fails history loading visibly rather than displaying an invented order.
13. Focused projection, runtime reconciliation, session-tree, bridge-delta, and Webview rendering tests pass.
14. `pnpm --dir apps/vscode exec vitest run` and `pnpm check` pass.
15. Manual verification with the reference session below confirms complete history, correct custom-message positions, and no mixed summary/custom semantics.

# Reference Session

Use this existing Pi session for manual ordering verification:

```text
Name: Pruned: 26-07-24T00:37_讨论插件重启同步问题
ID: 019fa2ca-6964-7146-b1cb-dde0440eba06
File: C:/Users/EEG/.pi/agent/sessions/--H--SrcCode-SiYuanDevelopment-sy-f-misc--/2026-07-27T08-56-42-084Z_019fa2ca-6964-7146-b1cb-dde0440eba06.jsonl
```

Inspect it with:

```bash
python /c/Users/EEG/.pi/agent/analyze_session.py \
  '/c/Users/EEG/.pi/agent/sessions/--H--SrcCode-SiYuanDevelopment-sy-f-misc--/2026-07-27T08-56-42-084Z_019fa2ca-6964-7146-b1cb-dde0440eba06.jsonl' \
  --filter no-tools --show-id --stats --max-width 220
```

The active path has 232 entries, no branch point, no true `branch_summary`, and three `session-prune` custom messages at 1-based active-path entry positions 5, 112, and 229. Their physical JSONL line numbers are 6, 113, and 230 because line 1 is the session header. Text resembling "Previous Branch Summary" is still a custom message.

# Glossary

- **active path**: The ordered root-to-`leafId` chain obtained by following Pi entry `parentId` relationships and reversing the result.
- **append order**: The order entries were written to the append-only session file. It includes all branches and is not conversation display order.
- **branch control**: FrostPi's `<N branches>` UI control for selecting a path at a represented Pi tree branch.
- **branch edge**: The parent-to-child relationship by which the active path enters one branch. A branch control is displayed at this relationship.
- **branch summary**: A Pi entry with `type: "branch_summary"`; an independent context boundary created during summarized tree navigation.
- **compaction**: A Pi entry summarizing context for the LLM. In FrostPi it is a visible annotation and does not delete or hide active-path transcript history.
- **conversation projection**: Host-owned conversion from Pi entries and live RPC events into FrostPi's serializable, ordered presentation model.
- **custom message**: A Pi entry with `type: "custom_message"`, message content, and a `display` flag. This is distinct from a plain `custom` entry.
- **entry**: A persisted Pi session-tree record with a stable `id`, `parentId`, and `type`.
- **leafId**: Pi's current selected entry ID; `null` for an empty session.
- **LLM context**: The compaction-aware message sequence Pi currently sends to a model. It is not FrostPi's complete transcript.
- **plain custom entry**: A Pi entry with `type: "custom"` used for extension state. It has no generic message display contract.
- **settlement boundary**: A lifecycle point after which FrostPi queries persisted entries and reconciles temporary live UI with authoritative session state.
- **visual turn**: FrostPi's presentation grouping of one user prompt and subsequent assistant/tool activity.
