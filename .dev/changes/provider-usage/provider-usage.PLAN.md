---
status: completed
branch: feat/provider-usage
---

# Provider usage: implementation plan

Follow [the SHAPE](provider-usage.SHAPE.md) for ownership, file placement and integration boundaries. This plan sequences delivery and verification; it does not replace the SHAPE's predicted diff.

Current state: Package, compact cached UI and Host/bridge integration are implemented on `feat/provider-usage`. The UI now calls the completed package through the existing bridge; mock fixtures exist only under tests. Provider caches remain keyed by provider, independent of Session/cwd. No real-credential inspection or live provider requests have been performed; implementation authorization does not authorize those checks.

## Outcome and sequence

```text
1. Resolve credentials without network requests
   -> inspect masked results and review source-selection behavior
2. Complete the independent provider-usage package
   -> verify provider requests and normalized reports without application changes
4a. Implement the sidebar UI with real result types and a temporary mock source
    -> review UI/state behavior before connecting the two completed sides
3. Add thin Host dispatch through the existing bridge
   -> verify safe responses, origin authorization and cancellation
4b. Replace the mock source with existing-bridge requests
    -> preserve the reviewed UI/data interface; remove temporary mock wiring
5. Integrated verification and packaging
```

Each phase ends with targeted tests, a concise evidence report and a checkpoint commit. Do not advance past a failed gate or substitute a larger architecture to work around it. Product/scope decisions remain user-owned. Where later phases depend on unanswered questions, complete earlier authorized work and pause the dependent part.

## Phase 1 — Credential resolution only

**Deliverable:** a buildable/testable `packages/provider-usage` core that reads Pi configuration and returns which supported provider credentials can be resolved, which source was chosen, and explicit unavailable reasons. No provider HTTP requests and no application changes.

### Work

- Establish the private workspace package, its own build/typecheck/test/lint scripts, and minimal root build/check/clean wiring. No product version change or Pi SDK/TUI dependency.
- Implement the SHAPE's configuration reader and predefined provider metadata needed for auth kind, default environment keys and official-origin checks. Read auth/models JSON with the supported format; preserve safe parse errors.
- Implement source selection, literal/environment resolution, provider-level headers/authHeader and adapter credential-kind/endpoint checks. Keep all this logic inside the package.
- Define a core function, `resolveProviderCredentials`, in the configuration module. Its ready result contains the actual request credentials for trusted Node callers; its unavailable result contains a safe reason. Do not pass either credential objects or raw configuration to Webview code.
- Build `listProviders` from that core, exposing only safe descriptors. The package's actual HTTP/query surface is added in Phase 2; do not create placeholder requests, fake success reports or throw-only production scaffolding.
- Add an opt-in local credential inspection command with masked output. Keep its implementation in package-owned development tooling, not production application code. Document invocation and scope in the package's development instructions.

### Unit tests: synthetic inputs only

Use temporary auth/models files and an explicit fake environment map. Never read the developer's actual auth files or inherit process credentials in ordinary tests/CI. Temporary files are outside tracked source, with bounded cleanup.

Cover meaningful behavior:

- auth.json keys and saved OAuth fields; models.json provider keys/headers; predefined environment keys.
- Source precedence, references/escapes and credential-local environment values.
- Missing variables, invalid selected credentials, commented models JSON and malformed files.
- Unsupported command values do not run and do not silently select another account.
- Explicit header behavior and unsupported authentication kinds; custom/proxy credentials rejected before any network access.
- No OAuth refresh, file writes or provider HTTP. Verify file contents remain unchanged and disallowed actions are not invoked.
- Safe provider descriptors/errors contain no credential values or complete environment-variable names. Errors do not embed file content or raw exceptions.

### Output security — required for every phase

Treat environment-variable names as sensitive output too, as requested. Production availability/errors may identify a source category such as `auth.json`, `models.json`, or `environment`, but do not reveal complete variable names.

- Mask before any formatting, printing, logging or serialization intended for human output.
- Longer values may show a short prefix/suffix, with a fixed mask in between; for example `abc…[masked]…xyz`. Mask short values completely so prefix/suffix never reconstruct the original value. Apply the same rule to environment names, key values, authorization headers, OAuth access/refresh fields and other credential-bearing fields.
- Use fixed mask text rather than printing all hidden characters. Do not dump the complete environment, raw configuration, resolved-auth object, headers or upstream error body.
- The resolver returns actual credentials for requests; masking affects inspection/reporting only. Never send a masked token to a provider.
- Normal test output is pass/fail and safe descriptions. Assertions on credentials compare internally and report booleans/safe classifications, not secret-bearing expected/actual objects. Do not use raw-auth snapshots or assertions whose failure formatter exposes full values, even with synthetic fixtures.
- Add tests for the masking and safe-error/reporting boundary, including short values, empty values, headers and nested OAuth fields. Use fake data and ensure failure messages themselves are safe.
- Do not upload raw inspection traces or credentials into commits, plans, screenshots, diagnostics or session messages. A masked inspection does not authorize broad reading or disclosure of other sensitive configuration.

### Optional real-configuration inspection

This is not a unit test or a CI step. Run it only after explicit permission to read the intended auth/models files and named environment inputs. No environment dump and no network requests.

The command must print only provider ID, availability, source category, masked environment name if relevant, and masked selected credential fragments. Print unavailable reasons without raw parsing/runtime errors. No automatic fixture generation from live configuration.

Example shape of the output (fake values):

```text
openai-codex  ready        source=auth.json   credential=abc…[masked]…xyz
deepseek      ready        source=environment name=DEE…[masked]…KEY credential=def…[masked]…uvw
openrouter    unavailable  reason=required environment value missing
```

### Gate

- Narrow package tests, typecheck and lint pass.
- Synthetic tests demonstrate the intended resolved values without printing them.
- Inspection/masking behavior is reviewed; optional live inspection is not claimed as passed unless authorized and performed.
- Confirm the remaining credential-source decisions below before considering Phase 1 behavior accepted. Report exact limitations, not full runtime-auth equivalence.
- Checkpoint: `✨ feat(provider-usage): resolve configured credentials safely`.

## Phase 2 — Complete the usage package

**Deliverable:** callable `listProviders` and `queryUsage` operations that return safe structured usage results with no VS Code or running-Pi dependency.

### Work

- Adapt provider request rules and normalizers from `pi-provider-usage`; retain MIT attribution and record exact source provenance. Keep the separate repository unchanged unless separately authorized.
- Add provider-specific credential interpretation rather than assuming every OAuth field/API key maps to the same header. Do not perform OAuth refresh or login.
- Implement established HTTP transport, bounded response handling, redirect refusal, cancellation, provider deadlines and safe errors. Verify the chosen Node-20-compatible proxy approach before depending on it.
- Add provider-by-provider request/response coverage, then batch query with at most two concurrent providers and independent results. Preserve provider windows/groups, currencies, balances, credits, reset counts and limited/no-numeric-quota results.
- Ensure exported usage reports/descriptors contain no credentials, full environment names or raw provider error responses. Phase 1's unsafe credential result remains an internal package-building block, not a browser-facing result.

### Gate

- Mock-server/mock-transport tests validate request authentication internally without outputting it; provider fixture tests retain meaningful existing behavior.
- Deadline, cancellation, redirects, response size, malformed responses and independent batch errors pass targeted tests.
- Explicitly verify supported proxy/NO_PROXY behavior and record unsupported network cases.
- Package checks/build pass; no VS Code/Pi SDK/TUI runtime imports.
- A real provider smoke query requires separate explicit permission and the same masked-output rule. It is optional, not a substitute for deterministic tests.
- Checkpoint: `✨ feat(provider-usage): query provider quotas and balances`.

## Phase 3 — Thin Host and existing bridge

**Deliverable:** validated browser actions invoke the completed package and return only safe results to the originating sidebar connection. No new usage coordinator or Session state.

### Work

- Add existing-bridge list/query/cancel message definitions and validation; update bridge version as required by its contract.
- Add small sidebar-only dispatcher cases that resolve Host context, call package operations and forward results.
- Add one current-request ID/AbortController resource to the existing connection; replace/cancel/dispose correctly. This resource handles lifecycle only, not authentication or provider behavior.
- Keep credentials and source files inside Host/package code; only safe report types are referenced by shared/browser code.

### Gate

- Invalid/cross-surface messages cause no query. Browser cannot select a path, credential, arbitrary endpoint or environment value.
- Origin-only delivery, replacement, cancel-ID matching, connection disposal and late-result suppression pass.
- No Pi RPC call, conversation entry, Session mutation or raw secret logging.
- Targeted extension/bridge tests and application typecheck pass.
- Checkpoint: `✨ feat(provider-usage): dispatch usage requests through existing bridge`.

## Phase 4 — Sidebar UI first, then connection

**Deliverable:** Usage immediately left of Context opens a compact upward popover in the existing sidebar Webview. No editor tab, new Webview, additional build entry, global store or chat replacement.

The user revised the order: implement and inspect this UI before Phase 3. Its narrow `ProviderUsageSource` uses the package's actual safe descriptors/results and cancellation signals; the source is temporarily synthetic. Keep it visibly marked as mock, with no file/environment access or authenticated requests. After UI review and Phase 3, replace the source with bridge-backed operations and remove the mock module/flag/wiring. This interface is the replaceable data boundary, not a new application service/store.

The panel owns selection/loading/cancellation. A small child renders reports, and pure presentation functions handle units/bars; neither interprets credentials or provider request rules.

### Work

- Add the Usage trigger left of Context and local open flag in SessionMetrics; enable it only for the sidebar.
- Auto-query the supported active provider and selected scopes. Cache successful per-provider snapshots across openings; retain original timestamps, fetch anew on explicit Refresh, never cache failures/cancelled work. Preserve per-provider cache across Session switches; no directory-based cache or invalidation mechanism.
- Implement one component with local selection/loading/results/errors and the existing message subscription helpers. Check request identity/version, cancel pending work on close and unsubscribe on destruction.
- Show eligible/unavailable providers, explicit query/refresh/all scope, snapshot time and provider-specific usage meaning. Reset counts are plain read-only metrics.
- Keep the source limitation visible. Do not claim these credentials necessarily match the active Pi session.
- Preserve conversation/Composer mounting, draft, scroll and disclosure. Restore focus after closing; use component-scoped styles.

### Gate

- UI tests cover loading, empty/unavailable, errors, mixed batch results, stale responses, close/reopen and snapshot freshness.
- Review at 280px and light/dark/high-contrast with keyboard opening/query/closing. Review exact panel presentation before treating incidental prototype styling as accepted.
- Verify conversation/Composer state survives the usage surface.
- Checkpoint: `✨ feat(provider-usage): show read-only usage in sidebar`.

## Phase 5 — Integration and release-readiness verification

- Update architecture/feature-map/UI/development documents required by the SHAPE, and package-local SPEC/development instructions for final behavior.
- Compare actual diff to the SHAPE. Explain any new owner, dependency or significant spread before accepting it.
- Run targeted tests first, then root `pnpm check` and `pnpm build`, followed by `pnpm package:vsix && pnpm verify:vsix`.
- Verify package ordering, preserved asset paths, attribution, secret-free browser/results/diagnostics and absence of Pi SDK/TUI/Node runtime imports in the Webview.
- Report verified and unverified cases separately, including any optional real-provider checks not performed. Do not change product version without a separate request.
- Final documentation/checkpoint commit; mark the plan completed only after all applicable gates and diff comparison pass. Update SHAPE status according to its acceptance/completion rules, not merely because a plan exists.

## UI-first mock-stage verification record

- User review replaced the initial menu/dashboard layout with Usage left of Context and a compact upward popover. Quota rows combine used/window/reset/remaining information; technical metadata is collapsed. The supported active provider queries automatically, and a local source wrapper preserves successful snapshots across reopening until explicit refresh or source invalidation.
- Eleven focused presentation/cache/mock tests plus the existing Session shell test pass (12 tests). Application typecheck and targeted lint pass. The existing unrelated ExtensionUiRequestCard accessibility warning remains; the build reports its bundle-size warning.
- An isolated Edge browser harness mounts the actual SessionMetrics row and exercises automatic active-provider fetch, retained snapshot on reopen, explicit refresh, mixed results, cancellation, outside-dismiss/focus, stale results, Escape and draft preservation. Compact upward placement and overflow checks pass at 280px; dark/light/high-contrast screenshots inspected. Harness/snapshots remain temporary under `tmp/provider-usage-review/`.
- The browser bundle contains no provider credential/query/proxy engine runtime. No Host code, bridge schema/version, Pi process policy or Session state changed.
- Full VS Code Extension Development Host interaction, workspace-wide tests and VSIX packaging were not run in this UI-first stage. No real files/credentials were inspected or authenticated usage requests made.
- UI-first stage completed before Host integration. Mock fixtures are now test-only; the existing safe source interface is implemented by bridge requests. Independent tests cover version/request matching and cancellation cleanup.

## Host integration verification record

- Added correlated list/query/cancel messages in bridge 3.2, thin sidebar-only dispatch and one connection-owned cancellation resource. No new usage service/coordinator, Pi RPC, Session state or directory-based cache. Host input uses the stable workspace root/environment to locate Pi configuration, independently of Session cwd.
- Production mock source/flag removed; fixtures moved to tests. Existing compact UI, automatic active-provider query and per-provider cache behavior remain.
- 33 targeted integration/presentation/cache/lifecycle tests pass; all 550 App tests pass. Browser review exercised actual bridge-backed UI with a fake Host (no credentials/network), including automatic fetch, snapshot reuse/refresh, cancellation and late responses at 280px across themes.
- Independent read-only review found no concrete bridge/lifecycle bug. It flagged bundle-size verification and a stale doc sentence; both addressed. Host production bundle is now minified (debug/source-map builds remain unminified), bringing bundled undici within the unchanged 1.2 MB budget.
- Root build/bundle-budget and VSIX package/verification pass (2.64 MB). MIT attribution and HTTP-client license notices are embedded and checked in VSIX verification. Product version remains 0.15.3.
- Final `pnpm check` passed: workspace lint/typechecks, 43 RPC tests, 160 package tests, 550 App tests, root build and bundle budgets. Clean VS Code local/remote smoke and real provider checks remain unperformed, as does actual Node-20 runtime execution. No live secret files or environment values were inspected.

## Phase 2 verification record

- Package typecheck/lint/build and all 160 tests passed; frozen-lockfile installation and root build passed.
- Workspace lint/typecheck passed in the full `pnpm check` attempt. Its app test run had one failure in `SessionRuntime.test.ts` (partial tool arguments when stopping), with 530 other app tests passing. The same test passed on a focused rerun, and the full 18-test SessionRuntime file subsequently passed. The full workspace check is not claimed green; no app code was changed to conceal this failure.
- No VSIX packaging or live-provider/real-credential checks were performed in this package-only phase. Runtime verification used the available Node 24; Node 20 compatibility follows the workspace target and undici's declared supported floor, not an actual Node-20 run.

## Decisions and authorization checkpoints

Near-term Phase 1 needs confirmation of command-value exclusion and provider-level rather than per-model authentication. The plan currently follows the SHAPE's recommended defaults, not an implicit claim that those choices were accepted.

Before Phase 2, settle the copied-source versus shared-library ownership and exact Host proxy support. Before optional live checks, obtain explicit permission for the exact configuration/environment scope and provider requests.

The subsequent implementation request authorized package implementation. Phase 1 uses the no-command/provider-level-source scope; review corrected silent-source fallback, missing-provider visibility, an unnecessary expiry gate, Copilot endpoint rules and CLI environment isolation. Phase 2 adds source-backed queries/normalizers, independent failures, deadlines/cancellation and explicit undici HTTP(S) proxy/NO_PROXY handling verified locally. Further source checking also tightened Copilot API-key rejection and subscription override-account matching. The external source repository is unchanged. The package-only assignment is complete. The UI-first stage and the user's subsequent instruction authorize this Host/bridge integration. It is implemented without live authenticated checks. Bundled MIT notices are now retained and verified.
