# Issue #10: pending-message withdrawal research

Status: research only. No withdrawal UI, RPC helper or runtime capability has been implemented. Original request: https://github.com/frostime/pi-vscode-ui/issues/10.

## User direction

Investigate Pi TUI's existing dequeue interaction before requiring a new upstream API. FrostPi must also support OMP; prefer conservative behavior and support both runtimes when feasible. Do not substitute Stop/abort for an operation intended to leave the active run running. The issue author accepts a withdraw-all action if reliable per-message withdrawal is unavailable.

## Inspected versions and evidence limits

Installed packages inspected in this session:

- Pi `@earendil-works/pi-coding-agent` **1.4.0**, at `C:/Users/EEG/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent`.
- OMP `@oh-my-pi/pi-coding-agent` **18.12.6**, at `C:/Users/EEG/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent`.

Paths below are relative to those package roots, not the FrostPi workspace. Re-resolve the user's executable/package before implementation: the installed versions are evidence, not a new minimum-version promise. Source inspection establishes the TUI mechanisms. On 2026-10-31, real RPC subprocess experiments against both installed executables used synthetic provider streams, isolated agent/home/session directories and network-API guards. They confirmed pending withdrawal and the Pi drain/clear race below. No external model, real-account, TUI or FrostPi GUI acceptance was run. FrostPi was at `0f2889f`; product source was unchanged during the experiments.

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

That initial experiment covered the component boundary. The later real-RPC compaction experiment below reproduced the same behavior without patching the installed runtime. Ordinary TUI dequeue can genuinely remove still-pending inputs, but its returned text is not proof that every restored input will be suppressed. Do not report confirmed cancellation solely because Pi returned its text.

OMP's ordinary removal selects actual pending queues and returns `removed:false` when no match remains. Its displayed steering list can also include already live-steered messages (`getQueuedMessages`, `src/session/agent-session.ts:9920-9930`); they are not removable through `takeQueuedMessage`. Its interrupt path explicitly handles undelivered selected batches, unlike ordinary removal (`src/session/agent-session.ts:9876`; sibling `pi-agent-core/src/agent.ts:1119`).

## Real RPC experiment results

The fixture registered a synthetic provider through the public extension API. Each synthetic assistant stream waited for an explicit file barrier, so the parent could edit queues during an active turn. Both runtimes were checked to use that synthetic API before any prompt. No fixture sent `abort`; both children exited normally. Network guards recorded zero attempted calls for Pi and 12 blocked startup network-API calls per OMP launch. These counts do not represent external model requests.

| Experiment | Observed result |
| --- | --- |
| Pi, held assistant stream; 2 duplicate Steers and 2 Queue inputs, one with an image | `clear_queue` returned all four texts and no image data. After releasing the assistant, only the initial user input appeared and only one synthetic model request ran. The run remained streaming until explicitly released. |
| OMP, same pending inputs | Removing the image input returned `removed:true` and one image, with no `imagesDropped`. Three sequential removals of the duplicate text returned `true`, `true`, `false`. The untouched follow-up still executed in its original queue; removing it after consumption returned `false`. Two synthetic requests ran, without interruption. |
| Pi and OMP, async `input` hook held before enqueue | A concurrent clear/remove found nothing. Neither runtime had acknowledged that prompt yet. Releasing preprocessing produced the queue update and prompt acknowledgement; subsequent removal succeeded and the delayed input never executed. |
| Pi, queued Steer already selected, next-turn auto-compaction held in `session_before_compact` | Before any user event for the selected Steer, `clear_queue` returned its text. Releasing compaction then emitted that user message and started the third synthetic model request. Clearing did not suppress the selected message. |

The compaction scenario seeded one completed turn, made the next synthetic assistant report threshold-crossing usage, and held the ordinary extension compaction hook. It supplied a synthetic summary when released; no summary model was called. This reached the installed session's real `prepareNextTurn`/RPC boundary, rather than invoking `clearQueue` from inside an agent test callback.

**Admission conclusion:** for the tested plain-prompt paths, both installed versions acknowledge after input admission. OMP source explicitly awaits `dispatchOrderedUserInput` before responding (`src/modes/rpc/rpc-mode.ts:1904-1927`, comment “Ack after admission”). Earlier investigation described OMP's background dispatch too broadly; it does not mean this prompt response precedes admission. FrostPi can wait for its outstanding same-session submissions before requesting withdrawal, without waiting for the active agent turn to finish. Acknowledgement still does not prove a message remains queued: consumption or input handling can intervene.

Disposable fixture sources and summaries remain under ignored `tmp/queue-recovery-spike/`. The successful commands were `python tmp/queue-recovery-spike/run.py`, `python tmp/queue-recovery-spike/admission.py`, and `python tmp/queue-recovery-spike/pi-compaction-race.py`; each exited 0. These local paths are experiment evidence, not a maintained test suite or installed-runtime compatibility promise.

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
2. Before promising more than the tested plain-input behavior, cover transformed slash/skill input, image-only messages, OMP live steering, dropped/oversized image responses and an ambiguous/lost response. These cases remain untested; the pending/consumed, duplicate-text, small-image and delayed-admission experiments above do not settle them.
3. Keep submission admission and queue editing ordered within the owning SessionRuntime. The tested prompt acknowledgements give an admission barrier, not a continued-membership guarantee. Recheck the actual selected runtime/version before relying on that contract.
4. Test FrostPi reconciliation when a recovered Pi message subsequently emits a user event. It must not consume a different newly queued local bubble or imply the message never ran. Test Composer recovery with a newer draft and attachments. The real RPC tests exercised runtimes directly, not FrostPi's local projection or draft recovery.

FrostPi entry points: `apps/pi-client/src/core/sessions/SessionRuntime.ts:205-259` submits and locally projects pending prompts; `apps/pi-client/src/core/conversation/ConversationProjection.ts` owns local FIFO promotion; `packages/pi-rpc/src/PiRpcApi.ts` currently has no withdrawal helper. Follow `.dev/docs/architecture/omp-compatibility.md` before adding APIs: non-isomorphic queue recovery belongs in product compatibility, not a transport alias that silently promises Pi and OMP mean the same thing.
