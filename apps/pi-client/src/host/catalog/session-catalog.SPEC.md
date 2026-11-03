---
title: Existing-session discovery and resume
description: Session roots, bounded discovery, metadata recovery, worktree ownership, and browse constraints.
scope:
  - /apps/pi-client/src/host/catalog/**
updated: 2026-11-03
---

# Existing-session discovery and resume

The catalog provides Pi `/resume`-equivalent discovery for the active workspace and allowed same-repository worktrees. It never invokes Pi's terminal selector or modifies session JSONL.

## Roots and ownership

For the default `pi` compatibility profile, each allowed cwd selects only its effective session directory: `--session-dir` in `frostpi.pi.arguments`, `PI_CODING_AGENT_SESSION_DIR`, project `.pi/settings.json` `sessionDir`, user `<agent-dir>/settings.json` `sessionDir`, then `<agent-dir>/sessions/<Pi-encoded-cwd>/`. `<agent-dir>` follows `PI_CODING_AGENT_DIR`, defaulting to `~/.pi/agent`. Discovery must not scan the default global `sessions` root or lower-priority settings as automatic fallbacks. The `oh-my-pi` profile uses `~/.omp/agent/sessions` and does not read Pi settings or Pi session-directory environment overrides; an explicit `--session-dir` is the only root override in that profile.

Relative `sessionDir` values expand `~` and resolve from the relevant workspace/worktree directory used as Pi cwd, never from the settings file. Custom directories are used directly, without appending an encoded cwd. Roots are resolved per allowed working directory and deduplicated. A candidate JSONL header `cwd` must match an allowed directory, including a symbolic-link/junction alias of the same directory. Catalog filtering, browse validation, and picker grouping use the same path-equivalence rule without rewriting the header.

Missing or empty effective directories yield no results, not a wider scan. Discovery is read-only and must not create session directories. Sessions in old configuration locations and storage rewritten by runtime extension hooks require **Browse for a session file…**.

## Bounded discovery and metadata

Discovery is globally bounded to 2,000 JSONL files. Linked-worktree-only roots precede current-workspace-only roots, with shared roots last. Invalid, truncated, inaccessible, and non-session files are skipped.

When `rg` is available in the Host environment, the catalog scans the resolved roots for top-level `session` and `session_info` records. A complete scan supplies headers and the latest `session_info` by file offset without reading transcript messages; these fast-path entries intentionally omit the optional user-message preview. Files without a title use the bounded metadata reader for preview fallback. If `rg` is unavailable or its scan is incomplete, every discovered file uses that reader instead.

The bounded reader examines the 64 KiB head and 384 KiB tail. The latest visible `session_info`, including an empty value that clears the title, wins before the latest tail user-message preview and file basename. A complete `rg` result is authoritative over an older title visible in those windows; an empty latest name still falls back to preview or basename rather than restoring the older title.

## Resume

Selecting a result starts a normal `SessionRuntime` at the header `cwd` with `--session <absolute-jsonl-path>`; Pi owns migration, active tree position, history, model state, and extension loading. Selecting a session already represented in FrostPi activates that runtime instead of spawning a duplicate.

A browsed session outside the active-workspace/allowed-worktree set is not started; FrostPi offers to open its owning folder first. The catalog does not parse the complete graph, own live tree navigation, or write JSONL.
