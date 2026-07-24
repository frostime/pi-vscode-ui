---
title: UI Design Specification
description: Visual language, density, theming, and interaction rules for FrostPi.
scope:
  - /apps/vscode/src/webview/**
updated: 2026-07-25
---

# UI Design Specification

FrostPi should feel like a first-party desktop coding surface: compact, low-noise, keyboard-usable, and native to the active VS Code theme.

## Sessions

- The Webview session bar is the sole in-view location for new, resume, switch, and close actions; do not duplicate those actions in VS Code's View title menu.
- The bar is a compact single row and may be hidden. The conversation uses the released height while the composer remains bottom-anchored; a floating restore control consumes no layout height and signals background input requests.
- The session list distinguishes the selected session, background execution, queued startup, failure, and required user input. Sessions running outside the open workspace folders show the worktree directory name as a compact capsule on the secondary status line (header inline status and list) and expose the complete `cwd` as a tooltip; titles stay aligned across local and external sessions. Closing a running session requires confirmation; closing a temporary unused session does not.
- New uses a native VS Code directory picker only when linked worktrees are available. Resume remains one native searchable `createQuickPick`, grouped by worktree with linked worktrees before the current workspace; it does not introduce a nested Webview tree or mandatory two-stage selection.
- At 280px width, secondary status text may disappear but switching, creation, closing, and restoring the bar remain available. The Session actions menu includes a `Pi integration` row showing cached session-tree adapter availability; activating it performs a fresh capability probe and reports the actual connection result through native VS Code messaging.

## Conversation

- A user prompt and subsequent Pi activity form one visual turn.
- Assistant identity is expressed by the session header; do not repeat an avatar/icon for every fragment.
- Responses are Markdown with KaTeX math (`$…$`, `$$…$$`, `\(…\)`, `\[…\]`) and complete `mermaid` fences. Incomplete mermaid fences stay source text while streaming. User prompts use a restrained bubble.
- Reasoning and tools are dense one-line activities, default collapsed. Failure exposes an inline summary but does not force expansion. When `frostpi.conversation.collapseTurnTrace` is enabled (default), a completed turn further collapses tools, reasoning, and interim replies into one summary row above the final response; the running turn stays expanded step-by-step.
- Disclosure state is user-owned; live updates must not reopen a manually collapsed activity.
- While context is compacting, the conversation shows a non-timeline status row. A successful compaction inserts a distinct, collapsed boundary showing the pre-compaction token count. Expanding it reveals Pi's Markdown summary; prior visible turns remain scrollable.
- User scrolling away pauses follow mode. New activity preserves the viewport and exposes a floating jump-to-latest control.
- User messages and individual assistant responses expose a compact action row on hover or keyboard focus. Copy writes only the original text blocks in protocol order, preserving raw Markdown and excluding images, reasoning, tools, notices, and rendered formatting. Fork remains user-message-only: it targets that exact Pi entry, preserves the original session, and restores the selected text and images into the fork's Composer; unavailable actions remain disabled rather than guessing by message text.
- Completed user messages expose **Branch here** beside Fork. Branch here edits and resubmits the prompt in the same Pi session; Fork creates another FrostPi session. Represented branch points are centered timeline milestones: thin rules flank a compact `<count> branches` control. Its native QuickPick separates `Current path` from `Other paths`; each selectable row shows divergence content, message count, last update, and a bounded ending preview. The current path is first and is a no-op. Generated branch summaries are collapsed conversation boundaries. Switching/summarizing shows non-cancellable progress and preserves a draft for non-editable targets.

## Question requests

- FrostPi's bundled Question tool renders in a bottom-docked panel between the conversation and composer. The expanded panel has bounded height and its own scrolling so the conversation remains visible and independently scrollable while the user answers.
- The panel can collapse without cancelling pending requests. When multiple requests are pending, the user can switch among them; no session-level singleton request is assumed.
- Every question requires an explicit predefined selection or saved custom answer before Submit is enabled. Single-question requests follow the same explicit Submit rule. Cancel resolves only the selected request.
- A Webview remount may reconstruct pending requests from Host state; unsubmitted Webview draft state is disposable. A Pi process stop or restart cancels pending requests instead of restoring them.
- At 280px width, controls may wrap vertically but question text, answer selection, Cancel, Submit, collapse, and request switching remain usable without horizontal scrolling.

## Composer and pickers

- CodeMirror remains a plain-text editor: Enter newline, Ctrl/Cmd+Enter send, native IME/undo/selection. It starts near three lines and is height-bounded with internal scrolling. A toolbar control may expand it to fill the FrostPi panel (conversation collapses) without leaving the Webview.
- Known `/command` and `@file` tokens receive subtle semantic decoration; unknown commands receive a warning underline. `@` completion lists built-in selection/current-file mentions above workspace paths. Completion rows use normal VS Code UI font sizing and never open a layout-shifting description panel.
- Model and thinking selectors are anchored popovers, not full-width dialogs. Only the current provider opens by default; search expands matching groups. Provider state is user-controlled, supports expand/collapse all, and model rows never change height on hover.
- Thinking options are derived from the active Pi model metadata and use the same typography scale as model controls.
- Context usage exposes a compact percentage and an accessible hover/focus detail card. The card stays narrow (about 230px), uses compact token counts, and short message labels (`18u · 114a`). While Pi is running, FrostPi refreshes available session statistics every few seconds and performs a final refresh after `agent_settled`; fields still follow the update precision exposed by Pi's `get_session_stats` response.

Use semantic FrostPi CSS variables mapped from VS Code variables. Avoid large shadows, gradients, pill-heavy layouts, and fixed widths that cause horizontal scrolling at 280–430px.
