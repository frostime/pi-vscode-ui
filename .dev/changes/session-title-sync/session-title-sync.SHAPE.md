---
status: locked
---

# Session Title Sync — Change Shape

**Change:** the Session title follows Pi's own renames (live event), and records still holding a placeholder title adopt the name already stored in their Pi session file at startup.

**Why this shape:** both halves are driven by the same fact — FrostPi keeps the title in its own record and Pi already owns the real name. The live half is one event case in the module that owns the title scalar; the repair half extends a startup function that already reads Pi session files for exactly this purpose. Registry persistence, sidebar refresh and the Desktop bridge need no change: they already react to a title change.

## 1. Visual Shape

### A. Spatial Diff Tree

```text
apps/pi-client/
├── src/core/sessions/
│   └── SessionViewState.ts        modify  +3/-0       one event case adopts Pi's session name; additive
├── src/host/
│   └── SessionRegistry.ts         modify  +8/-5       startup repair also adopts names for placeholder titles
└── test/unit/
    └── SessionViewState.test.ts   modify  +12–18/-0   regression: the event updates the title
```

No new module, no interface change, no dependency-direction change. Desktop and VS Code need no edit.

### B. Two data owners, one direction

```text
Pi session file (.jsonl)                 FrostPi record (frostpi.sessions.v1)
  session_info.name = "26-11-14T17:48_…"   title = "New session"
        │                                        ▲
        │  (1) live: session_info_changed        │
        ├────────────────────────────────────────┤
        │  (2) startup: readPiSessionMetadata    │
        └────────────────────────────────────────┘
```

FrostPi never writes into the JSONL. Both halves only move Pi's name into the record; the arrow never points left.

Evidence that records are the display source and that syncing works when a process starts (`C:\Users\EEG\AppData\Roaming\FrostPi-Dev\state.json`):

```json
"frostpi.sessions.v1": { "sessions": [
  { "title": "26-11-13T23:05_FrostPi项目初始问候", "sessionFile": "...2026-11-13T14-59-13-925Z_….jsonl" },
  { "title": "26-11-14T22:34_问候并说明工作目录",   "sessionFile": "...2026-11-14T14-33-16-818Z_….jsonl" }
] }
```

### C. Control flow diffs

Live half — `SessionViewState.applyEvent`:

```diff
  switch (event.type) {
    case "agent_start": ... break;
    case "agent_settled": ... break;
+   case "session_info_changed":
+     if (typeof event.name === "string" && event.name) this.setTitle(event.name);
+     break;
    default:
      return;
  }
```

`typeof` is needed because `RpcEvent` has an open index signature. The truthiness test mirrors `applyState`'s sticky rule (`if (state.sessionName)`): the title moves only when Pi reports a name. Pi's "cleared" signal arrives as an absent `name`; mapping that to `setTitle("")` would display `Untitled session`, a state no FrostPi UI can currently produce and one a later sticky `applyState` would never undo.

Repair half — `SessionRegistry.#repairGeneratedTitles` (renamed, see guardrails):

```diff
- if (!record.sessionFile || !looksLikeGeneratedSessionName(record.title)) continue;
+ if (!record.sessionFile || !isPlaceholderSessionTitle(record.title)) continue;
  const metadata = await readPiSessionMetadata(record.sessionFile);
  const title = metadata?.title && !looksLikeGeneratedSessionName(metadata.title)
    ? metadata.title
-   : "New session";
+   : NEW_SESSION_TITLE;
+ if (title === record.title) continue;
  record.title = title;
  this.#runtimes.get(record.id)?.setDisplayTitle(title);
  changed = true;

// new
function isPlaceholderSessionTitle(value: string): boolean {
  return value === NEW_SESSION_TITLE || looksLikeGeneratedSessionName(value);
}
```

Placeholder titles have exactly two sources, and after this change both are covered:

| Source | Before | After |
|---|---|---|
| Resume of an unnamed session: catalog falls back to `basename(path, ".jsonl")` | matched | matched |
| Session created in this app: record seeded with `"New session"` | not matched | matched |

### Why not the neighbouring owners

| Owner | Cost | Verdict |
|---|---|---|
| `SessionViewState.applyEvent` (live half) | +3 lines, no runtime edit | The class already writes this scalar in `applyState`; the title keeps one owner. |
| `SessionRuntime.#applyConnectionEvent` | +4 lines, a second title writer with a second rule | Rejected: spreads title ownership across two files for no behavioural gain. |
| Delayed second `get_state` after settle | +8–15 lines, timer, guessed delay | Rejected: the rename latency is a model call, so any delay is a guess. |
| Repair on session activation only (do nothing at startup) | 0 lines | Rejected by you: stale records would need a click each. |

## 2. Implementation Guardrails

- **One title owner, one precedence rule.** The event case writes through `SessionViewState.setTitle` and accepts only a non-empty string, exactly like `applyState`. Do not add a title field to `SessionRegistry` or `SessionRuntime`.
- **Keep `applyState`'s `if (state.sessionName)` guard.** A snapshot reporting no name must not erase a name that arrived by event.
- **`changed` must mean "changed".** Compare before assigning in the repair loop; the widened predicate now matches records that will not change, and the current code sets `changed = true` unconditionally, which would rewrite the memento on every startup.
- **Rename the repair to match its contract.** `#repairGeneratedTitles` → `#repairPlaceholderTitles` (definition + its one call site in `ensureInitialSession`), because the function now also repairs FrostPi's own placeholder. Skip this if you would rather keep the diff to predicate logic only.
- **One literal for the placeholder.** Introduce `NEW_SESSION_TITLE = "New session"` and use it in the predicate and at the create path (`SessionRegistry.ts:288`), so the two sites cannot drift.
- **No new polling, timer, or session-file watcher.** Pi emits the signal; a live JSONL read would be a second, slower source of truth.
- **The event needs no runtime plumbing.** `connection.onEvent` calls `#applyConnectionEvent` and then `#notifyChange()` unconditionally, `#applyConnectionEvent` forwards non-extension-UI events to `viewState.applyEvent`, and `#handleRuntimeChange` turns a title change into a persisted record plus a sidebar snapshot.
- **No dialect or protocol type change.** `ohMyPiRpcDialect.normalizeEvent` rewrites only `session_settled` and `available_commands_update` and passes everything else through, so an OMP process that never emits `session_info_changed` keeps today's behaviour. `RpcEvent`'s index signature makes a dedicated type in `packages/pi-rpc` unnecessary.
- **Do not touch Desktop or VS Code code**, the bridge DTO, or `SessionPersistence`.
- **Accepted limitation (do not defend against it):** a `get_state` response already in flight when the rename lands can carry the previous non-empty name and momentarily restore it. The window is one request on an ordered connection, and the `applyState` guard keeps the common case (`undefined`) harmless.
- **Verification:** `pnpm --dir apps/pi-client exec vitest run test/unit/SessionViewState.test.ts`, plus the affected package checks (`pnpm --dir apps/pi-client exec vitest run`, typecheck). Manual Desktop check, in this order: (1) `/rename:manual "x"` in a live session updates the sidebar without restart; (2) restart the app and confirm the placeholder records adopt their file names; (3) a session that was never named still reads `New session`.

## 3. Open Decision

1. **Contract documentation.** This change makes Pi's session name the third writer of the title (`applyState`, extension-UI `setTitle`, now `session_info_changed`), so precedence becomes "last writer wins" with Pi's name eventually authoritative. `apps/pi-client/src/host/session-lifecycle.SPEC.md` currently says nothing about title ownership, so no existing statement becomes false. Making it explicit is one sentence there (`modify +1–2`).
   - Question: record this contract, or leave it in the test only?

## 4. Not Covered

- The repair half has no automated test. Covering it needs a registry-level fixture with a real `.jsonl` (≈+30–40 lines) plus a code path that only runs at startup; the behaviour is instead verified by step (2) of the manual check. Say if you want that test anyway.
