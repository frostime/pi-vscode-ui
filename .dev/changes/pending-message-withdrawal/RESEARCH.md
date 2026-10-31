# Issue #10: pending-message withdrawal research

Status: initial product scope and interactive prototype accepted. Following the user's delegation to consolidate the plan, the current draft keeps actual conversation accuracy but does not internalize exact Pi queue-display synchronization during recovery races. The scoped route was replayed over the existing traces; production withdrawal UI, RPC helpers and runtime capability are still not implemented. Original request: https://github.com/frostime/pi-vscode-ui/issues/10.

Start with `.dev/changes/pending-message-withdrawal/pending-message-withdrawal.TARGET-SPEC.md` for goals, accepted boundaries and acceptance criteria. The implementation-shape draft is `.dev/changes/pending-message-withdrawal/pending-message-withdrawal.SHAPE.md`; it predicts the diff around the agreed `QueuedPromptRecovery` class and records the unresolved late-user-event projection rule. The user approved the consolidated scope and implementation. SHAPE is now locked; `pending-message-withdrawal.PLAN.md` owns execution status. This is not a request for the user to choose private queue mechanisms. This research file supplies evidence, not a separate product contract.

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

## Post-recovery projection spike (FrostPi a359994)

Four real Pi 1.4.0 RPC scenarios were captured: selected old input followed by different new input; selected old input followed by same-text new input with an image; selected old input without new input; and a control where clearing really removed the old input before selection. All children used the isolated synthetic provider and exited 0 with zero network attempts. No abort or installed-runtime patch was used.

The selected-message scenarios held a public `turn_start` extension hook after compaction completed. Both recovery and the new submission occurred with `isCompacting:false`, `isStreaming:true`; simply disabling recovery during compaction would not exclude this case. A file barrier made this valid async-hook interleaving deterministic; it is not a claim about its frequency with ordinary extensions.

Each real trace was replayed through the current production `ConversationProjection` source and disposable candidate variants. The variants were generated under ignored `tmp/`; production source was not modified. Three results matter:

| Route | Observed result |
| --- | --- |
| Current local FIFO promotion | The late old event consumes the new bubble and displays the new text/images as the old delivery. Without a new bubble, the old user input can be absent until a persisted refresh. |
| Render post-recovery user turns from actual events; stop borrowing queued content | Correct user text/images in all four captured scenarios, including incremental persisted reconciliation. This alone leaves already-delivered new bubbles stale, so it is only a partial route. |
| Actual-event rendering plus blind synchronization from runtime queue counts | Works for the different-text and control cases, but removes the same-text new bubble too early because Pi itself reports an empty display queue. Ruled out as an exact membership solution. |
| Actual-event rendering with existing local FIFO bookkeeping | Follow-up replay preserved correct text/images at every checkpoint and correct ordinary clear/resubmit behavior. Late-event scenarios still clear a new bubble early, and are reported as such; the four captured runs converged at settled. This is evidence for the bounded content route, not exact queue synchronization or universal convergence. |

The same-text case exposed an upstream boundary distinct from FrostPi's FIFO bug:

```text
old A has been selected but not emitted
→ clear_queue returns A
→ new B with the same text, but a new image, is admitted after compaction
→ A emits; Pi's text-matched bookkeeping removes B from its display list
→ get_state.pendingMessageCount == 0
→ releasing the current synthetic response still causes B to emit in the next request
```

The image distinguishes B from A in the actual events; this is not inferred from matching text/timestamps. Pi's actual queue still contained B while its display queue said zero. Source: installed `dist/core/agent-session.js:729-749` searches the display arrays with `indexOf(messageText)` before broadcasting the user event. `queue_update` contains text arrays; `get_state` counts those same arrays, not the selected local batch. Neither is a shared local-prompt identity.

The durable user entry is created only at `message_end`, after broadcasting `message_start` (`agent-session.js:753-772`). Entry ids are independent of text/timestamps. A persisted refresh remains authoritative for conversation history, but does not supply the missing link from a newly queued local bubble to an already emitted user event.

Reproduction: `python -B tmp/queue-recovery-spike/projection-traces.py`, then `node tmp/queue-recovery-spike/projection-replay.mjs`; both exited 0. The assertions require the current failures and candidate limitations to be observable, rather than accepting every route as successful. Disposable outputs: `projection-traces.json`, `projection-results.json`. Earlier iterations also reproduced the gap while compaction was held; the final run specifically moved recovery and resubmission after compaction.

**Current consolidated direction:** the user asked Agent to settle the technical choices under the what-done-means criteria, considering probability, avoidance, understandable failures and lifecycle cost. The draft now selects actual-event content plus existing queue bookkeeping, disables recovery during compaction, and explains that recovery does not guarantee cancellation and resending creates new input. It deliberately excludes exact Pi race-time bubble synchronization, unconfirmed-bubble states, a second queue model and automatic compensation. This is an explicit responsibility decision recorded in TARGET-SPEC, not a claim that the previous exact-sync route passed.

The follow-up `actual-events-existing-fifo` replay asserts correct content, ordinary queue behavior and the continued visibility of residual race-time membership failures in the evidence. No new real RPC launches were needed. It does not verify initial-user/retry/reset integration, OMP, Host/draft handling or the real FrostPi GUI. Those are implementation checks, not grounds for further generic research. There is no natural-use frequency estimate; the async gate proves possibility, and the compaction guard does not cover every long extension hook.

## Accepted initial scope and prototype

The user accepted a conservative first release with a single **restore all pending content** action covering Steer and Queue on both runtimes. Do not add per-message controls or emulate single removal by clearing and re-submitting other messages. The issue explicitly accepts withdraw-all as a fallback to its requested per-bubble controls.

- Pi uses its TUI-equivalent clear-all operation with explicit best-effort feedback, not a guarantee that already-selected input cannot execute. The consolidated draft avoids compaction, preserves actual conversation content, and accepts imperfect race-time pending bubbles rather than adding a compensating state machine.
- OMP removes a bounded snapshot through its first-match operation and restores only confirmed removals. This is multiple requests, not an atomic clear-all; already selected/live-steered inputs remain in the conversation.
- Neither path calls abort. Never retry text-based removal automatically after an ambiguous/lost response: another identical message might be removed.
- Restore into the owning session's Composer, preserve its existing draft, and do not auto-send. The approved interaction combines recovered texts before the current draft with blank lines; it does not reconstruct their individual delivery types on resend.
- Do not silently lose images. OMP restores returned attachments; Pi's first release disables the bulk action when pending inputs include attachments. Oversized/dropped OMP attachment responses still need explicit handling.

Review artifact: `.dev/changes/pending-message-withdrawal/prototype.html` opens directly in a browser. It compares the existing queued bubbles with one group-level Restore all entry, an editable draft, pending feedback, already-consumed content and attachment restrictions. Pi/OMP, light/dark and 300/430/740px controls are prototype scaffolding. All backend outcomes are simulated. The user has approved button placement, draft insertion behavior and feedback treatment. This does not approve any new unconfirmed-queue state proposed after the projection spike.

## Remaining work before implementation is complete

1. Implement the consolidated bounded plan end-to-end in the existing `feat/pending-message-recovery` task branch; do not reopen exact Pi queue synchronization as a prerequisite. Do not create branches for research, prototype, implementation or verification steps.
2. Before promising more than the tested plain-input behavior, cover transformed slash/skill input, image-only messages, OMP live steering, dropped/oversized image responses and an ambiguous/lost response. These cases remain untested; the pending/consumed, duplicate-text, small-image and delayed-admission experiments above do not settle them.
3. Keep submission admission and queue editing ordered in the dedicated `QueuedPromptRecovery` owned by SessionRuntime. The tested prompt acknowledgements give an admission barrier, not a continued-membership guarantee. Recheck the actual selected runtime/version before relying on that contract.
4. Implement actual-event content rendering without borrowing another bubble's text/images, preserve ordinary queue cleanup, and record race-time bubble inaccuracies as the explicit residual limit. Verify mode cleanup through retries, settlement and process termination rather than adding remote queue reconstruction. Test Composer recovery with a newer draft and attachments; Host/draft recovery and actual GUI acceptance remain untested.

FrostPi entry points: `apps/pi-client/src/core/sessions/SessionRuntime.ts:205-259` submits and locally projects pending prompts; `apps/pi-client/src/core/conversation/ConversationProjection.ts` owns local FIFO promotion; `packages/pi-rpc/src/PiRpcApi.ts` currently has no withdrawal helper. Follow `.dev/docs/architecture/omp-compatibility.md` before adding APIs: non-isomorphic queue recovery belongs in product compatibility, not a transport alias that silently promises Pi and OMP mean the same thing.
