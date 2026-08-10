---
title: Complete Pi 0.84 Message Streaming Compatibility
created: 2026-08-09T15:45:41+08:00
branch: fix/pi-084-compatible
baseline: 4ca541b
---

# Assume Reader

You are a fresh coding agent in the FrostPi repository with no access to the conversation that produced this task. The repository, current Git state, and files under `changes/pi-084-compatibility/` are available to you.

# Operating Instruction

The requirements and architecture have already been reviewed with the user. **Treat the preset solution as correct and execute it directly. Do not restart broad research or reopen settled choices.** If implementation evidence reveals a real correctness problem, contract conflict, or necessary scope change, stop, show the evidence to the user, and discuss it before changing direction.

# Start by Reviewing and Committing the Shaped Checkpoint

Expected branch and baseline:

```text
fix/pi-084-compatible
4ca541b 📝 docs(changes): specify Pi 0.84 streaming compatibility
```

There are staged shape changes plus this untracked prompt. Before further edits:

1. Run `git status --short`, `git diff --cached`, and `git diff`.
2. Read and understand the existing uncommitted changes.
3. Read these sources in order:
   - `changes/pi-084-compatibility/pi-084-message-streaming.SPEC.md` — requirements and external behavior;
   - `changes/pi-084-compatibility/pi-084-message-streaming.LAND.md` — approved code shape and boundaries;
   - `changes/pi-084-compatibility/pi-084-message-streaming.MAP.md` — code navigation.
4. Locate the shaped waypoints:

   ```bash
   rg 'pi-084-message-streaming::shape'
   ```

5. Verify the checkpoint:

   ```bash
   pnpm --dir apps/vscode typecheck
   pnpm --dir apps/vscode exec vitest run \
     test/unit/ConversationProjection.test.ts \
     test/unit/ConversationItemStore.test.ts \
     test/unit/SessionRuntime.test.ts \
     test/unit/PiAssistantMessageAdapter.test.ts
   ```

   Expected result when handed over: typecheck passes; 41 tests pass and 11 tests are TODO.

6. Add this prompt and commit the reviewed shape before implementing the feature. Suggested message:

   ```text
   ♻️ refactor(vscode): shape Pi assistant message adapter
   ```

`PiAssistantMessageAdapter.adapt()` currently throws deliberately but has no production caller. `reset()` is harmless. Do not wire `adapt()` into production until its behavior is implemented and tested.

# Task

Complete the behavior in the SPEC. FrostPi must support both:

- Pi 0.83 cumulative `message_update.message` events;
- Pi 0.84 delta-only updates addressed by `contentIndex`.

Restoring only the final response is insufficient. Preserve live text, thinking, the preparing-tool parameter stream, one stable tool card, retry/error/abort behavior, and persisted-history takeover.

# Preset Architecture

`PiAssistantMessageAdapter` is a **version adapter** owned by `ConversationProjection`; indexed assembly is how it performs adaptation.

```text
Pi raw event
   ↓
ConversationProjection
   ├── PiAssistantMessageAdapter  — Pi 0.83/0.84 differences and active message assembly
   └── ConversationItemStore      — page location, takeover, real tool-ID lookup
   ↓
shared model                      — Host/Webview data contract
   ↓
Svelte                            — rendering and local expansion state
```

Maintain these boundaries:

- Adapter: complete-message precedence, indexed parts, malformed-delta handling, reset.
- Projection: turn/status/retry/abort/persisted-entry policy and activity construction.
- Store: stable locations, ordering, takeover, real tool lookup, unresolved-tool cancellation.
- Svelte: render prepared shared data; never interpret Pi events.
- `packages/pi-rpc`: raw transport only; production code should remain unchanged.

Do not move adapter state into Runtime, Store, or Svelte, and do not synthesize old RPC events.

# Critical Rules

The SPEC is authoritative. In particular:

- A valid complete `event.message` wins; do not append its delta again.
- Assemble text, thinking, and tools by `contentIndex`; end events replace temporary part content.
- A preparing tool has raw arguments but **no fabricated Pi tool ID**.
- `toolcall_end` binds the real tool to the same outer activity; `tool_execution_*` then updates that location by real ID.
- Outer activity identity is assistant view ID plus source `contentIndex`, not `toolCall.id`.
- Live and persisted messages use the same content-index-aware activity construction so takeover preserves identity.
- `message_end.message` replaces the live preview; persisted `get_entries` remains higher priority than delayed live events.
- Malformed/unknown/out-of-order deltas are silently ignored, while valid `message_end` still works without a start.
- Stop/failure before binding keeps the preparing card, marks it `cancelled`, and preserves received raw arguments.
- Replacement start, end, settle, complete turn, history replacement, stop/failure, and restart cannot leak partial state.

# Execution Path

Follow LAND and the shaped markers rather than inventing a new structure:

1. Implement `PiAssistantMessageAdapter` and replace its TODOs with behavior tests.
2. Wire Projection through the adapter; then remove legacy streaming ID/key fields instead of maintaining parallel state.
3. Change shared tool data to an explicit preparing/bound union.
4. Update Store so preparing tools are visible but absent from real-ID lookup, bind in place, cancel correctly, and preserve notice/order behavior.
5. Update the existing `ToolActivity.svelte`; do not add a second pending-tool component.
6. Extend `fake-pi.cjs` and `SessionRuntime.test.ts` so Pi 0.84 evidence crosses a real child-process/JSONL path into the conversation view.
7. Update the durable SPECs listed in LAND.
8. Remove all `pi-084-message-streaming::shape` markers and complete all accepted TODO tests.

Use `OBSERVATION.md` only when an exact upstream event field needs confirmation. Do not repeat broad release-note or repository research.

# Do Not Expand Scope

Do not add version detection, feature negotiation, a generic reducer/event bus, Webview RPC parsing, rewritten tool execution IDs, throttling, batching, new size limits, unrelated refactors, real Provider credentials, or a real Pi 0.84 binary requirement.

# Stop and Ask the User If

Stop before proceeding if evidence indicates that:

- the pinned Pi event shape is wrong;
- `packages/pi-rpc` production behavior must change;
- stable preparing → bound → persisted identity needs a broader Store redesign;
- adapter state must live outside Projection;
- an existing SPEC conflicts with the requested retry/history/tool behavior;
- the implementation materially exceeds LAND or requires a new architectural mechanism.

Report the evidence, affected behavior, and smallest credible options; do not silently improvise.

# Verification

Use focused tests while implementing, then run:

```bash
pnpm --dir apps/vscode exec vitest run test/unit/PiAssistantMessageAdapter.test.ts
pnpm --dir apps/vscode exec vitest run \
  test/unit/ConversationProjection.test.ts \
  test/unit/ConversationItemStore.test.ts \
  test/unit/SessionRuntime.test.ts
pnpm --dir apps/vscode typecheck
pnpm check
git diff --check
```

Before reporting completion:

- `rg 'pi-084-message-streaming::shape'` returns no implementation markers;
- no accepted compatibility test remains TODO;
- the final diff still matches LAND, or any necessary drift has user approval;
- no prompts, replies, raw tool arguments, credentials, images, or unredacted proxy URLs are logged.
