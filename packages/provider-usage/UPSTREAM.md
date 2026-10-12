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
- The source repository is read-only for this change; nothing was imported
  wholesale. Phase 1 encodes, with inline source references:
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

Everything else that is not listed as a divergence follows the cited source
locations. Report new divergences as package policy in SPEC.md.
