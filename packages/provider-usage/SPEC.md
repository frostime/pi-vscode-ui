---
title: Provider usage contract
description: Read-only credential resolution and standalone provider quota/balance queries.
scope:
  - /packages/provider-usage/**
updated: 2026-10-13
---

# Provider usage contract

`@frostime/provider-usage` is a private workspace package. It resolves Pi file/environment
credentials and queries predefined provider usage APIs. Credential resolution itself
makes no network requests. No operation refreshes OAuth, logs in, executes credential
commands or writes configuration. The package never
imports `vscode`, Pi SDK/TUI code, session state, RPC types or webview code.

The engine operates on explicit input ([`ProviderResolutionInput`](src/types.ts)):
`auth.json`/`models.json` paths (or a Pi agent directory) and an authoritative
environment map. It does not discover agent directories itself and has no
`ExtensionContext`/`modelRegistry` dependency.

## Public surface

`@frostime/provider-usage/types` exposes only serializable descriptor/result contracts.
It has no Node transport, credential or filesystem dependency and is the entry used
by shared bridge definitions. The root entry retains its existing type exports.

- `resolveProviderCredentials(input)` — trusted Node output
  (`ReadyProviderCredential` with the real bearer token, or an explicit
  `UnavailableProviderCredential`). Never hand this result to browser code.
- `listProviders(input, options?)` — safe descriptors (provider ID, display name,
  availability, source category, safe reason, optional official-page `links`). Links
  contain a label and URL from maintained predefined metadata, never a provider
  response or user credential configuration. OpenAI and Codex expose the established
  ChatGPT usage page; OpenCode Go exposes `https://opencode.ai/console`.
  Providers without verified pages omit links. Navigation is
  available even when credentials are unavailable. No credential values, no
  environment variable names, no file content. Default listing omits unconfigured
  entries; `{ includeUnconfigured: true }` returns the complete supported catalog,
  with `not-configured` entries explicitly unavailable. This lets callers distinguish
  unsupported Providers from inaccessible credentials without network requests.
- `queryUsage(scope, input, signal?)` — safe per-provider results for one supported
  provider ID or `all`. It reloads configuration, preserves configured-but-unavailable
  entries, and returns independent successes/failures without credentials. Unknown
  scope is rejected before reads/requests. Caller cancellation rejects with a safe
  `AbortError`, rather than publishing partial or late results.
- `maskSecret`, `maskEnvName`, `redactWithSecrets`, `sanitizeDisplayText` —
  mandatory masking before any human-readable output of resolution results.
- Inspect CLI (`node packages/provider-usage/dist/inspect.js --agent-dir
  <dir> [provider ...]`) — opt-in development tooling with masked output and
  safe failure output only. Not a test, not CI; run only with explicit
  permission against real configuration. Exit codes: 0 on a masked report,
  2 on usage/argument errors, 1 on an unexpected internal failure (safe
  message, no raw error content).

## Package policy (decisions of this package, not Pi runtime parity)

The following configuration policies intentionally differ from
Pi's runtime resolution; they are recorded here so the package does not
pretend that Pi's behavior is adopted wholesale:

1. **No silent source substitution.** An explicitly configured credential
   (auth.json stored entry or provider-level models.json `apiKey`) that is
   keyless, unresolvable, empty, is a command value, or has an explicitly
   empty `Authorization` header, yields an explicit unavailable result
   carrying its own source category (`auth.json` or `models.json`) and stays
   listed. It never falls back to a different account or source. Ambient
   variables are only consulted when no explicit source exists at all.
2. **No expiry evaluation and no recovery responsibility.** The local clock is
   never compared with stored token expiry and stored OAuth credentials are
   never refreshed or repaired; provider requests decide rejection.
   Record-shape and provider-required field validation remain; expiry is not a gate. The Copilot
   usage bearer is the saved long-lived `refresh`-field credential, so its
   short-lived `access` expiry is irrelevant to resolution.
3. **Fail-closed on unreliable files.** A malformed or unreadable auth.json or
   models.json produces a fixed safe file-error result for every supported
   provider; credentials are never resolved from another source while a
   configuration file cannot be reliably interpreted. Absent files (missing or
   not supplied) are simply absent configuration.
4. **Command values never execute.** Leading `!` values are unsupported with an
   explicit unavailable reason on the same source.
5. **Environment authority.** A supplied environment map is the only ambient
   lookup; `process.env` is consulted only when no map is provided. Tests stay
   isolated from developer/machine credentials this way.

Structural consequence of rule 3: a broken models.json also degrades providers
that would otherwise resolve purely from auth.json, because endpoint and
header facts are unverifiable while the file is unreliable. This is accepted
conservatism until configuration is intact again.

## Value syntax and runtime semantics (Pi-verified pieces)

Value syntax (literals, `$NAME`, `${NAME}`, `$$`, `$!`, empty environment
values treated as missing) mirrors Pi 1.1.0
`dist/core/resolve-config-value.js`; auth.json/models.json validation mirrors
Pi's `ReadOnlyAuthStorage` and `ModelConfig` shapes, including ENOENT being
absent configuration. Provider metadata and official endpoint rules come from
the maintained source snapshot (`providerDefinitions.ts`, UPSTREAM.md). Where
Pi's runtime would resolve differently (keyless stored key, models.json key
with missing references), this package applies the explicit no-substitution
policy above instead of Pi's fallthrough.

Endpoint safety: a configured models.json `baseUrl` must satisfy the source's
official-origin rules (`query.ts` `hasOfficialUrlOrigin`; for Copilot the
`https://api.<region>.githubcopilot.com` pattern — github.com is only the
public-account classification for stored `enterpriseUrl`, never a client
endpoint). `[models].headers` and `authHeader` are validated all-or-nothing;
duplicate case-insensitive authorization headers are unavailable, not arbitrarily
selected. Only the final authorization value and provider-pinned extra headers (Copilot
API version) reach usage requests. Copilot usage requires a saved OAuth account,
not an API-key path. Copilot/xAI subscription authorization overrides must match the
saved OAuth access field; they cannot silently change the chosen account.

## Provider requests and results

Provider endpoints, request sequences and normalization come from the pinned extension
source; see [UPSTREAM.md](UPSTREAM.md). Credentials are a request snapshot, not live
Pi authentication. No runtime matching, account switching or auth-change watcher is
promised. Provider-supplied display text is sanitized and known credential values and
predefined environment names are redacted before returning reports.

- A provider's HTTP flow, including Fireworks account discovery and sequential xAI/
  Z.AI requests, shares one 15-second deadline. `all` runs at most two provider flows
  concurrently and preserves predefined result order. No automatic retries/polling.
- Fixed official usage origins are checked before attaching credentials. Redirects
  are rejected. Successful bodies are limited to 64 KiB; error bodies to 4 KiB. Error
  bodies, parser excerpts, raw network errors and proxy URLs are never returned.
- Each HTTP flow owns its dispatcher. Explicit environment HTTP(S) proxy variables
  and NO_PROXY are honored without global mutation or unintended process-env fallback.
  Unsupported proxy schemes and an unsupported all-protocol-only proxy fail before
  requests; they never silently bypass the proxy. FrostPi's Host translates its
  current proxy settings into this environment input; the package does not read
  VS Code settings or Pi-process state. SOCKS is outside its network contract.
- Fireworks selects only a sole visible account. Multiple accounts return
  `selection-required`; no account is chosen or aggregated. No account yields failure.
- Native OpenAI OAuth returns local grant status and a fixed usage-page link, not numeric
  quota and not remote authentication verification. OpenAI API-key usage is unsupported.
- MiniMax selects quota/balance from the actual source-defined credential prefix,
  without probing alternative endpoints. Z.AI sends its monitor's raw authorization
  key and treats non-cancellation plan-metadata failures as optional. xAI validates
  its returned user ID before adding it only to the billing request.
- Provider quotas, window/model groups, credits, currencies and balances retain their
  native meanings; no cross-provider/currency totals or inferred subscription quota.
  Codex reset availability is read-only. `capturedAt` uses epoch milliseconds;
  bucket `resetsAt` uses epoch seconds, matching the source normalizers.

The optional injected `fetch` is a trusted Node transport/testing hook, not browser
input. Public bridge integration must expose only scope/request IDs, never transport,
paths, environment, headers or credential objects.

## Output security

- Every human-facing value passes through the masking module first: short
  values fully hidden, longer values keep a fixed 3-char prefix/suffix around
  one fixed mask word; CLI failure output is safe text too.
- Unavailable reasons are fixed safe strings; they never embed file content,
  raw exceptions or complete environment names.
- `ReadyProviderCredential.secrets` is the internal redaction pool for report
  sanitization (internal only). `ambientVarName` is inspector-only and must
  always be masked before display.
- Tests use synthetic temporary fixtures and explicit fake environment maps;
  they never read real user configuration or inherit process credentials, and
  assertions on credentials compare internally (boolean assertions), never by
  printing expected/actual values.
