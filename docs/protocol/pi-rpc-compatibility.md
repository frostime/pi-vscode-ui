---
title: Pi RPC Compatibility
description: Supported Pi RPC commands/events, executable resolution, and compatibility policy.
scope:
  - /packages/pi-rpc/**
  - /apps/vscode/src/extension/configuration/configuredPiInvocation.ts
  - /apps/vscode/src/extension/question-tool/**
  - /apps/vscode/pi-extensions/question-tool.ts
updated: 2026-07-28
---

# Pi RPC Compatibility

FrostPi targets the documented RPC mode of the current `@earendil-works/pi-coding-agent` line. It launches Pi with `--mode rpc`; configured extra arguments follow that pair, and restored sessions add `--session <path>`.

## Required surface

Startup requires `get_state`. The product additionally uses prompt/abort, manual compact, session entries, fork, commands, available models, model selection, thinking level, session naming, session stats, and extension UI responses. Unknown asynchronous events are ignored unless their absence violates an existing projection invariant.

Message-level Fork uses `get_entries` to bind the displayed user message to its stable Pi entry id, then calls `fork(entryId)` without the ordinary request timeout because `session_before_fork` may wait for Extension UI. Pi replaces the active runtime with a new session and returns the selected text for editing; FrostPi rebuilds the active projection and restores projected image attachments itself because the fork response contains text only. Explicit cancellation stops the child and restarts the original session, preventing a late response from changing the recovered runtime.

Pi built-in interactive commands are not returned by `get_commands` and do not execute through RPC `prompt`. FrostPi therefore translates text-only `/compact` and `/compact <instructions>` submissions to the documented `compact` request. Successful `compaction_end` events append a live compaction boundary without removing earlier turns; the next entry refresh reconciles it with Pi's persisted `compaction` entry.

Session-tree reads use documented complete `get_entries` data. Native RPC does not expose `navigate_tree`, so FrostPi packages a feature-specific private Pi extension and injects it by absolute `-e` path. Its command calls `ctx.navigateTree()` and exchanges only bounded status/leaf metadata through a per-runtime token and OS temporary result directory. `get_commands.sourceInfo.path` discovers the final command name and hides every command from that bundled source. Missing capability disables tree actions visibly; compatibility is capability-based rather than inferred from a Pi version string.

The optional bundled `question` tool also stays above the RPC transport package. At process start, the extension receives a per-runtime token and temporary request directory, writes a bounded request file, then blocks on documented `ctx.ui.input()`. FrostPi recognizes the authenticated private input title, projects the request into its Webview, and returns the answer through the standard `extension_ui_response` value. There is no custom RPC event, watcher, polling loop, response file, or change to `packages/pi-rpc`. Setting changes apply only to the next Pi process. Project/global `question` registrations loaded earlier by Pi retain priority over FrostPi's explicit `-e` extension.

Pi extension commands do execute through RPC `prompt` (with args after the command name). They may complete without `agent_start` / `agent_settled`; FrostPi classifies them via `get_commands` (`source: "extension"`, refresh only on name miss) and closes the turn opened for that prompt after short idle checks.

The client accepts documented additive fields. It treats malformed JSONL, invalid response envelopes, stdout termination, stdin errors, startup timeout, and unexpected process exit as connection failures.

## Executable resolution

A configured `.js`, `.mjs`, or `.cjs` entry point is launched with `node` from the environment, not `process.execPath`; VS Code's embedded Node may be older than Pi's requirement. A native executable is launched directly. Without configuration, FrostPi resolves `pi` from `PATH` and common global package locations.

## Version policy

FrostPi does not pin or bundle Pi. Compatibility breaks must produce a visible startup/protocol error with bounded stderr, never silently fall back to a new empty session. When adopting a new Pi RPC behavior, add a captured fixture or fake-process test and update `packages/pi-rpc/SPEC.md`.

## Model thinking metadata

The Webview treats the active model object returned by Pi as authoritative. Reasoning models expose standard levels through `high` by default. `thinkingLevelMap` entries mapped to `null` are hidden; extended `xhigh` and `max` levels are shown only when Pi explicitly advertises them. After model or level changes, `get_state` remains authoritative if Pi clamps the selection.

## Existing sessions

FrostPi discovers existing Pi JSONL files for the active workspace, then starts a normal independent RPC process with `--session <absolute-path>`. Pi remains responsible for file migration, tree position, history, model state, and extension lifecycle.

FrostPi uses `get_entries` plus its reported `leafId` as the persisted Webview transcript authority. It projects the complete selected parent chain, including entries before compaction; `get_messages` represents Pi's current LLM context and must not hydrate conversation history. Files larger than 8 MiB require an explicit history-load request to avoid fetching full entry content during startup. See `apps/vscode/src/extension/sessions/catalog/session-catalog.SPEC.md`.
