---
title: Troubleshooting
description: Current recovery steps for startup, history, discovery, proxy, mentions, editor, and diff failures.
scope:
  - /apps/vscode/**
updated: 2026-07-28
---

# Troubleshooting

- **Pi executable/startup:** Open FrostPi Output and export diagnostics. Verify `pi --mode rpc` in the same local/remote workspace environment. For a configured JavaScript entry point, verify `node` on `PATH`, update `frostpi.pi.executable`, and retry.

- **Restored session/history:** FrostPi never substitutes an empty session for a missing or corrupt file. Repair it outside FrostPi or close the UI session. If only history failed, use retry/load; the live process may remain usable.

- **Stale commands/models:** Use the relevant picker refresh action. FrostPi loads both after startup and refreshes commands after settled turns because Pi extensions may register them dynamically.

- **Proxy changes:** Settings apply only at process start. Restart the affected session; its Pi session file is reused, but active streams, tools, and pending extension UI cannot survive.

- **Existing-session discovery:** Roots are filtered by JSONL `cwd` to the active workspace or allowed worktree; relative `sessionDir` resolves from that directory. Browse for non-standard storage, and open another project's owning folder before resuming it.

- **Workspace mention search:** Check Output and ensure `fd` is on `PATH` or in Pi's managed bin. Review `files.exclude`, `search.exclude`, and `frostpi.composer.fileMentions.*`; old fd versions omit directory rows. Mentions inject no file content.

- **External editor:** `/editor` allows one temporary Markdown tab at a time. Close it to return disk text to its owning Composer; Save keeps edits, Don't Save keeps the last saved or prefilled text. Re-running the command reveals the existing tab.

- **Diff/file reference:** Diff requires an open-worktree file present in Git `HEAD`; open untracked files directly. References resolve from the active session cwd, so verify the path and line still exist.
