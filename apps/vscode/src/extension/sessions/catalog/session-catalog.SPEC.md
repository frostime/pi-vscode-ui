---
title: Existing-session discovery and resume
description: Session storage roots, bounded JSONL discovery, worktree grouping, metadata recovery, and Resume ownership checks.
scope:
  - /apps/vscode/src/extension/sessions/catalog/SessionCatalog.ts
  - /apps/vscode/src/extension/sessions/catalog/SessionCatalogPicker.ts
updated: 2026-07-24
---

# Existing-session discovery and resume

## Scope

FrostPi implements the user-visible equivalent of Pi's `/resume` for the active VS Code workspace folder and its existing same-repository worktrees. It does not invoke Pi's terminal selector and does not edit session files.

## Discovery

Candidate session roots are discovered from:

1. `--session-dir` in `frostpi.pi.arguments`
2. `PI_CODING_AGENT_SESSION_DIR`
3. project `.pi/settings.json` `sessionDir`
4. user `~/.pi/agent/settings.json` `sessionDir`
5. Pi's default `~/.pi/agent/sessions`

Relative `sessionDir` values follow Pi runtime semantics: expand `~`, then resolve against the active workspace folder (the cwd FrostPi uses when launching Pi). They are **not** resolved relative to the settings file directory; that rule applies to Pi resource paths (extensions, skills, …), not `sessionDir`.

Roots are resolved separately for the active workspace folder and every allowed worktree working directory, then deduplicated. This preserves each worktree's project `.pi/settings.json` and Pi's cwd-relative `sessionDir` semantics. All candidate roots are scanned so older sessions remain discoverable after a configuration change. Results are filtered by the session header's `cwd`, which must match one of the allowed working directories.

Scanning is bounded to 2,000 JSONL files globally across all roots. Roots used only by linked worktrees are scanned before roots used only by the current workspace; roots shared by multiple working directories are scanned last. This prioritizes active worktree-specific storage without enumerating or `stat`-sorting every JSONL. Metadata reads use bounded head and tail windows rather than loading the whole conversation. Invalid, truncated, inaccessible, and non-session files are skipped. The native VS Code `createQuickPick` groups results by worktree: non-empty linked-worktree groups first (ordered by each group's latest update), then the current workspace group; each group is ordered by update time. Separator labels are plain text (`Worktree · …` / `Current workspace · …`) because separators do not render codicons. Session rows use `$(git-branch)` for linked worktrees and `$(comment-discussion)` for the current workspace so spaces stay visually distinct while scrolling. Worktree labels remain in searchable item fields so search still crosses groups.

Extension hooks that rewrite the session directory at runtime are not visible to discovery; use **Browse for a session file…** for non-standard storage.

## Display name

Pi stores the session display name in append-only `session_info` entries; the latest entry in file order wins, and an empty name clears the title (`getSessionName`).

FrostPi recovers the name from the head window (64 KiB) and the tail window (384 KiB), keeping the `session_info` with the greatest file offset. That covers early auto-naming (name written after the first turn, then more transcript) and late renames near EOF. A name that lies only in the unscanned middle of a very large file falls back to the latest user-message preview in the tail window, then the file basename.

## Resume lifecycle

Selecting a session creates a normal FrostPi `SessionRuntime` with the session header's `cwd` and starts Pi using `--session <absolute-jsonl-path>`. The Pi process remains authoritative for migration, history reconstruction, active tree position, model state, and extension loading.

Opening a session already present in FrostPi activates the existing runtime instead of spawning a duplicate process.

A manually browsed session whose `cwd` is outside the allowed active-workspace/worktree set is not started. FrostPi offers to open the owning folder first, preventing an agent attached to one repository from silently operating in another project.

## Non-goals

- Own session-tree navigation policy. In-place tree navigation belongs to the live `SessionRuntime`; the catalog only discovers and resumes files at Pi's persisted active leaf.
- Parse the entire session graph during discovery.
- Modify Pi session JSONL files.
