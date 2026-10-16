# Provider usage

Private FrostPi workspace package for read-only account quotas, balances and credits.
It runs without a Pi process, Pi extension or VS Code dependency.

```ts
import { listProviders, queryUsage } from "@frostime/provider-usage";

const input = {
  agentDirectory: "/path/to/pi/agent",
  environment: process.env,
};

const providers = await listProviders(input); // Safe descriptors; no provider HTTP.
const results = await queryUsage("openai-codex", input); // Safe account usage results.
// Use "all" to query configured, supported providers with bounded concurrency.
```

Supply the relevant Host environment explicitly. An explicit map replaces process
variables. Credentials come from auth.json, provider-level models.json configuration
and known environment sources. Per-model/extension/runtime overrides are not resolved.
Unsupported or unresolvable explicit sources do not silently fall back to another account.

Usage requests do not refresh tokens, log in, execute credential commands or modify files.
Expired credentials are sent as saved; the provider decides whether to reject them.
Native OpenAI OAuth reports only saved grant status and a usage-page link, not numeric
subscription quota. Multiple Fireworks accounts are reported without choosing one.

`queryUsage` accepts an optional cancellation signal. Cancellation rejects with a safe
`AbortError`; provider failures otherwise appear as individual result entries. Each
provider has a 15-second deadline, and `all` runs at most two provider flows concurrently.
Results preserve separate provider/currency meanings and read-only reset counts.

## Development

Run from the repository root:

```bash
pnpm --filter @frostime/provider-usage typecheck
pnpm --filter @frostime/provider-usage lint
pnpm --filter @frostime/provider-usage test
pnpm --filter @frostime/provider-usage build
```

Tests use synthetic configuration, source fixtures and mock/local network boundaries.
They do not read user credentials or query real providers. Assertion failures must not
print complete keys, tokens, authorization headers or environment-variable names.

After building, optional credential inspection:

```bash
pnpm --filter @frostime/provider-usage inspect -- --agent-dir /path/to/pi/agent openai-codex
```

Run this only with permission to read that configuration and its referenced environment.
It prints masked fragments, not full credential values/names, and makes no network requests.
Short values are fully masked. `resolveProviderCredentials` returns raw credentials for
trusted Node callers only; never log that result or send it to a Webview.

HTTP(S) environment proxies and NO_PROXY are supported through explicit undici dispatchers.
Unsupported proxy schemes/all-protocol-only settings fail rather than silently going direct.
Pi-specific proxy settings and SOCKS are not supported. No global dispatcher is changed.

See [SPEC.md](SPEC.md) for the maintenance contract and [UPSTREAM.md](UPSTREAM.md) for
source attribution and deliberate differences from the supplied Pi extension.
