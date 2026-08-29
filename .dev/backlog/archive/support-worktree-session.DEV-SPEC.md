---
title: Worktree Session Development Specification
description: Temporary implementation contract for running and resuming FrostPi sessions in existing Git worktrees.
scope:
  - /apps/vscode/src/extension/sessions/**
  - /apps/vscode/src/shared/model/sessionViewModel.ts
  - /apps/vscode/src/webview/features/sessions/**
  - /apps/vscode/src/webview/features/onboarding/OnboardingView.svelte
updated: 2026-07-21
status: temporary-development-spec
---

# Worktree Session Development Specification

## Goal

A FrostPi window may run concurrent Pi sessions in the current workspace folder and in existing worktrees of the same Git repository. Each Pi process uses its selected directory as its real process `cwd`; FrostPi does not redirect file writes or move Pi session files.

## Terms

- **Anchor workspace folder**: the VS Code workspace folder selected by the existing rule: the active editor's folder, otherwise the first workspace folder.
- **Worktree root**: a valid non-bare entry returned by `git worktree list --porcelain` whose directory exists and is not marked `prunable`.
- **Session working directory**: the directory passed to Pi as `cwd`. For a workspace opened at a repository subdirectory, the same repository-relative subdirectory is mapped into each worktree.
- **Pi session discovery**: the existing on-demand scan of Pi JSONL files performed when the user invokes Resume. It is not a persisted index.

## Directory boundary

The anchor workspace folder is always an allowed Session working directory, including in non-Git workspaces or when Git cannot be queried.

Additional Session working directories must:

1. belong to a worktree reported for the anchor folder's Git repository;
2. have an existing, non-`prunable`, non-bare worktree root;
3. map to the same repository-relative directory as the anchor workspace folder;
4. exist after that mapping.

A linked worktree may itself be the anchor. Locked worktrees remain valid. Arbitrary external directories are not authorized.

In a multi-root VS Code workspace, New and Resume use only the anchor workspace folder and its repository. Restoration cleanup validates persisted records against all currently open workspace folders so records belonging to an inactive root are not incorrectly removed.

## User behavior

### New Session

- If only the anchor workspace folder is available, New creates the Session directly with no additional prompt.
- If additional worktrees are available, New opens a VS Code `QuickPick`.
- The anchor workspace folder is first; other worktrees are ordered by display name.
- Items show the current branch when available, the worktree directory name, and the complete target `cwd`. A detached worktree is labeled `Detached HEAD`.
- All existing New entry points and the command palette command use this flow.
- The Webview continues sending a parameterless `createSession` message. It never supplies a filesystem path.

### Resume Session

Resume discovers Pi sessions for every allowed Session working directory.

- Session roots are resolved separately for each directory because `.pi/settings.json` and relative `sessionDir` values may differ by worktree.
- Resolved roots are deduplicated before scanning.
- Roots exclusive to linked worktrees are scanned before roots exclusive to the current workspace; roots shared by multiple working directories are scanned last.
- The existing global scan bound remains 2,000 JSONL files across all roots; discovery does not enumerate every candidate merely to sort by `mtime`.
- Results are grouped by worktree: non-empty linked-worktree groups first (by each group's latest update), then the current workspace; each group is ordered by most recent update.
- Separator labels are plain text (`Worktree · …` / `Current workspace · …`); session rows use `$(git-branch)` for linked worktrees and `$(comment-discussion)` for the current workspace.
- Each Session item includes its worktree label in a searchable `label`, `description`, or `detail`, in addition to title, prompt preview, time, and path.
- Native `createQuickPick` search matches `label`, `description`, and `detail` across all groups.
- **Browse for a session file…** accepts a JSONL only when its header `cwd` matches an allowed Session working directory.
- Selecting a JSONL already represented in FrostPi activates the existing runtime rather than creating a duplicate.

### Open Session display

For a Session outside the currently open workspace folders:

- the Session list and header show the directory name as a compact capsule on the secondary status line;
- runtime status remains beside that capsule;
- the complete `cwd` is available as a tooltip.

Sessions in an open workspace folder retain the existing status-only text. Existing responsive behavior remains: secondary header text may be hidden below 430 px.

## Removed worktrees and Git failures

FrostPi does not watch `.git`, poll Git, or interrupt a running Pi process when a worktree changes.

At extension initialization, persisted external Session records are reconciled against the worktrees of all open workspace folders:

- cleanup occurs only after the required Git queries succeed and establish that the directory is no longer authorized;
- cleanup removes FrostPi metadata only and never deletes Pi JSONL;
- startup cleanup is silent in the UI and records a diagnostic message without prompt or response content;
- if any required Git query fails, uncertain records are retained.

Before starting or restarting a stopped external Session, FrostPi queries again:

- if successful discovery confirms removal, FrostPi removes the record and shows one warning;
- if Git cannot establish the boundary, FrostPi retains the record but does not start it;
- a running Session is never stopped automatically because of a later worktree change.

New and Resume fall back to current-workspace behavior when Git worktree discovery fails.

## Architecture

A new extension-host module owns Session working-directory discovery. It hides:

- Git process execution and porcelain parsing;
- path normalization and equality;
- valid worktree filtering;
- nested workspace-directory mapping;
- display metadata needed by native pickers;
- the anchor workspace folder whose resource-scoped FrostPi configuration applies to an external runtime.

The module is stateless. One user operation shares one discovery result; no worktree list is persisted or continuously cached.

Dependency direction:

```text
SessionRegistry ─┬→ Session working-directory discovery → Git
                 └→ SessionCatalog → Pi JSONL filesystem data
```

Responsibilities:

- `SessionRegistry`: operation timing, native directory selection, authorization before process start, persistence reconciliation, and runtime lifecycle.
- Session working-directory discovery module: Git and path policy only; no Pi JSONL scanning and no Webview behavior.
- `SessionCatalog.ts`: resolve storage roots for supplied directories, scan/read Pi JSONL, enforce the supplied directory boundary, and build the Resume picker.
- Webview: render host-projected location labels; do not discover worktrees or submit `cwd`.

The existing persisted Session schema remains unchanged: `id`, title, `cwd`, optional `sessionFile`, and update time. Worktree branch names and worktree lists are not persisted.

## Non-goals

- Create, remove, prune, repair, or checkout Git worktrees.
- Authorize arbitrary external directories.
- Aggregate New or Resume across all repositories in a multi-root workspace.
- Add a collapsible tree or custom Webview Resume browser.
- Move, copy, modify, or delete Pi session JSONL.
- Add Git filesystem listeners, polling, a stateful manager, or a global process lock.
- Resolve unusual symbolic-link aliases beyond the project's existing normalized path semantics.

## Verification

Behavior-oriented tests must cover:

1. porcelain parsing for branch, detached, locked, bare, and `prunable` entries;
2. root workspace and nested workspace mapping, including a missing mapped directory;
3. Git failure fallback without authorizing an external path;
4. per-worktree Session-root resolution and deduplication;
5. discovery filtering and grouped ordering across worktrees;
6. Browse rejection for a JSONL outside the allowed directory set;
7. New bypassing the picker for one directory and selecting an explicit worktree when several exist;
8. persisted-record cleanup only after authoritative discovery, without deleting JSONL;
9. stopped external Session validation before start and no interruption of a running Session;
10. projected directory labels for external Sessions without changing the persistence schema.

Run `pnpm check` after focused tests. Manually verify VS Code light, dark, and high-contrast themes at 280, 320, 430 px, and a normal panel width.

## Retirement

This document is temporary. Before merge, transfer durable behavior into `apps/vscode/src/extension/sessions/session-lifecycle.SPEC.md`, `apps/vscode/src/extension/sessions/session-catalog.SPEC.md`, and `docs/design/ui-spec.md`, then remove this file.
