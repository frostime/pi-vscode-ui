---
status: draft
---

# Provider usage: package, sidebar component, thin dispatch

## Change and design pressure

Add a read-only provider-usage surface inside the existing FrostPi sidebar Webview. An entry in its existing menu opens one dismissible component. It does not open a VS Code editor tab, replace the conversation, or create a second Webview.

The purpose of `packages/provider-usage` is to hide the entire query feature behind two operations. The application must not know credential precedence, provider URLs, accepted authentication, response formats, timeout rules or provider-query scheduling. It renders safe results and carries requests between the component and the package.

Likely changes should be local: adding a provider or changing a credential rule affects the package; changing presentation affects the component. The existing bridge requires a few typed message additions, not a new protocol implementation or feature coordination subsystem.

This replaces the earlier dedicated-tab design. It is a draft for review; no production code or anchors are authorized by the document alone. Follow [the PLAN](provider-usage.PLAN.md) for phased delivery: credential resolution first, then provider queries, Host dispatch, UI and integrated verification.

## Responsibility and dependency direction

```text
Existing sidebar menu
        | opens
ProviderUsagePanel.svelte (existing Webview)
        | existing postToHost / onHostMessage
Existing bridge -> WebviewActionDispatcher
        | calls
packages/provider-usage
        | reads auth.json / models.json / supplied environment
        | requests predefined provider usage APIs
        | returns safe descriptors, reports or errors
Existing connection -> component renders result
```

Only three owners are required:

| Owner | Responsibility |
| --- | --- |
| Package | Discover eligible providers, resolve file/env credentials, validate endpoint/auth compatibility, request/interpret usage, bound requests and redact errors |
| Existing Host dispatch/connection | Validate and authorize browser actions, supply configuration context, call package, deliver to origin, cancel closed/replaced requests |
| One component | Selection, visibility-related cleanup, loading/errors, request identity, report rendering, keyboard interaction |

No extra application coordinator, service, response client, global store, usage snapshots, Session subscriptions or separate build entry.

### Public package surface

The application calls only two operations, schematically:

```text
listProviders({ agentDirectory, environment }, signal)
queryUsage(providerId | all, { agentDirectory, environment }, signal)
```

`listProviders` reads supported configuration without contacting provider APIs. It returns safe provider descriptors: ID, label, availability and an explanation/source label, never credentials.

`queryUsage` reloads configuration, resolves credentials, dispatches the request(s), and returns safe results per provider. It owns the 15-second provider deadline and at-most-two-provider concurrency for `all`. Authentication rejection is a normal result; no refresh or repair.

The engine remains independent of Pi inside the package: explicit credential/configuration input reaches its provider request functions; only the file-reading side knows the Pi file layout. Export the application's two operations and safe types from one entrypoint. Do not introduce additional public subpaths or a generic credential-source plugin system merely for architectural symmetry. Internal separation is sufficient until another real consumer requires more.

The package does not import `vscode`, Pi SDK/TUI, session state, RPC types or Webview code. The Webview uses only type-only imports of safe package results, so no package runtime/Node code enters its bundle. Shared bridge files wrap these result types rather than invent another usage data model.

Credential tests and optional local inspection must not print complete environment-variable names, keys, tokens or headers. Inspection masks before formatting, showing only short prefix/suffix fragments for sufficiently long values and fully masking short values. Unit tests use synthetic inputs and safe failure messages; live inspection requires explicit permission. The resolver still returns actual credentials internally for HTTP requests; only human-facing output is masked. Package-owned inspection tooling is development support, not application/UI code.

## Scope and configuration

Accepted scope: read `auth.json`, `models.json`, and environment variables; predefined provider-specific usage rules; display quotas, balances, credits and read-only reset availability. No OAuth refresh, login, credential writes, quota redemption, polling, automatic retries or history database. No RPC authentication retrieval or dedicated Pi extension.

Host context: reuse `resolvePiAgentDirectory()` from the existing settings loader. Use the workspace folder owning the sidebar's displayed cwd, or the first workspace folder if none can be identified. Resolve relative `PI_CODING_AGENT_DIR` against that workspace cwd, not against a Pi process. Remote workspaces use the remote Extension Host's files and environment. The Host constructs this context for each list/query; the browser cannot choose paths or environment values. Only Pi's file format is supported initially; do not infer an OMP credential format from its executable/profile.

This is configured-account usage, not a promise to reproduce active-session authentication. The view must explain that user-extension/runtime overrides are not included.

Provider availability is package-owned:

- Predefined supported provider plus a relevant configured credential source becomes a listed candidate.
- Adapter-compatible, resolvable credentials and acceptable endpoint configuration make it queryable, not guaranteed to succeed.
- Supported configured providers with a missing variable, unsupported source, malformed credential or incompatible endpoint remain visible with an unavailable reason.
- Unconfigured built-ins and unknown custom providers are not ordinary query choices. OpenAI-compatible chat transport does not establish quota-query compatibility.
- Discovery must not make usage requests, refresh OAuth, execute credential commands or disclose values.

Credential rules stay together inside the package: saved entries before provider-configured keys before predefined environment keys; explicit configured headers/authHeader interpreted according to the supported Pi source contract; `$NAME`/`${NAME}` interpolation and literal escapes; credential-local environment entries where supported before supplied Host environment. An explicit invalid/unsupported selected source yields a reason instead of falling through to another account. Retain provider-specific OAuth field meanings; using a field named `refresh` as an API credential is not an OAuth-refresh operation.

Known custom/proxy endpoints must not cause credentials to be sent to unrelated official usage APIs. Forward only headers required by the adapter, not arbitrary configured headers. Read files anew when the user requests refresh; no file watchers, live-auth matching subsystem, fingerprint cache or attempt to follow credentials injected into a running session. A result represents the credentials used for that request, with its source and capture time.

### Remaining decisions carried forward

These are not settled by choosing the simpler architecture:

1. Recommended: literals/environment references supported, leading `!` shell-command values reported unavailable, never executed. Awaiting confirmation.
2. Recommended initial `models.json` scope: provider-level keys, headers, authHeader and endpoints; not individual `models`/`modelOverrides` authentication. Explain this explicitly. Full model-specific account discovery would change the package descriptors/UI selection and needs confirmation rather than silently claiming full runtime equivalence.
3. Recommended reuse: adapt the existing MIT provider rules/normalizers/tests from `D:/Arsenal/PlayCode/pi-provider-usage` with provenance; leave that repository unchanged. This is a maintained snapshot. A shared published library across both repositories requires separate scope agreement.
4. Recommended networking boundary: Host-environment HTTP(S) proxies/NO_PROXY, not Pi-only custom proxy settings or SOCKS. Validate a maintained Node-20-compatible HTTP client/dispatcher before implementing requests. Existing Pi-process proxy rules do not automatically apply to Host HTTP.

## Application request flow and state

1. `SessionHeader.svelte` gets an ordinary callback from `SidebarShell.svelte`. Its existing menu invokes the callback to open the usage component. This is feature-global placement, not a Session command or per-message action.
2. `SidebarShell.svelte` owns one local `usageOpen` boolean and conditionally mounts the component as a bounded dismissible surface over the sidebar. Conversation and Composer remain mounted; their drafts, scroll and disclosure are untouched.
3. The component uses existing `postToHost` and `onHostMessage`. It subscribes on mount, checks bridge version and request identity, and unsubscribes on destruction. It holds its own selected provider, loading/error/results and current request ID. No new application store or delivery helper. The existing `applyHostMessage` does not need new cases because the mounted component consumes these responses directly; its existing switch ignores unrelated response kinds.
4. Existing `webviewToHost` validation admits bounded list/query/cancel actions. The existing dispatcher marks them sidebar-only, resolves Host context, calls the package and posts safe responses to the same connection. Browser inputs contain IDs/scope only, never credentials, paths, arbitrary URLs or headers.
5. `WebviewConnection` owns one pending usage request's ID and AbortController, beside its existing connection-owned resources. Small replace/cancel/current-request methods are available to the dispatcher. Replacement/disposal aborts; an old request's cleanup cannot cancel a newer request. This is connection lifecycle handling, not a usage service or global lock.
6. Closing/unmounting the component sends cancellation for its pending request. Re-query replaces it. Cancel only the matching ID; late or unknown results have no effect. No session-target fields, snapshots, deltas, model replies or conversation changes.

The first version uses a provider selector and explicit Query/Refresh. Opening lists candidates; it does not query all accounts automatically. Selecting a provider does not switch the Pi model. `All configured providers` is an explicit scope. Current-provider preselection can be a display convenience if passed from existing UI data, but adds no new model discovery or session state dependency and is not proof of matching credentials.

Reports display capture time, the provider's quota windows/groups, separately labelled currencies/balances, credits and read-only reset count. Native OpenAI's limited connection/link result is not fabricated numeric usage. Use the existing validated `openExternal` action for fixed usage-page links. Failed refresh must not present an old snapshot as current; do not show zero instead of an error. Results remain local to the mounted component and are never persisted.

## Predicted diff

Magnitude estimates expose spread, not impose line budgets. Most new code is provider logic and tests adapted into the package; existing application changes are small connecting edits.

```text
packages/provider-usage/
├── package.json, tsconfig.json, tsconfig.build.json
│   create +65–100         private workspace package, one export, independent scripts
├── SPEC.md
│   create +60–90          file/env scope, public operations, read-only/security guarantees
├── LICENSE, UPSTREAM.md
│   create +40–80          MIT attribution and exact source snapshot/differences
├── src/index.ts, src/types.ts
│   create +100–170        two app-facing operations and safe descriptors/reports/failures
├── src/usage.ts
│   create +90–150         join source + engine; owns list/query and batch policy
├── src/configuration.ts
│   create +220–340        read auth/models; commented JSON; literals/env/escapes;
│                         credentials/headers/precedence and safe unavailable reasons
├── src/providerDefinitions.ts
│   create +120–200        supported IDs, auth kinds, environment names and official origins
├── src/query.ts
│   create +200–330        explicit-input provider dispatch; no Pi context/model imports
├── src/http.ts, src/errors.ts
│   create +180–300        established HTTP transport, timeouts/cancellation/size limits,
│                         redirects refused, supported proxy policy and safe errors
├── src/providers/
│   create +2,000–2,300    adapted provider rules/normalizers; preserve billing semantics
└── test/ and test/fixtures/
    create +3,000–5,000    relevant ported tests plus file/env/precedence/no-refresh safety tests

apps/vscode/
├── package.json
│   modify +1–3/-0        workspace dependency only; no new commands, UI build or version change
├── src/webview/features/provider-usage/ProviderUsagePanel.svelte
│   create +260–360        one component, local state/subscription, selector/results/errors;
│                         scoped styles, close/focus/keyboard behavior and 280px layout
├── src/webview/features/sessions/SessionHeader.svelte
│   modify +6–12/-0       local menu action via callback; preserve existing Session actions
├── src/webview/shell/SidebarShell.svelte
│   modify +10–20/-0      open boolean and conditional component; keep conversation mounted
├── src/shared/bridge/webviewToHost.ts
│   modify +15–25/-0      bounded list/query/cancel messages in existing validation
├── src/shared/bridge/hostToWebview.ts
│   modify +10–20/-0      correlated safe list/query results; type-only package imports
├── src/shared/bridge/bridgeVersion.ts
│   modify one line       existing contract requires version update for message changes
├── src/shared/bridge/webview-bridge.SPEC.md
│   modify +8–15/-0       sidebar-only account queries, origin delivery and transient scope
├── src/extension/webview-host/WebviewActionDispatcher.ts
│   modify +45–80/-0      thin cases: context, package calls, cancellation and result forwarding
├── src/extension/webview-host/WebviewConnection.ts
│   modify +25–45/-0      one request/cancellation resource, cleanup on existing dispose;
│                         no usage discovery, credential, HTTP or report logic
└── test/
    create/modify +350–600 focused component, bridge authorization, dispatch and lifecycle tests

scripts/build.mjs, scripts/quality.mjs
    modify +2–8/-0        build/check package before app
package.json
    modify +1–3/-0        package clean orchestration
pnpm-lock.yaml
    modify mechanical     workspace link and established JSON/HTTP dependencies
.dev/docs/architecture/overview.md
    modify +8–15/-0       Host usage-only credential reading; package owns query policy;
                          Pi retains login/refresh/session responsibilities
.dev/docs/feature-map.md
    modify +4–8/-0        feature-to-package/component mapping
.dev/docs/design/ui-spec.md
    modify +6–12/-0       existing-sidebar usage surface, account/session distinction and focus
.dev/docs/development.md
    modify +2–5/-0        new package scripts/ownership
```

App production estimate: one new component (~260–360 lines), ~110–205 small additions to existing menu/shell/bridge/dispatch/connection files, and a workspace dependency. No new application feature subsystem. Multiple existing files change because browser/Host/contracts are already separated, not because the feature introduces more owners.

The package remains the substantial part: provider normalization is roughly 2,000–2,300 lines before requests/configuration/tests. Carry the existing supported provider set unless a smaller set is explicitly agreed; do not silently shrink it to make estimates smaller.

## Explicitly unchanged

No new editor tab or Webview instance. No new UI entrypoint, Vite config, Webview HTML factory, command registration, native VS Code menu contribution or asset packaging path. `SessionWebviewCoordinator`, SessionPanelManager, Pi RPC, bundled Pi extensions, SessionRegistry/Runtime/view state, conversation projection, Composer and ContextUsagePopover remain unchanged. `applyHostMessage` and global stores remain unchanged. Existing CSS bags do not acquire feature-only rules. `pnpm-workspace.yaml` already includes `packages/*`.

The external `pi-provider-usage` repository remains untouched. No second public library release or cross-repository migration is part of this change.

## Review and verification

- Compare added responsibilities with this shape: package owns all query policy, component owns temporary display state, existing connection owns cancellation. If the app starts interpreting auth/provider data or needs another coordinator, stop and revisit the boundary.
- Config/engine tests: auth/models/env precedence, references/escapes, headers/authHeader, malformed/missing sources, no command execution, no refresh/write, endpoint-origin checks, secret-free errors. Port provider fixtures for groups, balances/currencies, reset metrics, native OpenAI limitations and account ambiguity.
- HTTP tests: deadline, cancellation, redirects, response limits, independent batch failures and explicitly supported proxy behavior on Node 20. Validate transport choice before implementation; do not invent one.
- Host/bridge tests: sidebar-only, known provider scope, bounded correlation IDs, originating connection only, replacement/cancel/dispose, late-result suppression; no Pi requests or Session mutations.
- Component tests/visual review: list/query states, close/unsubscribe, stale results, snapshot freshness, independent provider meanings, keyboard/focus restoration, 280px and light/dark/high-contrast. Conversation/Composer must retain state while the surface is open.
- Targeted tests first, then root check/build and VSIX verification. Verify no Pi SDK/TUI or package Node runtime in the Webview bundle and existing asset layout remains unchanged.

Accept the ownership and small existing-sidebar integration separately from exact visual treatment. The package phases have now been implemented under the user's subsequent authorization; Host/UI integration remains unimplemented. See the PLAN for verification and current progress. The core configuration code needed more detail than the initial single-file estimate: it is split into snapshot/value/credential resolution modules, with no additional responsibility owner. Phase 2 preserves the source's report/payload types in a separate internal module and ports normalizer tests; this is source adaptation, not a new application layer. The thin application boundary and remaining UI integration scope are unchanged.
