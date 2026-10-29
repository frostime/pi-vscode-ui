---
title: Troubleshooting
description: Choose a recovery action for runtime, discovery, search and editor failures without changing session authority.
scope:
  - /apps/**
updated: 2026-10-29
---

# Troubleshooting

Check the environment that actually hosts Pi: the workspace Extension Host for VS Code (possibly remote), or the local Desktop Node backend for Desktop. A command working in a different terminal does not prove it is available there.

VS Code provides FrostPi Output and diagnostic export. Desktop does not provide those IDE surfaces; use its visible startup/settings errors and an isolated development reproduction when needed. Native smoke and diagnostic evidence are described in `.dev/docs/testing.md`.

| Symptom | Applies to | Check or recovery |
|---|---|---|
| Pi does not start | Both products | Verify the configured executable and `pi --mode rpc` in the actual Host environment. A `.js`/`.mjs`/`.cjs` entry also needs `node` on that environment's PATH. Desktop's GUI launch PATH can differ from a development shell; inspect the explicit executable setting rather than relying on shell aliases |
| A restored Session cannot load | Both | If only history failed, use retry/load; the child may still be live. A missing/corrupt/incompatible file needs external repair or closing the FrostPi entry, not an empty replacement under the same identity |
| Commands or models look stale | Both, subject to runtime support | Refresh the relevant picker. Extensions may register commands dynamically; cached startup metadata is not the complete runtime surface |
| Desktop still shows the previous UI after a build | Desktop | The executable embeds the renderer, so a JS-only rebuild (`node scripts/build.mjs --scope desktop`) leaves the existing exe unchanged. Run a complete Desktop build (`pnpm build:desktop` or `pnpm --dir apps/desktop build`) before `start` or GUI smoke; `start` only launches an existing exe |
| Proxy edit appears ineffective | Both | Explicitly restart the affected Pi. Process proxy changes do not alter an existing child; active work and pending input cannot survive that restart |
| A saved Session is absent from Resume | Both | Check the allowed directory/worktree and session-directory settings. Browse handles non-standard storage; a file outside the allowed set requires opening its owning directory, not changing an existing Pi's cwd |
| File/directory mentions are missing | Shared Composer; inspect tools in its Host | Check `fd` on PATH or in Pi's managed bin, exclusions and `frostpi.composer.fileMentions.*`. Older fd versions can omit directory rows. Mentions select paths, not injected file contents |
| `/editor` seems to do nothing | VS Code | It reveals the existing temporary Markdown tab when one is already open. Closing returns its disk text to the owning Composer; Save keeps edits, while Don't Save keeps the last saved/prefilled text |
| Diff or file reference cannot open | VS Code | Diff needs an open-worktree file tracked in Git HEAD; open untracked files directly. References resolve from the originating Session cwd, not a later Project selection. Check that the target and location still exist |

Desktop deliberately leaves unsupported editor/diagnostic operations unavailable. Missing IDE affordances there are not evidence that the shared conversation failed; adding an alternative is a product decision, not a reason to return success from an empty adapter.

## When the simple checks do not explain it

Use `.dev/docs/feature-map.md` to locate the owner, then read the relevant contract before changing behavior:

- `apps/pi-client/src/host/catalog/session-catalog.SPEC.md` defines discovery roots, bounded metadata and Browse authorization.
- `apps/pi-client/src/host/session-lifecycle.SPEC.md` defines startup/history failure and recovery.
- `apps/pi-client/src/ui/features/composer/composer.SPEC.md` and the native file-mention/proxy SPECs define editor, search and environment behavior.
- `apps/desktop/SPEC.md` defines settings/state-file error handling and normal reopen.

Keep reproductions in temporary Projects/profiles. Do not repair a test by resetting user state, rewriting Pi history, stopping unrelated processes or bypassing the IDE updater. Log versions, status and safe paths/counts rather than prompts, responses or credentials.
