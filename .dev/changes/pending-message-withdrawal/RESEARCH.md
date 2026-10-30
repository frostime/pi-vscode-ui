# Issue #10: pending-message withdrawal research

Status: research only. No withdrawal UI, RPC helper or runtime capability has been implemented. Original request: https://github.com/frostime/pi-vscode-ui/issues/10.

## User direction

Investigate Pi TUI's existing dequeue interaction before requiring a new upstream API. FrostPi must also support OMP; prefer conservative behavior and support both runtimes when feasible. Do not substitute Stop/abort for an operation intended to leave the active run running. The issue author accepts a withdraw-all action if reliable per-message withdrawal is unavailable.

## Inspected versions and evidence limits

Installed packages inspected in this session:

- Pi `@earendil-works/pi-coding-agent` **1.4.0**, at `C:/Users/EEG/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent`.
- OMP `@oh-my-pi/pi-coding-agent` **18.12.6**, at `C:/Users/EEG/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent`.

Paths below are relative to those package roots, not the FrostPi workspace. Re-resolve the user's executable/package before implementation: the installed versions are evidence, not a new minimum-version promise. Source inspection establishes the TUI/RPC mechanisms. A provider-free Pi experiment additionally established the drain/clear race below. No real TUI, full RPC withdrawal, provider or GUI acceptance was run.

## The TUI operations are real, but not identical

| | Pi 1.4.0 | OMP 18.12.6 |
| --- | --- | --- |
| TUI dequeue | Takes all steering, then all follow-ups; prepends their text to the existing editor text. Does not abort. | Pops the last pending steering message, otherwise the last pending follow-up; restores that entry to the editor. Does not abort. |
| Non-aborting RPC | `clear_queue` returns `{ steering: string[], followUp: string[] }`. | `remove_queued_message` takes `{ message, queue: "steering" \| "followUp" }`, returns `{ removed, images?, imagesDropped? }`. No `clear_queue` command was found. |
| Identity | No per-message removal ID; returned text can already be expanded/transformed input. | First matching original raw text, then exact chip text. Not an ID; another call can remove another identical message. |
| Images | RPC returns text only. | Removed images can be returned, but successful removal may omit oversized images and set `imagesDropped`. |
| Strong interrupt-and-restore | Not established by this research. | `abort_and_restore_queue` also withdraws undelivered selected messages, but aborts the run, so it does not satisfy this issue's non-interruption requirement. |

Pi references: `dist/modes/interactive/interactive-mode.js:3820-3870` (`clearAllQueues`, `restoreQueuedMessagesToEditor`); `dist/modes/rpc/rpc-mode.js:331`; `dist/core/agent-session.js:1944`. The dequeue key is `app.message.dequeue`; default is Alt+Q on Windows and Alt+Up elsewhere (`dist/core/keybindings.js:58`). The TUI's separate compaction queue is not proof of equivalent RPC support.

OMP references: `src/modes/controllers/input-controller.ts:1633-1660` (`handleDequeue`); `src/session/agent-session.ts:9958-10074` (`takeQueuedMessage`, matcher, `popLastQueuedMessage`); `src/modes/rpc/rpc-mode.ts:1935-1973` (remove and abort/restore handlers), `:703-769` (bounded responses). These commands are also present in shipped `dist/cli.js`.

## Pi's restore result is not a reliable cancellation acknowledgement

Pi tracks display text separately from the agent-core message queues. `AgentSession.clearQueue()` copies and clears those display arrays, then clears the actual agent queues. Normally display text is removed when the corresponding user `message_start` arrives (`dist/core/agent-session.js:729-749`).

The actual agent loop can first drain a queue into its local `pendingMessages`, await `prepareNextTurn`, and only then emit user-message events. Clearing the queue containers cannot retract that already-selected batch (`node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js:98-126,191`; `dist/agent.js:195-206` in that same package).

A minimal experiment used the installed real `Agent` loop, a synthetic response stream, and the installed `AgentSession.prototype.clearQueue` with an isolated session bookkeeping receiver. It queued `withdraw-me` during the first fake response, then cleared at `prepareNextTurn`, before the queued user message emitted:

```text
before clear: agentHasQueuedMessages=false, sessionTracked=["withdraw-me"]
clear returned: {"steering":["withdraw-me"],"followUp":[]}
later delivered user messages: ["initial","withdraw-me"]
```

This is a component-level race reproduction, not a full Session/RPC test. It explains how ordinary TUI dequeue can genuinely remove still-pending inputs while its returned text is not proof that every restored input will be suppressed. Do not report confirmed cancellation solely because Pi returned its text.

OMP's ordinary removal selects actual pending queues and returns `removed:false` when no match remains. Its displayed steering list can also include already live-steered messages (`getQueuedMessages`, `src/session/agent-session.ts:9920-9930`); they are not removable through `takeQueuedMessage`. Its interrupt path explicitly handles undelivered selected batches, unlike ordinary removal (`src/session/agent-session.ts:9876`; sibling `pi-agent-core/src/agent.ts:1119`).

## Conservative candidates, not accepted implementation

**Do not implement cross-runtime per-bubble withdrawal by clearing and re-submitting other messages.** That changes timing and can rerun input hooks, templates or commands. Neither inspected runtime offers shared per-ID withdrawal semantics.

The smallest candidate is a single **recover pending text** action, explicitly best-effort rather than a guarantee that recovered text will not execute:

- Pi uses its TUI-equivalent clear-all operation.
- OMP removes a bounded snapshot of pending user inputs through its first-match operation, without re-submitting untouched messages. This is multiple requests, not an atomic clear-all; already selected/live-steered inputs can remain.
- Neither path calls abort. Never retry text-based removal automatically after an ambiguous/lost response: another identical message might be removed.
- Do not silently overwrite a newer Composer draft, drop attachments, or label an unconfirmed removal successful. Pi image recovery needs a demonstrated local-to-runtime correlation; the current RPC text result alone cannot supply that.

Alternatively, expose different explicit capabilities: OMP can offer confirmed first-match removal, while Pi offers best-effort recover-all. This preserves the stronger OMP result but adds product/UI asymmetry. If the product instead requires the original issue's strict per-message success/failure contract for both runtimes, Pi needs a stronger queue boundary/API and OMP still needs an identity policy for duplicate text.

## Before selecting or implementing a candidate

1. Decide whether TUI-level best-effort recovery is an acceptable user-visible operation. The user requested conservative research, not approval of this weaker guarantee or an attachment-dropping policy.
2. Run isolated, provider-free RPC experiments against both selected executables. Test pending versus already-drained input, transformed/duplicate text, image-only messages and a lost response. No real user session or credentials are needed.
3. Establish admission ordering. Both runtimes admit input asynchronously; ordinary prompt acknowledgement is not a universal proof that an input is in a cancellable queue. Test delayed admission followed by removal, including OMP's background ordered-input dispatch (`src/modes/rpc/rpc-mode.ts:435-494,1764`).
4. Test FrostPi reconciliation when a recovered Pi message subsequently emits a user event. It must not consume a different newly queued local bubble or imply the message never ran. Test Composer recovery with a newer draft and attachments.

FrostPi entry points: `apps/pi-client/src/core/sessions/SessionRuntime.ts:205-259` submits and locally projects pending prompts; `apps/pi-client/src/core/conversation/ConversationProjection.ts` owns local FIFO promotion; `packages/pi-rpc/src/PiRpcApi.ts` currently has no withdrawal helper. Follow `.dev/docs/architecture/omp-compatibility.md` before adding APIs: non-isomorphic queue recovery belongs in product compatibility, not a transport alias that silently promises Pi and OMP mean the same thing.
