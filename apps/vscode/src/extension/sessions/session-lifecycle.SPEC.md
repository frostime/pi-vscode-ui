---
title: Pi Session Lifecycle
description: Observable lifecycle, persistence, concurrency, and recovery rules for VS Code-managed Pi RPC sessions.
scope:
  - /apps/vscode/src/extension/sessions/**
  - /apps/vscode/src/extension/conversation/**
  - /apps/vscode/src/extension/extension-ui/**
updated: 2026-07-24
---

# Pi Session Lifecycle

## Ownership

One `SessionRuntime` owns exactly one live `pi --mode rpc` child process. `SessionRegistry` owns the collection, active selection, persistence metadata, and Webview-facing workspace snapshot. Pi owns conversation persistence and session JSONL content.

## Working directories

Each Session owns its process working directory. New and Resume use the active editor's workspace folder, otherwise the first workspace folder, as their anchor. That folder is always allowed; existing non-bare, non-`prunable` worktrees of the same Git repository are also allowed. A workspace opened below the worktree root maps the same repository-relative subdirectory into linked worktrees, and omits a worktree when that mapped directory does not exist.

Worktree discovery and path authorization remain in the Extension Host. The Webview cannot supply a `cwd`. Multi-root workspaces do not aggregate repositories in New or Resume, but persisted records are validated against every open workspace folder so an inactive root's Sessions remain valid. An external worktree Session inherits resource-scoped FrostPi configuration from its anchor workspace folder.

FrostPi queries Git on New, Resume, initial restoration, and before starting or restarting a stopped external Session. It does not cache the worktree list persistently, watch `.git`, or interrupt a running process after external worktree removal. Authoritatively removed worktrees cause FrostPi metadata cleanup without deleting Pi JSONL; failed Git discovery retains uncertain records and does not authorize their process start.

## Concurrency

Multiple sessions may run concurrently, including sessions sharing a workspace. Exactly one session is selected for Webview presentation; selecting another session does not stop background work or invoke Pi's `switch_session` command.

Pi process starts are serialized to avoid concurrent startup spikes. Conversation-history loads are serialized separately, so a slow history load does not prevent an already started Pi process from becoming usable. FrostPi does not add a global execution lock, command gate, file-write proxy, or conflict resolver. Workspace conflicts are visible consequences of concurrent agents and remain the user's responsibility.

## Initial open

Extension activation restores persisted session metadata only. It does not create a new session when none exist; the Webview shows the onboarding home until the user creates or resumes one. `frostpi.session.startOnOpen` may start the already-selected restored session's Pi process, but never invents a session identity.

## Temporary new sessions

A locally created session remains temporary until Pi accepts its first non-empty prompt or the user renames it. Temporary sessions appear in the live session list but are excluded from workspace persistence. Selecting, creating, or resuming another session closes the currently selected temporary session without confirmation.

Resumed sessions are never temporary. Closing a temporary session stops its Pi process but does not delete any file Pi may have created.

## Message Fork

A completed, projected user message may be forked only while its session is selected, idle, fully loaded, free of pending extension UI, and has no locally queued follow-up awaiting promotion. Pi entry ids—not message text—identify the target. The original FrostPi id remains attached to the original session and its Composer draft. After Pi commits the replacement, a new local id adopts the live runtime and becomes the selected temporary fork; the original id receives a stopped runtime. Old extension statuses/widgets are cleared before replacement; a cancelled fork restores them, while the new extension instance may publish its own decorations during rebind.

The selected user message is excluded from the copied Pi path. Pi's returned text and FrostPi's projected images become a host-projected Composer seed for the fork. The seed is replayable after Webview reload, applied once per mount, never persisted, and cleared after the first successful Composer submission. Before asking Pi to fork, FrostPi validates every projected image with the same Base64, decoded-size, metadata, MIME, count, and configured-size checks used by prompt submission.

Fork waits for `session_before_fork` interaction without the ordinary RPC request timeout. The Composer exposes explicit Cancel Fork; cancellation stops the child and restarts the original session so a late Pi commit cannot change the recovered process. Preflight failure or Pi cancellation changes no logical session or draft. If Pi commits but naming/state/history reconciliation fails, FrostPi stops the fork process, removes the unfinished temporary fork, and restarts the original. FrostPi leaves any Pi JSONL already created on disk.

Forks are named `Fork: <source title>` (`Fork session` when no title exists) and remain temporary until their first accepted prompt or an explicit user rename. The automatic fork name and `/compact` do not commit the temporary session.

## Session-tree navigation

Tree navigation is an in-place mutation of the selected runtime, Pi session id, and Pi JSONL file. FrostPi injects its packaged `dist/pi-extensions/session-tree.js` by absolute `-e` path; the private command delegates leaf mutation and context reconstruction to Pi's `ctx.navigateTree()`. Runtime capability is discovered from `get_commands.sourceInfo.path`, including collision-suffixed command names, and bundled commands are removed from Composer completion.

Before navigation, Runtime refetches complete entries, revalidates the target, and validates any editable text/image seed. Registry owns native target, summary, custom-focus, and draft-replacement interaction. Runtime retains only a content-free tree index for branch controls; complete entries are operation-local.

Pi cancellation and failure before the private result confirms a commit preserve the displayed history and Composer. Once commit is confirmed, Pi is authoritative. FrostPi rebuilds state, messages, entries, stats, controls, and an optional same-session Composer seed without replacing runtime identity. A later hydrate failure leaves the navigation committed, marks history failed for retry, and never reverse-navigates automatically.

## Persistence

FrostPi persists only:

- local UI session id;
- display title;
- working directory;
- Pi session file path;
- last-updated timestamp;
- active session id.

It does not persist message bodies, reasoning, tool output, images, provider credentials, API keys, worktree lists, branch names, or the anchor workspace folder. The anchor is recovered from current Git worktree relationships before an external process starts. On restoration, the process starts with `--session <path>` and conversation state is rebuilt from Pi's `get_messages` response.

## State semantics

`queued → starting → ready/running → stopping → stopped` is the normal lifecycle. `failed` is terminal for the current child process but the session metadata remains retryable.

- `queued`: the session is waiting for the serialized process-start slot.
- `ready`: process is alive and Pi is idle.
- `running`: Pi reports an active session-level run.
- `stopped`: no live child process; a persisted session may be started again.
- `failed`: startup, protocol, stdin, or unexpected process failure occurred.

`agent_end` is not considered completion. Only `agent_settled` changes a running session back to ready because retries, compaction retries, or queued continuations may follow `agent_end`.

## Follow-up prompts while streaming

When `frostpi.composer.streamingBehavior` is `followUp` (default), a normal prompt accepted while Pi is streaming is projected as a session-level queued follow-up, not as a durable turn. The host also parks subsequent normal prompts while that local queue is non-empty. Pi typically drains follow-ups before `agent_end` and emits `message_start` (`role: user`) without a new `agent_start`; promotion follows protocol FIFO order. `agent_start` is only a fallback after settle. Extension slash commands are not parked. Abort, process stop, and process failure clear the local queue.

## Slash commands

Composer text is trimmed before RPC submission so leading/trailing whitespace cannot bypass Pi's leading-`/` extension-command match. After trim, a leading `/command` also normalizes any Unicode whitespace between the command token and its args to a single ASCII space, matching Pi's `indexOf(" ")` command split. FrostPi-local `/compact`, `/resume`, and `/editor` remain host-handled; every other slash is sent as a normal `prompt`. `/editor` opens a VS Code untitled buffer and never reaches Pi.

Pi extension commands (from `get_commands` with `source: "extension"`) execute inside the `prompt` request and often never emit `agent_start` / `agent_settled`. After such a prompt returns, FrostPi closes the turn opened for that prompt once short idle checks (`get_state`) report no agent work, or falls back to local non-streaming completion if every `get_state` fails. Command classification uses the cached list by exact name: a known non-extension slash is not re-fetched; a name missing from the cache triggers one `get_commands` refresh, then classification. Prompt templates and skills still expand into ordinary agent turns and close only on `agent_settled`.

## Conversation history

A resumed Pi process becomes ready after startup state is available; loading prior messages is separate. The Webview disables and the host rejects prompt submission during an automatic history load. Pi events received while `get_messages` is pending are retained and applied in order after the displayed history is replaced. History loads are serialized. Session files larger than 8 MiB are not loaded automatically because Pi returns `get_messages` as one potentially large JSONL record; these sessions remain usable and the user may explicitly request history loading from the session menu.

A history-load failure does not fail the live Pi process. The session remains usable and exposes the failed history state for retry.

## Extension UI

Dialog requests are owned by the session that emitted them. They remain pending until the user responds, Pi's own timeout resolves them, or the session closes. Closing a session explicitly sends cancellation responses for every pending dialog. FrostPi never auto-confirms a dialog. A background session with a newly pending dialog is marked as requiring user input.

When the experimental `frostpi.notifications.experimental.enabled` setting is on and the VS Code window is unfocused, FrostPi notifies for the first pending dialog, a transition into `failed`, and a normal Agent Turn closed by `agent_settled`. Explicit abort, `/compact`, immediate extension commands, error turns, and repeated state updates do not produce completion notifications. A local Windows Extension Host uses a native Windows PowerShell toast; unavailable native delivery falls back to a VS Code notification.

Fire-and-forget UI requests affect only their session. `set_editor_text` is routed to the composer only when the session is active; inactive-session text is retained by the host until that session is activated.

## Failure recovery

A failed runtime may be restarted using its stored session file. A missing or invalid session file causes Pi startup to fail visibly; FrostPi does not silently create a replacement session under the same UI identity.
