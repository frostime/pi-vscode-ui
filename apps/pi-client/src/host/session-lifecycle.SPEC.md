---
title: Pi Session Lifecycle
description: Session identity, readiness, commit/recovery and retention boundaries shared across Registry, Runtime and presentations.
scope:
  - /apps/pi-client/src/core/sessions/**
  - /apps/pi-client/src/host/**
  - /apps/vscode/src/extension/webview-host/**
updated: 2026-10-24
---

# Pi Session Lifecycle

Read with `apps/pi-client/src/host/SessionRegistry.ts` for entry/collection lifetime and `apps/pi-client/src/core/sessions/SessionRuntime.ts` for the Pi child and turn lifetime. These lifetimes are not interchangeable: a registered Session may have no live process, a ready process may still be loading history, and a view may disappear while its Pi continues working. The constraints below preserve those distinctions; host adaptation and projection details have their own contracts.

## Identity and execution do not follow presentation

Registry's FrostPi Session id identifies an application entry, not the Pi session id, a transcript entry id or a process instance. Stop and restart retain that application identity. A Runtime may have no child while stopped, but cannot own multiple live children. Pi owns JSONL and conversation persistence; FrostPi must not rewrite those files.

Views are disposable projections, not Runtime owners. Clearing foreground selection or closing a Session Tab does not close the underlying Session. Selection is not universally side-effect-free, however: activating a stopped persistent Session can start it, and switching away can discard an unretained Provisional Session under the policy below. Explicit Close disposes/removes the application entry without deleting Pi-owned history. Close/restart must confirm interruption when the Session is streaming or has pending extension input.

An existing Runtime's cwd and configuration scope must not follow later editor, Project or foreground changes. New/Resume uses a Host-chosen, validated workspace/worktree; the browser cannot supply a cwd. External worktree configuration comes from its authorizing workspace root. Before restoring or starting a stopped external Session, refresh directory authorization: confirmed removal may drop metadata, but failed discovery neither proves removal nor authorizes a start. Directory/alias resolution belongs to `apps/pi-client/src/host/sessions/SessionWorkingDirectories.ts` and the [catalog contract](catalog/session-catalog.SPEC.md).

VS Code's default anchor is the active editor's workspace folder, otherwise the first root; New/Resume does not aggregate unrelated repositories. Desktop Project ownership and selection policy are in `apps/desktop/SPEC.md`. Neither policy creates a second lifecycle or changes an already-running Pi's context.

## Readiness and turn completion

Registry serializes starts and complete-history loads in separate queues. A long history load must not hold up another process's startup, and neither queue serializes agent execution. Concurrent Pi turns remain independent; FrostPi adds no global execution lock or file-write interception.

Process readiness alone is not admission to every operation. Prompt/model actions cannot bypass queued/starting process state. Submission, Fork and tree navigation must not start during compaction even if process status is ready. Compaction progress is transient state, not a new persisted turn; Pi's own summary entries still define durable history boundaries.

History readiness is separate. A resumed process can become ready before its entries are loaded: submission remains blocked during queued/loading history, while Fork and tree navigation require fully loaded entries. Deferred or failed history does not by itself fail the child; large-file loading can wait for explicit user action. The history replacement must preserve concurrent deliveries without losing or duplicating content; `SessionRuntime.#loadHistoryInternal` owns capture/replay mechanics, and the [live-reconciliation contract](../core/conversation/conversation-projection.SPEC.md#live-reconciliation) owns reconciliation.

For agent turns, prompt RPC success means acceptance, not completion. `agent_end` closes an attempt; retries or compaction continuation can still belong to the same user turn. The normalized `agent_settled` event closes that turn. Only a successfully completed, non-aborted agent turn may issue the normal-completion notification, once. Error turns, compaction, history refresh and repeated state updates must not manufacture one. [Tool finalization](../core/conversation/conversation-projection.SPEC.md#unresolved-tool-results) belongs to projection rather than failing a whole Session for every tool error.

Input/failure attention is separate from normal completion: notify on the first pending input or transition into failed state, not every later view update. `SessionRegistry.#showSystemNotification` owns preference/focus gates and native-delivery fallback; do not turn ordinary refreshes into new notification events.

Some runtime commands finish without agent-turn events. Their classification and idle reconciliation are local to `SessionRuntime.#resolveImmediateExtensionCommand` and `#finishImmediateExtensionCommand`. If a known extension command exceeds the prompt deadline while its process remains live, report completion as unconfirmed, not a failed process or proven completion. OMP's per-submission results likewise cannot settle other queued work; its stateful adapter is `apps/pi-client/src/core/sessions/OmpPromptCompatibility.ts`. Command admission and visible invocation rules belong to the [Composer contract](../ui/features/composer/composer.SPEC.md), not transport aliases.

Steer/Queue bubbles are local projections of Pi-owned delivery, not independently cancellable jobs. The current RPC surface has no per-message dequeue/clear operation; removing a bubble cannot claim to cancel Pi-side delivery. Abort, stop and process failure clear the transient queue projection. Promotion/turn ordering follows the [turn-lifecycle contract](../core/conversation/conversation-projection.SPEC.md#turn-lifecycle); keyboard bindings stay in the Composer contract.

Blocking extension input belongs to its Runtime/request, never whichever Session is now visible. Answering, timeout or explicit cancellation resolves it; hiding its UI does not. Abort/stop/restart cancel pending input rather than auto-confirming it. The [extension UI contract](../core/extension-ui/extension-ui.SPEC.md) owns method-specific responses and presentation.

## Committed mutations and recovery

Fork and tree mutation require an idle, fully loaded Session without pending extension input or queued prompts. Targets use stable Pi entry ids and authoritative entries, never message text or browser-supplied history. Capability/preflight failure or cancellation before Pi commits preserves logical identity, history and drafts.

**Fork creates a new application identity.** Pi's successful Fork response is the commit boundary: the live Runtime follows the fork under a new Provisional FrostPi id, while the original id receives a stopped Runtime for its original history. The selected user message is excluded from the copied path; its validated text/images become an editable, one-shot seed, not a new persisted prompt. Presentation placement and draft handling follow the [bridge](../shared/bridge/webview-bridge.SPEC.md#authorization-and-validation) and Composer contracts.

Cancel Fork stops that child and restarts the original so a late response cannot replace recovery. If naming/state/history reconciliation fails after commit, remove the unfinished fork entry and recover the original; leave Pi-created files on disk. Rekeying Registry maps and Runtime identity must not publish a mismatched intermediate view. `SessionRegistry.forkMessage`, `#replaceRuntimeWithFork` and `#restoreOriginalAfterFork` implement this boundary.

**Tree navigation mutates the existing Pi path, not application identity.** After Pi confirms commit, its path is authoritative. Rebuild entries/state under the same Runtime and JSONL; a later load/projection failure is retryable history failure, not permission to reverse-navigate automatically. Composer replacement and non-empty-draft confirmation follow the Composer seed contract.

## Retention, restoration and shutdown

Provisional and Ephemeral are different policies, not successive states. New non-Ephemeral Sessions are Provisional until their first accepted non-empty prompt or explicit rename; Resume is never Provisional. Automatic fork naming and compaction do not promote it. Provisional entries are visible but excluded from restart metadata. VS Code discards the selected unretained Provisional entry when selecting/creating/resuming another Session; ever opening it in a Session Tab retains it for the rest of its provisional lifetime, including after tab closure. Desktop retains such entries for Project navigation as specified by its product contract. Discarding an entry does not delete Pi files.

An Ephemeral Session uses Pi's no-session mode for its entire lifetime. Prompts/renames cannot make it persistent. Once its process stops or fails, there is no file from which to reconstruct it: explicit and automatic restart reject it, bulk restart skips it, and Fork is unavailable. In-memory tree navigation can remain available while it is live. Closing one containing a user prompt requires an irreversible-loss confirmation.

Per-launch custom arguments are transient Runtime state, distinct from configured `frostpi.pi.arguments`. They may contain credentials and must not enter logs, persisted metadata or diagnostic exports. Restart of that Runtime reuses them; Fork's live Runtime therefore retains them, but the replacement original Runtime and later restored entries do not. Tokenization and argv construction are owned by `apps/pi-client/src/host/sessions/parseLaunchArguments.ts` and `SessionRuntime.#startInternal`, not another option validator.

The shared session index stores metadata, not conversation bodies, drafts/images, credentials, custom launch tokens or derived worktree/authorization caches. Its schema is `apps/pi-client/src/host/sessions/sessionTypes.ts`; `apps/pi-client/src/host/sessions/SessionPersistence.ts` owns serialization. On application startup, restoration recreates only indexed identities, without creating a fresh Session. `frostpi.session.startOnOpen` may start the selected restored entry according to the Host's selection policy; it is not permission to replay prompts or recover in-flight work.

Changed executable/proxy/process configuration applies on a new or explicitly restarted child, not by interrupting an existing turn. Missing, corrupt or incompatible history must fail visibly under the same identity rather than becoming a fresh conversation.

Disposal closes creation/start admission as well as live children: delayed discovery, queued starts and stale lifecycle completions must not create work after shutdown. Stopping runtimes is not proof that metadata writes have drained. A file-backed Host stops runtimes, awaits `SessionRegistry.flushPersistence()`, then flushes/closes its store. Awaited save failures remain observable; fire-and-forget saves report failure without an unhandled rejection. This drains metadata, not agent turns or process snapshots.
