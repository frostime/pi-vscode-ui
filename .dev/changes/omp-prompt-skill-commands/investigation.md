# Bounded OMP Markdown commands and skills

Status: implementation and runtime verification complete; no runtime patch or release/version change.

## Confirmed scope

Support discovered Markdown file commands (`source: file`) and `/skill:<name>`, including ordinary submission and Steer/Queue. OMP retains ownership of discovery, parameter parsing, expansion, and persistence. Do not expose builtin, extension, TypeScript custom, or MCP runtime commands. Host-local actions remain separate.

OMP's separate `prompts/` templates are executable but absent from current RPC discovery. Following discussion, they are deferred, not a blocker for Markdown commands and skills. An earlier recommendation to change upstream or maintain patched OMP was rejected as incompatible with FrostPi's positioning and is withdrawn.

Live bubbles retain the submitted invocation without an expanded-content preview. Restored skill messages use their recorded invocation. Ordinary Markdown command history follows existing Pi behavior: the runtime's persisted user text can already be expanded.

## Runtime evidence

Tested unmodified `@oh-my-pi/pi-coding-agent` 18.4.9 through `omp.exe --mode rpc`, with generated fixtures and separate agent/session directories. A generated model override pointed to a loopback HTTP provider. The execution probes checked the active model URL before submission; no external model was called.

The fixture workspace was under ignored repository `tmp/`, so ancestor resource discovery was not fully isolated. OMP also issued auxiliary skill-description compression requests. The probes distinguished those from actual turn requests by their fixture content; they are not execution evidence.

Initial direct RPC probes established:

- Discovery includes a Markdown command as `file` and a skill as `skill`, but omits an agent `prompts/` template.
- Markdown commands and `prompts/` templates both expand parameters into persisted user messages and provider requests.
- A skill emits live `custom/skill-prompt` messages with user attribution and `details.prompt`, and persists a `custom_message` entry.
- An attached image is absent from the skill provider request.
- Intentional provider HTTP 400 errors produce correlated terminal `prompt_result` frames.

A subsequent real Extension Host smoke probe used a loopback provider returning successful Anthropic SSE frames. It verified:

- Filtered discovery, unsupported-command rejection, and unchanged outbound invocation text.
- Successful Markdown and skill turns, stable persisted user identities, and no expanded skill preview or duplicate custom item.
- Skill Steer-before-Queue delivery during a held provider response, queue removal, and final settlement.
- Reopening the runtime-created fixture session and restoring all five turns, including three original skill invocations.

The smoke probe exercised `SessionRuntime` and the actual OMP child; it did not launch the VS Code Webview or inspect visuals.

Machine-specific disposable probes/results remain in ignored `tmp/omp-prompt-skill-spike/`. Commands:

- `python tmp/omp-prompt-skill-spike/discovery.py`
- `python tmp/omp-prompt-skill-spike/execution.py`
- `pnpm --dir apps/vscode exec vitest run --config ../../tmp/omp-prompt-skill-spike/vitest.config.mts`

A direct-source Bun import experiment failed on a missing `createRatchetPrelude` export in the installed source graph. That setup failure is not runtime evidence; the real CLI probes reached the target boundary.

## Ownership and constraints

- RPC dialect: discovery request/response vocabulary, bounded supported descriptors, collision filtering, and command-update events. Supported descriptors retain additive metadata and their original `runtimeSource`.
- `OmpPromptCompatibility`: Host submission admission, correlated prompt outcomes, and skill presentation normalization. Common conversation projection does not inspect runtime identity.
- Original custom entries remain in `SessionEntryState`; only presentation inputs are normalized. No runtime session files are rewritten by FrostPi.
- A terminal prompt result is not unconditionally a session settlement. Only an explicit `sessionSettled: true` closes the common lifecycle; failed pre-agent submissions affect only their own local turn/queue item. A pre-dispatch drop can report `agentInvoked: true` with `status: aborted`; it must not be marked completed.
- Leading slash admission uses fresh discovery, but is not an atomic lock against extension registration changes or a security sandbox.
- Images on leading skill commands are rejected before dispatch.

## Automated regression coverage

New package tests cover bounded categories, additive fields, builtin/alias/colon collisions, namespaced skill names, actual wire discovery, metadata updates, and correlation before acknowledgement. New Host tests cover admission, skill history/live reconciliation, ordinary custom-message preservation, queue priority, individual queued rejection, and pre-agent failure. Existing Pi transport, runtime, and projection regressions remain part of verification.

Final verification: `pnpm check` passed lint, type checks, all 43 RPC tests and 505 VS Code tests, build, and bundle budgets. Svelte reported one accessibility warning in the unchanged `ExtensionUiRequestCard.svelte`. The real OMP Host smoke probe also passed after the final code changes. Visual Webview testing and VSIX packaging were not performed.

Durable contracts live in package/product SPECs and the OMP compatibility architecture guide. This document records the change's investigation and evidence rather than adding a new contract.
