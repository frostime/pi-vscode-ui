# Upstream provenance

This package adapts provider-usage rules from the maintained snapshot
repository `pi-provider-usage` (local path verified at
`D:/Arsenal/PlayCode/pi-provider-usage`), which itself forked
`pi-usage` (`@narumitw/pi-usage` 0.61.2, snapshot `fa8548d258b36446b2157311adbcbca7feae2d94`
of `https://github.com/narumiruna/pi-extensions`, MIT).

- Source snapshot commit verified for Phase 1: `94b3477` (full hash
  `94b347797068d9870bedc5c429aa7b7b0786040b`, branch `main`).
- MIT attribution retained: the original copyright notice (`Copyright (c) 2026
  narumiruna`) is preserved in [LICENSE](LICENSE).
- The source repository is read-only for this change. Phase 1 encodes, with inline
  source references:
  - provider IDs and accepted credential kinds (`docs/providers.md`,
    `src/query.ts` provider table),
  - the official usage endpoints and origin checks (`src/query.ts`
    `hasOfficialUrlOrigin` / endpoint constants),
  - provider-specific stored-OAuth interpretation
    (`src/providers/openai-chatgpt.ts`, `src/query.ts`
    `resolveGitHubCopilotUsageAuth` / `resolveXaiUsageAuth`), copilot API
    version footer,
  - the API-key rejection reasons for OpenAI and xAI,
  - the Moonshot shared-variable region guard
    (`query.ts` `moonshotProviderAuthSourceIsAllowed`),
  - the masking/redaction helpers (`src/core.ts`
    `sanitizeDisplayText`/`redactUsageError`).
- Content-mask rules: unlike the source, this package intentionally does NOT
  print unmasked values anywhere; the Pi-version configuration syntax
  (`$ENV`, `${ENV}`, `$$`, `$!`, leading `!`) was verified against Pi 1.1.0
  (`@earendil-works/pi-coding-agent/dist/core/resolve-config-value.js`,
  `dist/utils/json.js`, `dist/core/auth-storage.js`,
  `dist/core/provider-composer.js`) and is re-implemented here without the Pi
  SDK dependency.

## Phase 2 imports

- `src/providers/` copies the source's 14 quota/balance normalizer modules, adapting
  type/helper imports and exact-optional TypeScript compatibility only. Fireworks'
  account-discovery/billing adapter is retained with a cancellation-only guard for
  this immutable request snapshot.
- `src/providerTypes.ts` retains report/payload contracts without Pi model/runtime
  authentication types. `src/query.ts` adapts fixed URLs and source request sequences
  from source `query.ts`; native OpenAI's limited local status comes from
  `providers/openai-chatgpt.ts`, without its runtime credential resolver.
- Normalization tests are adapted from source provider tests; terminal formatting
  and Pi-runtime assertions are excluded. Sanitized Kimi/xAI fixtures are copied;
  additional payload fixtures are extracted from named helpers/literals in source
  tests. They are synthetic, not captures from user accounts.
- Phase 2 source HEAD was `5574dafd97e02761feaf4760bc5071cf21655a2a`, clean.
  All imported request/normalizer/type modules and the adapted provider-normalization
  tests are unchanged from the original `94b3477` snapshot; intervening changes affect
  the extension overlay/command/docs, which this package does not import.
- The HTTP transport uses undici 7 (compatible with the workspace Node >=20.19 floor)
  and explicit environment proxy dispatchers, rather than assuming global fetch
  observes proxy variables. Local-only tests cover HTTP proxy/NO_PROXY routing and
  HTTPS CONNECT routing without contacting real providers.

## Package policy versus source runtime parity

This package is a policy-carrying fork of the source's resolution behavior,
not a wholesale adoption of it. The following package policies intentionally
differ from both the source snapshot and Pi's runtime resolution and are
recorded — not claimed as Pi behavior — in [SPEC.md](SPEC.md):

- an explicitly configured credential that cannot resolve (keyless, empty,
  unresolved `$ENV`, command value, empty `Authorization`) is an explicit
  unavailable result on its own source; there is no silent source
  substitution (Pi falls a keyless/unresolvable stored key through to the
  provider's ambient variables and treats a models.json key with missing
  references as not configured);
- no local-clock expiry evaluation and no refresh/recovery responsibility: the
  saved credentials are used verbatim and provider requests decide rejection;
- malformed or unreadable configuration files fail providers closed with a
  fixed safe file-error result instead of resolving another source;
- the Copilot client-origin check follows `query.ts` `hasOfficialUrlOrigin`
  only; a `github.com` value on stored `enterpriseUrl` is public-account
  classification, not a client endpoint.

Additional query boundaries: source runtime-auth revalidation is not reproduced;
credentials are a file/environment snapshot. Remote error bodies are suppressed instead
of being partially echoed. There is no account-selection operation, historical cache,
UI/command/extension integration or token refresh. Copilot API-key rejection and
Copilot/xAI override-account checks follow the source's explicit OAuth-account contract.

Provider request/response meanings otherwise follow the cited source. Report new
semantic divergences as package policy in SPEC.md.
