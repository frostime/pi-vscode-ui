# Provider usage implementation handover

## Read this when returning to the earlier Pi branch

The user is returning to the conversation point:

> Invoke a worker subagnet, implement the provider-usage, make refernece on the given pi extensioin as source reference, do not invent by him self.

**Package implementation has already been completed through Phases 1 and 2. Do not repeat it.** Returning to a Pi conversation branch does not by itself rewind Git or files. Inspect the actual repository state first; do not infer it from the older conversation.

```bash
git branch --show-current
git status --short
git log -4 --oneline
```

Current Git branch: `feat/provider-usage`. Work was clean before this handover was added.

| Commit | Result |
| --- | --- |
| `87492e9` | SHAPE and phased PLAN |
| `4bd417b` | Credential-resolution core and masked inspection tooling |
| `542cb8e` | Complete standalone provider-usage query package |

If the user also changes Git state, locate these commits before proceeding. Do not reset/overwrite user changes to reconstruct conversation state.

## Current outcome

`packages/provider-usage` is a private workspace package named `@frostime/provider-usage`.

- Resolves credentials from Pi auth.json, provider-level models.json and environment references.
- Lists configured supported providers, including configured-but-unavailable entries with safe reasons.
- Queries all 17 supported provider IDs using the supplied extension's endpoints, request sequences and normalizers.
- Returns safe structured quotas, balances, credits, read-only reset availability, or individual failures.
- Has no VS Code, Pi SDK/TUI, Pi process, RPC or session dependency.
- Has no OAuth refresh, local-clock expiry rejection, login, credential commands, configuration writes, polling, automatic retries or quota redemption.
- Application/Host/UI integration has **not** been implemented. No source code under apps/vscode was changed for this feature.

The reusable worker implemented Phase 1. Main-agent review and an independent code reviewer found and corrected source-selection/visibility, expiry, origin and test-isolation issues. The Phase-2 worker invocation was aborted without changes. The user then said “You can do yourself”; the main agent completed Phase 2.

Do not rely on the old worker ID or its in-memory context after switching Pi branches. If delegation is needed, use the appropriate preset (`worker` with `reuse: true` for continuing implementation). The user explicitly forbids defaulting to an expensive no-preset subagent.

## Where to resume reading

1. [PLAN](provider-usage.PLAN.md): phases and verification record.
2. [SHAPE](provider-usage.SHAPE.md): approved direction and predicted integration, including explicit rejection of a separate editor tab/Webview subsystem.
3. [Package README](../../../packages/provider-usage/README.md): usage and commands.
4. [Package SPEC](../../../packages/provider-usage/SPEC.md): durable credential/network/result boundaries.
5. [UPSTREAM](../../../packages/provider-usage/UPSTREAM.md): exact source provenance and deliberate differences.

The SHAPE remains draft for the unimplemented Host/UI work. PLAN is in progress, with package Phases 1/2 complete. Neither document means the complete feature is released or integrated.

## Source reference: do not invent provider behavior

The correct source repository is:

```text
D:/Arsenal/PlayCode/pi-provider-usage
```

`pi-usage-analytics` was an earlier mistaken path; it is local token/cost history and is **not** the source for this feature.

- Original source snapshot: `94b347797068d9870bedc5c429aa7b7b0786040b`.
- Source HEAD verified during Phase 2: `5574dafd97e02761feaf4760bc5071cf21655a2a`, clean. Imported request/normalizer/type modules and adapted normalization tests are unchanged from the original snapshot; intervening changes were overlay/command/docs.
- Fourteen provider parsing modules are copied/adapted under `src/providers/`; request sequences are adapted in `src/query.ts`. Pure report/payload contracts are in `src/providerTypes.ts`.
- Source normalization tests and sanitized fixtures were ported without terminal-formatting or Pi-runtime assertions. Additional fixtures were extracted from source tests, not actual user accounts.
- MIT attribution/provenance is retained. The source repository was not modified.
- Credential syntax/metadata was checked against installed Pi 1.1.0 source, without importing the Pi SDK. This is a documented supported configuration subset, not universal runtime-auth compatibility.

Consult those sources for new provider behavior. Do not guess quota APIs, credential interpretation, account selection, currencies or billing conversions.

## Important package interfaces

Application-facing operations:

```text
listProviders(input) -> safe provider descriptors, no provider HTTP
queryUsage(providerId | "all", input, signal?) -> safe per-provider results
```

Input supplies the agent directory or explicit file paths, plus an environment map. An explicit map replaces process environment lookup. `queryUsage` also has a trusted Node-only fetch injection hook for deterministic tests/alternate transport; do not expose it in Webview messages.

`resolveProviderCredentials` is exported for trusted Node/debug use, but returns actual credential material. **Never send or log this result in the Webview.** Safe descriptors/reports are the integration boundary.

Key implementation files:

```text
src/configSnapshot.ts       reads/validates configuration
src/configValues.ts         literal/env interpolation, no command execution
src/resolveCredentials.ts   source precedence, headers, provider auth checks
src/providerDefinitions.ts  supported IDs, auth kinds, environment/origin rules
src/configuration.ts        trusted credential-resolution facade
src/listProviders.ts        safe discovery
src/query.ts                bounded provider/batch flows and safe reports
src/http.ts                 official destinations, proxy transport, body bounds
src/providers/              source-derived normalization and Fireworks flow
src/inspection.ts           masked human-facing report
src/inspect.ts              opt-in CLI, safe invocation/error handling
```

Root build/quality/clean orchestration now includes the package. Runtime dependency: undici 7.28.x. Frozen-lockfile installation passed. No product version was changed.

## Credential/security contracts to preserve

- Only provider-level models.json authentication is supported. Per-model overrides, extension injection and runtime command-line keys are not resolved. Results may differ from the current Pi session's account; future UI must say so.
- Explicit stored entries precede provider-configured keys, then predefined environment sources. An explicit empty/missing/unresolvable/unsupported source does not silently select another account. Configured unavailable providers stay visible.
- Command-valued credentials/headers never execute. Environment interpolation and literal escapes follow the documented Pi source subset.
- Malformed/unreadable auth/models files yield safe unavailable results rather than partial-source fallback. Absent files are simply absent configuration.
- Official client/usage origin checks prevent custom/proxy credentials being forwarded to unrelated official endpoints. Ambiguous authorization headers are unavailable, not arbitrarily selected.
- Stored OAuth expiry is not compared with the local clock. Actual requests decide whether the saved credential is rejected. Refresh/recovery is explicitly out of responsibility.
- Copilot usage requires saved OAuth, uses its long-lived refresh-field credential, and rejects Enterprise. That field usage is not an OAuth-refresh operation. Copilot/xAI authorization overrides must match the saved OAuth account. Native OpenAI checks the saved native grant and does not provide numeric quota.
- A supplied test environment must not consult real process credentials. Tests use synthetic temporary configuration only.
- Tests/inspection/errors must not print complete keys, tokens, authorization headers or environment-variable names, including failure output. Inspection masks long values to short prefix/suffix fragments; short values are fully masked.
- No actual user credential files were read, no live inspection run, and no real provider usage API contacted. Future live checks require explicit permission for the intended file/environment/provider scope.

## Query/result contracts to preserve

- At most two provider flows concurrently for `all`, in predefined result order. Individual failures do not hide successes.
- One 15-second deadline includes all steps of each provider flow. Caller cancellation rejects safely and late results are not published.
- Fixed official destinations only; redirects rejected; success/error response bounds 64 KiB/4 KiB. Raw provider/network/parser/proxy error text is not returned.
- HTTP(S) Host environment proxies/NO_PROXY use explicit per-flow undici dispatchers. No global dispatcher/environment mutation. Unsupported proxy schemes/all-protocol-only settings fail, not silently go direct. Pi-only proxy settings/SOCKS are not supported.
- Fireworks: sole account auto-selected; multiple accounts return selection-required; none fail. No account-choice operation/aggregation.
- MiniMax endpoint follows the source's key prefix; do not probe alternatives. Z.AI monitoring uses raw authorization and optional plan metadata. xAI validates identity before attaching it only to billing.
- Native OpenAI is a local saved-grant status/link result, not remote auth verification or numeric quota.
- Preserve groups/windows, balances, currencies, credits and read-only reset counts. No cross-provider/currency totals or inferred subscription allowance.
- Report capture time is epoch milliseconds; quota reset timestamps are epoch seconds.

## Verification completed and limitations

Passed:

- 160 package tests across 19 test files: credential resolution, source normalization fixtures, all provider request routes, partial batch failures, cancellation/deadlines, response limits, safe output and local proxy behavior.
- Package typecheck, lint and build.
- Root frozen-lockfile install and root build.
- Workspace lint/typecheck in the full check attempt.
- The full 18-test SessionRuntime file on a subsequent targeted rerun.

Full `pnpm check` was **not green**: its parallel app suite had one failure in `apps/vscode/test/unit/SessionRuntime.test.ts`, “finalizes running tools when stopping or losing the Pi process”. Expected partial tool arguments were empty when stopping. The other 530 app tests passed. That test passed on a focused rerun, then the full 18-test file passed. No app code was changed to hide the failure. An earlier full-check attempt also timed out/process-failed; a direct pi-rpc typecheck retry passed.

Not performed: live account checks, actual Node-20 runtime run, VSIX packaging, new UI visual verification. Available runtime was Node 24; Node-20 compatibility follows workspace target/API usage and undici's declared supported floor, not an empirical Node-20 test.

## Next work: Phase 3, then Phase 4

Do not repeat package implementation. Await/interpret the user's next instruction and proceed with the PLAN's Host integration when authorized.

Required architecture:

```text
Existing sidebar menu -> one component in the existing Webview
Existing bridge -> thin Host dispatch -> completed package
```

- Add list/query/cancel messages to the existing validated bridge; update its version as required.
- Existing dispatcher supplies Host file/environment context, invokes the package and returns safe results only to the originating sidebar connection.
- Existing connection owns one pending request ID/AbortController for replacement/close/disposal. No new usage coordinator/service or Session state.
- One component under `src/webview/features/provider-usage/` owns temporary selection/loading/results and subscribes to existing message helpers.
- Menu callback and sidebar local open flag mount a dismissible surface without unmounting conversation/Composer; preserve draft/scroll/disclosure and focus.
- No separate VS Code editor tab, new Webview, top-level `provider-usage-webview` directory, new Vite entry, standalone bridge or global usage store. Those earlier designs were rejected by the user.
- Host/browser boundaries stay thin. If app code begins interpreting credentials or provider schemas, the boundary is wrong.
- Follow existing agent-directory path resolution and remote Host context rules. Keep known saved-account/model-override limitations visible.
- Preserve imported MIT attribution in the VSIX once the app actually bundles this package; package-only root build does not yet ship it in the application bundle.

Use targeted tests first and report remaining workspace/visual/live verification honestly. Keep checkpoint commits on `feat/provider-usage`; never change product version without a separate release request.
