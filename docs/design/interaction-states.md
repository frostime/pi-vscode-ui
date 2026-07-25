---
title: Interaction States
description: User-visible behavior for running, recovery, scrolling, proxy, and completion states.
scope:
  - /apps/vscode/src/webview/**
updated: 2026-07-20
---

# Interaction States

- **Queued/starting:** disable submission/model mutation; preserve session actions and show whether Pi is waiting to start or starting.
- **Running:** composer remains editable; the primary action becomes Stop; queued prompts use configured Pi semantics. With the default `followUp` behavior, follow-ups appear at the conversation tail as dashed "Queued" bubbles and only join the durable turn timeline when Pi starts the next run. Further submits stay parked while any local queue remains, even after `agent_settled`. Abort/stop/failure clears local queued bubbles. `steer` still inserts into the live conversation immediately.
- **Tool/reasoning:** collapsed by default, including errors. State updates never override a user's disclosure choice.
- **Turn trace:** with `frostpi.conversation.collapseTurnTrace` (default on), any settled turn hides the work trace before the final reply. The header reads "Worked · N steps · duration" for a completed turn, "Stopped · …" for an aborted turn, and "Failed · …" for an error turn. If the turn ended before the assistant produced a final response (e.g., interrupted mid-tool), the last activity is treated as the visible outcome and the break is labeled "Last step" instead of "Reply". Expanded rows stay flat siblings (same chrome as a running turn). A labeled break — not a bare Markdown-like rule — separates the work trace from the visible outcome; collapsed rows are not mounted. Only a still-running turn stays flat. Expanding is local to that turn for the current Webview mount.
- **Scroll following:** initial load, session switch, new user turn, manual bottom reach, or jump button follows output. User scroll-away pauses without losing updates.
- **Pending extension UI:** stays visible until answered, timed out by Pi, or cancelled by stop/restart. A background owner is marked as requiring input.
- **Conversation history:** a resumed Pi process reaches ready before prior messages finish loading, but submission remains disabled until an automatic load completes. Large histories are deferred, remain usable, and expose an explicit load action; failure is retryable without failing the Pi process.
- **Compaction:** manual `/compact` delegates to Pi and may abort an active run, matching Pi CLI semantics. While Pi compacts, submission is disabled and the conversation shows an ephemeral "Compacting context" status that is not stored in the timeline. Success preserves visible prior turns and inserts a collapsed summary boundary; failure preserves the conversation and reports Pi's error.
- **Temporary new session:** replacing it closes it without confirmation until a prompt is accepted or the session is renamed.
- **Message fork:** available only for a user message with a resolved Pi entry id while the selected session is idle, history is loaded, and no local follow-up awaits promotion. During replacement the Composer remains disabled except for a Cancel Fork primary action. Success retains the original stable session id as stopped, selects a new temporary fork id, and focuses the host-seeded selected message draft. Cancellation stops the child, restarts the original, and leaves logical sessions and drafts unchanged.
- **Proxy changed:** running sessions show restart-required. Saving settings never silently interrupts work.
- **File mention:** `@` opens mention completion with `@Selection` / `@CurrentFile` above bounded workspace paths; selection inserts path/line references only, never file bodies.
- **Model/thinking:** compact anchored menus stay within the Webview viewport and remain keyboard navigable.
- **Resume:** available through the session launcher, Command Palette, onboarding, and local `/resume`.
- **Composer external editor:** local `/editor` opens one temp markdown file prefilled from the draft (command token stripped). Closing the tab reads the file from disk and replaces that session's composer text (Save keeps edits, Don't Save discards them) while keeping image attachments; a second `/editor` while the tab is open focuses the existing tab.
- **Composer expand:** toolbar chevron expands the composer inside the FrostPi panel (conversation collapses); Escape or the same control restores. State is local and resets on session switch.
- **Narrow sidebar:** labels may truncate and secondary status may disappear or move to menus, but no committed capability disappears or requires horizontal scrolling.
- **Hidden session bar:** the conversation uses the released vertical space; a floating restore control remains keyboard accessible and indicates required background input.
