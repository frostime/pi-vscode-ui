---
title: Provider usage core contract
description: Phase-1 credential-resolution contract for the FrostPi provider-usage package.
scope:
  - /packages/provider-usage/**
updated: 2026-10-13
---

# Provider usage core contract

`@frostime/provider-usage` is a private workspace package. Phase 1 owns only
credential resolution from Pi configuration. There is no HTTP access, no OAuth
refresh, no login, no command execution and no file writes. The package never
imports `vscode`, Pi SDK/TUI code, session state, RPC types or webview code.

The engine operates on explicit input ([`ProviderResolutionInput`](src/types.ts)):
`auth.json`/`models.json` paths (or a Pi agent directory) and an authoritative
environment map. It does not discover agent directories itself and has no
`ExtensionContext`/`modelRegistry` dependency in this phase.

## Public surface

- `resolveProviderCredentials(input)` — trusted Node output
  (`ReadyProviderCredential` with the real bearer token, or an explicit
  `UnavailableProviderCredential`). Never hand this result to browser code.
- `listProviders(input)` — safe descriptors (provider ID, display name,
  availability, source category, safe reason). No credential values, no
  environment variable names, no file content.
- `maskSecret`, `maskEnvName`, `redactWithSecrets`, `sanitizeDisplayText` —
  mandatory masking before any human-readable output of resolution results.
- Inspect CLI (`pnpm --filter @frostime/provider-usage inspect -- --agent-dir
  <dir> [provider ...]`) — opt-in development tooling with masked output and
  safe failure output only. Not a test, not CI; run only with explicit
  permission against real configuration. Exit codes: 0 on a masked report,
  2 on usage/argument errors, 1 on an unexpected internal failure (safe
  message, no raw error content).

## Package policy (decisions of this package, not Pi runtime parity)

The following are accepted Phase-1 decisions that intentionally differ from
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
   never refreshed or repaired; Phase-2 provider requests decide rejection.
   Record-shape validation is the only stored-credential gate. The Copilot
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
only the final authorization value and provider-pinned extra headers (Copilot
API version) reach future requests.

## Output security

- Every human-facing value passes through the masking module first: short
  values fully hidden, longer values keep a fixed 3-char prefix/suffix around
  one fixed mask word; CLI failure output is safe text too.
- Unavailable reasons are fixed safe strings; they never embed file content,
  raw exceptions or complete environment names.
- `ReadyProviderCredential.secrets` is the redaction pool for later error
  sanitization (internal only). `ambientVarName` is inspector-only and must
  always be masked before display.
- Tests use synthetic temporary fixtures and explicit fake environment maps;
  they never read real user configuration or inherit process credentials, and
  assertions on credentials compare internally (boolean assertions), never by
  printing expected/actual values.
