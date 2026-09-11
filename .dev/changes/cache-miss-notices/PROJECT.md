---
title: Pi-configured cache-miss notices
description: Project entry for reproducing Pi TUI cache-miss notices in FrostPi.
scope:
  - /apps/vscode/src/extension/**
  - /packages/pi-rpc/**
status: in-progress
---

# Pi-configured cache-miss notices

## Goal

FrostPi reproduces Pi TUI's cache-miss notices from documented Pi RPC assistant usage data and displays them only when the Pi process's effective `showCacheMissNotices` setting enables the behavior.

## Success criteria

- Pi settings remain authoritative; FrostPi adds no duplicate cache-notice preference.
- Disabled settings produce no notice.
- Enabled settings produce Pi-compatible notices for live turns and rebuilt history.
- Notices remain derived presentation and are not persisted into Pi session JSONL.
- Raw Pi events and entries remain inside the Extension Host.
- Focused behavior tests and affected durable contracts are updated.

## Current situation

Pi RPC transmits the assistant messages, usage, model identity, and timestamps needed to detect cache misses, but does not transmit the warning text rendered by Pi TUI. The shared Pi-settings loader is complete. The working tree now contains the Pi-compatible detector and its live/history projection integration; automated verification passes, while interactive review remains pending.

## Decisions

- Derive cache-miss diagnostics in FrostPi rather than require an upstream RPC event.
- Create the shared settings module under `apps/vscode/src/extension/_shared/pi-settings/`.
- Follow Pi's `showCacheMissNotices`; do not add a `frostpi.*` equivalent.
- Preserve Pi's live and history-rebuild behavior, including reset boundaries and duplicate suppression.

## Scope boundaries

This project does not clear, disable, or otherwise control provider prompt caches. It does not bundle or pin `@earendil-works/pi-coding-agent` merely to import its `SettingsManager`.

## Work tracking

LAI is the issue backend. Query the work set with:

```bash
lai list 'label:work:cache-miss-notices'
```

- [Support Pi-configured cache-miss notices](lai:#1) — parent outcome.
- [Centralize Pi settings loading and effective cache-notice setting](lai:#2) — shared settings foundation.
- [Implement Pi-compatible cache-miss detection](lai:#3) — independent pure detection behavior.
- [Project cache-miss notices into live and restored conversations](lai:#4) — integration, blocked by #2 and #3.

Issues #2 and #3 are complete. Issue #4 is implemented in the working tree and awaiting interactive review; the change remains intentionally uncommitted.

## Consequential compatibility question

Pi RPC does not expose the effective `showCacheMissNotices` value. Settings resolution must account for global/project precedence, `PI_CODING_AGENT_DIR`, project trust, and relevant launch arguments closely enough to avoid presenting an ignored project setting as active. Any unavoidable difference from Pi must be explicit in the settings issue and its tests.
