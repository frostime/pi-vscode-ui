# Bounded OMP prompt and skill commands

Status: technical spike completed in part; production implementation blocked on complete prompt-template discovery.

## Agreed scope

Support text-expanding Markdown commands, `prompts/` templates, and `/skill:<name>` without exposing OMP builtin, extension, TypeScript custom, or MCP commands. Preserve OMP-owned loading/expansion and session files. Support normal submission and Steer/Queue with consistent live and restored history. Host-local commands remain separate. No version or release change is authorized by this work.

## Runtime evidence

Tested installed `@oh-my-pi/pi-coding-agent` 18.4.9 through `omp.exe --mode rpc`, with generated fixtures, a separate agent directory, no extensions, and no persisted session. Execution requests used a generated provider override pointing to a loopback HTTP server. The probe checked the active model URL before dispatch. The server captured requests and returned an intentional HTTP 400; no external model was called.

The fixture workspace was under the repository's ignored `tmp/` directory, so ancestor discovery was not fully isolated. OMP also submitted auxiliary skill-description compression requests to the loopback server. The final probe distinguished those requests from the actual turn requests by their fixture content; auxiliary requests are not execution evidence.

| Case | Observed discovery | Execution and persistence |
| --- | --- | --- |
| `commands/spike-file.md` | `spike-file`, source `file` | `/spike-file hello` became `File hello` in a provider request and a persisted user message. |
| Agent `prompts/spike-template.md` | Absent from `get_available_commands` | `/spike-template hello` became `Template hello` in a provider request and a persisted user message. |
| `skills/spike-skill/SKILL.md` | `skill:spike-skill`, source `skill` | Expanded skill body reached the provider. Live start/end events used role `custom`, customType `skill-prompt`, attribution `user`, and details.prompt containing the submitted invocation. Persistence used `custom_message`. |
| Skill with a PNG attachment | Same skill discovery | The resulting provider request contained no image block. |

All three execution cases emitted an error `prompt_result` with `agentInvoked: true` and `sessionSettled: true`, matching the intentional provider rejection. The probe stopped collecting each turn at its terminal result; it does not establish the absence or ordering of later settlement frames.

Spike scripts and fixture results remain in ignored `tmp/omp-prompt-skill-spike/`. Commands: `python tmp/omp-prompt-skill-spike/discovery.py` and `python tmp/omp-prompt-skill-spike/execution.py`. They are disposable, machine-specific probes, not production tests.

A separate direct-source Bun import probe did not run: the installed source graph failed with a missing `createRatchetPrelude` export. That is an experiment setup failure, not evidence against runtime execution. The real CLI probes above reached the target boundary.

## Source findings

Paths below are relative to the tested OMP package's `src/`; they identify the version tested, not a required installation path.

- `slash-commands/available-commands.ts:33–109`: RPC discovery enumerates builtins, skills, extensions, custom/MCP commands, and file commands; it does not read session prompt templates.
- `extensibility/extensions/get-commands-handler.ts:31–69`: public extension `getCommands()` also omits prompt templates. Its `prompt` source actually includes executable custom commands, so it is not a safe text-only classification.
- `config/prompt-templates.ts:168–183`: templates load from the agent prompts directory and project `.omp/prompts/` directory.
- `session/agent-session.ts:6982–7008`: extension/custom execution precedes file expansion, which precedes prompt-template expansion.
- `modes/rpc/rpc-mode.ts:235–319,1474–1487`: skill dispatch builds a custom user-attributed message; the RPC skill branch does not forward images.
- `slash-commands/helpers/parse.ts:21–34`: builtin parsing splits on whitespace or colon. File names with builtin/alias prefixes require scrutiny; an advertised `file` source alone is not proof of text-only dispatch. This collision is source evidence, not a Windows fixture observation.

## Integration implications

- Keep OMP slash capability closed until discovery, submission admission, completion, and projection contracts are implemented together. Filtering completion alone is insufficient.
- Adapt lossless discovery message differences at the RPC boundary. Keep supported-category policy and runtime-specific lifecycle interpretation in the product compatibility layer.
- Handle user-attributed `skill-prompt` messages specifically; do not reinterpret every custom message as a user message. Current live/persisted user reconciliation only recognizes ordinary user messages, and persisted custom messages render independently.
- Reject skill/image combinations explicitly unless the runtime gains support. Do not silently lose attachments.
- Preserve raw terminal result facts. Do not equate every `prompt_result` with Pi `agent_settled` without checking queued/concurrent prompt and session-settlement semantics.

## Blocking decision

The complete agreed scope includes `prompts/` templates, but neither tested public discovery interface exposes them. A thin extension using `getCommands()` cannot fill this gap.

Recommended: pursue an OMP-side discovery contract that reports loaded templates and enough command precedence information to identify executable text-template invocations. Do not patch the user's installed runtime silently. Upstream changes or a maintained patched runtime are a separate dependency decision.

Alternative requiring explicit scope adjustment: initially support discoverable Markdown file commands and skills only, with `prompts/` template discovery deferred. Host-side template scanning is not recommended: it duplicates runtime loading/precedence knowledge and cannot reliably establish the currently loaded session state.

## Still unverified

Successful streamed turns; Steer/Queue ordering and reconciliation; cancellation and pre-admission failures; skill file disappearance; collisions and metadata refresh races; Extension Host integration; UI and session reopening. No production code or capability gates have changed. These checks remain required after the discovery decision.
