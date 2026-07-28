---
title: Existing-session discovery and resume
description: Session roots, bounded discovery, metadata recovery, worktree ownership, and browse constraints.
scope:
  - /apps/vscode/src/extension/sessions/catalog/**
updated: 2026-07-28
---

# Existing-session discovery and resume

The catalog provides Pi `/resume`-equivalent discovery for the active workspace and allowed same-repository worktrees. It never invokes Pi's terminal selector or modifies session JSONL.

## Roots and ownership

Root precedence is: `--session-dir` in `frostpi.pi.arguments`, `PI_CODING_AGENT_SESSION_DIR`, project `.pi/settings.json` `sessionDir`, user `~/.pi/agent/settings.json` `sessionDir`, then Pi's default `~/.pi/agent/sessions`.

Relative `sessionDir` values expand `~` and resolve from the relevant workspace/worktree directory used as Pi cwd, never from the settings file. Roots are resolved per allowed working directory, deduplicated, and all remain candidates so sessions survive configuration changes. A candidate JSONL header `cwd` must match an allowed directory.

Runtime extension hooks that rewrite storage are not discoverable; **Browse for a session file…** is the recovery path.

## Bounded discovery and metadata

Scanning is globally bounded to 2,000 JSONL files. Linked-worktree-only roots precede current-workspace-only roots, with shared roots last. Metadata reads use bounded head/tail windows; invalid, truncated, inaccessible, and non-session files are skipped without loading full transcripts.

The latest `session_info` by file offset is the display-name authority, including an empty value that clears the title. Recovery examines the 64 KiB head and 384 KiB tail, then falls back to the latest tail user-message preview and finally the file basename.

## Resume

Selecting a result starts a normal `SessionRuntime` at the header `cwd` with `--session <absolute-jsonl-path>`; Pi owns migration, active tree position, history, model state, and extension loading. Selecting a session already represented in FrostPi activates that runtime instead of spawning a duplicate.

A browsed session outside the active-workspace/allowed-worktree set is not started; FrostPi offers to open its owning folder first. The catalog does not parse the complete graph, own live tree navigation, or write JSONL.
