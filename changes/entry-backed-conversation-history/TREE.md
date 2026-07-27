# Entry-backed Conversation History: Landing Proposal

> This proposal is superseded by the working tree once skeleton Pass 0 lands. Delete it or mark it superseded at that point; do not maintain it as a design document.

Behavior and architectural intent are defined by `changes/entry-backed-conversation-history/DEV_SPEC.md`. This file fixes only repository landing points, ownership, and cross-module contracts.

## Extension Host

```text
apps/vscode/src/extension/
├─ sessions/
│  ├─ SessionEntryState.ts
│  │  create, ~140-190 lines
│  │  Own the get_entries cursor, current leaf, content-free complete-tree index,
│  │  active-path selection, and full-versus-incremental classification.
│  │
│  ├─ SessionViewState.ts
│  │  create by moving/reworking SessionProjection, ~180-240 lines
│  │  Own session-level ViewModel state: runtime/history status, model, configuration,
│  │  stats, extension UI, title, and composition with conversation state.
│  │
│  └─ SessionRuntime.ts
│     modify, +70-110/-120-170
│     Remain the sole RPC/lifecycle orchestrator; coordinate the three sibling state
│     owners and publish only after a complete state transition.
│
├─ conversation/
│  ├─ ConversationProjection.ts
│  │  create by replacing TurnProjection, ~600-700 lines
│  │  Own ordered conversation items, visual turns, tool/message identity, queued
│  │  follow-ups, live RPC events, persisted-entry reconciliation, and final order.
│  │
│  ├─ messageAssembler.ts
│  │  modify, +20-35/-45-70
│  │  Retain bounded content/tool conversion helpers; delete `hydrateConversation()`,
│  │  and provide deterministic entry-backed text/image block conversion shared by
│  │  user, assistant, and custom-message projection.
│  │
│  ├─ turn-projection.SPEC.md
│  │  modify, +25-40/-5-15
│  │  Replace message-hydration rules with the durable ordered conversation contract.
│  │
│  ├─ TurnProjection.ts
│  │  delete, 689 lines (logic selectively moves to ConversationProjection)
│  │
│  ├─ SessionProjection.ts
│  │  delete, 273 lines (session scalar rules selectively move to SessionViewState)
│  │
│  └─ userEntryReferences.ts
│     delete, 63 lines
│     Historical user entry identity and active-path traversal move to entry-backed owners;
│     any temporary live correlation remains private to ConversationProjection.
│
└─ session-tree/
   └─ sessionTreeProjection.ts
      modify, +30-45/-85-125
      Remain stateless: derive active branch edges, branch-end picker choices, and
      editable targets from a supplied tree index; remove summary association and
      user-message anchoring.
```

## Shared Contracts and Bridge

```text
apps/vscode/src/shared/
├─ model/
│  ├─ conversationModel.ts
│  │  modify, +120-170/-15-30
│  │  Become the complete serializable conversation contract: turn, ordered turn item,
│  │  activity, notice, compaction, branch summary, custom message, branch control,
│  │  message blocks, and queued follow-up.
│  │
│  ├─ agentTurnModel.ts
│  │  delete, 51 lines
│  │  Merge its types into the single conversation contract to avoid circular or split
│  │  ownership of the ordered item union.
│  │
│  └─ sessionViewModel.ts
│     modify, +5-15/-25-40
│     Replace parallel conversation collections and branchControls with one ordered
│     conversationItems collection; retain queuedFollowUps as non-durable tail state.
│
└─ bridge/
   ├─ hostToWebview.ts
   │  modify, +10-20/-10-20
   │  Replace turn/notice deltas with one conversationItems collection delta.
   │
   └─ webview-bridge.SPEC.md
      modify, +8-15/-3-8
      Specify Host-authoritative order and replace/upsert behavior for conversationItems.

apps/vscode/src/extension/webview-host/
└─ WebviewBridge.ts
   modify, +20-35/-30-50
   Cache and diff one ordered conversation collection; derive workspace-file boosts
   by inspecting turn/tool items without reconstructing a timeline.

apps/vscode/src/webview/bridge/
└─ applyHostMessage.ts
   modify, +5-15/-8-18
   Merge the single conversationItems delta into the active session view.
```

## Webview Conversation

```text
apps/vscode/src/webview/features/conversation/
├─ ConversationView.svelte
│  modify, +25-45/-40-65
│  Render Host-ordered top-level items directly; remove timestamp merge/sort.
│
├─ AgentTurn.svelte
│  modify, +45-70/-15-30
│  Render a turn's ordered items, including fixed branch controls and boundaries,
│  while applying trace disclosure only to collapsible agent activities.
│
├─ collapseTurnTrace.ts
│  modify, +45-70/-15-30
│  Produce an order-preserving render plan that collapses activity ranges without
│  hiding or moving controls, summaries, compactions, custom messages, or notices.
│
├─ UserMessage.svelte
│  modify, +0-5/-15-25
│  Render only the user message and its actions; remove branch-control and summary lookup.
│
├─ CustomBlock.svelte
│  modify, +15-30/-5-10
│  Render generic custom-message text and image blocks in protocol order.
│
├─ BranchPointControl.svelte
│  modify, +1-5/-1-5
│  Consume the control from the ordered conversation contract; interaction remains unchanged.
│
├─ ThinkingActivity.svelte
├─ ToolActivity.svelte
├─ ResponseActivity.svelte
└─ SessionNotice.svelte
   modify, import/type-only mechanical changes
   Consume activity and notice types from conversationModel.
```

Existing `CompactionBlock.svelte`, `BranchSummaryBlock.svelte`, image, Markdown, copy, fork, and tree clients keep their current responsibilities. They change only if required by the consolidated type contract.

## Tests

```text
apps/vscode/test/unit/
├─ SessionEntryState.test.ts
│  create, ~120-180 lines
│  Characterize full indexing, active path, append continuation, branch movement,
│  missing cursor, malformed parent chain, and content-free retained tree state.
│
├─ ConversationProjection.test.ts
│  create by replacing TurnProjection.test, ~350-500 lines
│  Characterize complete entry hydration, ordering, turn grouping, custom content,
│  branch-edge placement, live updates, and durable reconciliation.
│
├─ SessionViewState.test.ts
│  create by replacing SessionProjection.test, ~100-150 lines
│  Characterize scalar session state and composition with a conversation snapshot.
│
├─ TurnProjection.test.ts
├─ SessionProjection.test.ts
├─ userEntryReferences.test.ts
│  delete after their behavior is transferred to the tests above.
│
├─ sessionTreeProjection.test.ts
│  modify, +60-100/-35-60
│  Replace anchor/summary tests with active-edge and branch-choice tests.
│
├─ SessionRuntime.test.ts
│  modify, +180-280/-80-140
│  Verify get_entries-only history, settlement boundaries, incremental custom entries,
│  compaction completeness, tree navigation, and full-reload fallback.
│
├─ collapseTurnTrace.test.ts
│  modify, +70-110/-15-30
│  Verify fixed ordered items survive collapsed trace planning.
│
└─ collectionDelta.test.ts
   modify, +15-30/-0-10
   Verify ordered conversation append, item replacement, and reorder replacement.
```

Registry tests and bridge schema tests receive focused fixture/field updates where the shared contract changes; they do not gain duplicate projection behavior tests.

## Durable Documentation

```text
docs/
├─ architecture/overview.md
│  modify, +5-10/-3-8
│  Describe the three sibling state owners and entry-backed conversation boundary.
│
├─ architecture/session-state-machine.md
│  modify, +8-15/-3-8
│  Add persisted-entry reconciliation boundaries.
│
├─ protocol/pi-rpc-compatibility.md
│  modify, +5-10/-3-8
│  Record get_entries as transcript authority and get_messages as LLM context only.
│
├─ protocol/webview-bridge.md
│  modify, +5-10/-3-8
│  Record the single ordered conversation delta.
│
├─ design/ui-spec.md
│  modify, +10-18/-3-8
│  Specify complete compaction history, active-path order, branch-edge controls,
│  and default-visible custom messages.
│
└─ feature-map.md
   modify, +8-15/-5-10
   Replace obsolete projection/index file roles with the new ownership map.

apps/vscode/src/extension/sessions/session-lifecycle.SPEC.md
  modify, +15-25/-5-10
  Specify history loading, deferred large sessions, and settlement reconciliation.
```

## Cross-Module Contracts

### Session Entry State

Input is a complete or cursor-based `get_entries` result. Output is one of:

- complete active path plus a content-free complete-tree index;
- verified active-path continuation plus the updated index;
- an explicit requirement for a complete reload.

It never returns append order as a display order and never retains abandoned-branch message content.

### Active Branch Edge

The session-tree pure projection describes each represented active edge with:

- branch-point entry id, or virtual root;
- active child entry id;
- reachable path count.

It contains no user-message anchor, timestamp, or branch summary.

### Conversation Snapshot

The conversation projection exposes:

- one ordered top-level `conversationItems` collection;
- visual turns whose `items` are also ordered and may include activities, notices,
  boundaries, and branch controls;
- queued follow-ups as a separate non-durable collection;
- a monotonic change/version timestamp for session view composition.

Persisted items use Pi entry ids or stable protocol ids. Only live turns that observed a Pi user message event are eligible for source identity; ConversationProjection pairs those turns with appended user entries in protocol FIFO order and never by text or timestamp. A matched live turn retains its existing view identity while receiving the Pi entry id as source identity.

### Session View Composition

`SessionViewState` and `ConversationProjection` are sibling owners. Session view composition joins their non-overlapping snapshots without proxying conversation operations or changing item order. Runtime publishes after both states for one lifecycle transition are coherent.

### Webview Ownership

The Host owns item order, turn membership, entry filtering, and branch-edge placement. The Webview owns disclosure, scrolling, and rendering. Trace collapse may hide eligible activity ranges but cannot move or hide fixed conversation items.

## Explicit Non-Landings

- No new repository/service/manager/mapper layer around Pi RPC.
- No raw `RpcSessionEntry` or `RpcEvent` in shared/Webview contracts.
- No plugin renderer protocol for plain `custom` entries.
- No pagination or virtualization in this change.
- No timestamp/order field added to parallel collections; those collections are removed.
- No branch-summary association in session-tree projection.
