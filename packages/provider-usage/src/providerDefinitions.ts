/**
 * Predefined provider metadata for the supported provider set.
 *
 * Source of truth (verified, do not invent):
 * - Provider IDs, permissions, base URLs and predefined environment variable
 *   names come from Pi 1.1.0 provider definitions
 *   (`@earendil-works/pi-ai/dist/providers/*.js`).
 * - Official usage endpoint URLs and provider-specific OAuth credential
 *   interpretation come from the maintained source snapshot
 *   `pi-provider-usage` (`src/query.ts`, `src/providers/openai-chatgpt.ts`,
 *   `docs/providers.md`).
 *
 * This table is internal. Environment variable names must never be rendered
 * into safe descriptors or reasons.
 */

import type { ProviderUsageLink } from "./types.js";

/** How a stored OAuth credential (auth.json) is interpreted for usage requests. */
export type StoredOAuthInterpretation =
  /** No stored-OAuth usage path for this provider. */
  | "unsupported"
  /**
   * The stored `access` token is used directly as the bearer token, matching
   * Pi's `toAuth` derivation for the provider (codex, openrouter, xAI, Kimi).
   */
  | "bearer-access"
  /**
   * Native ChatGPT grant: the full stored grant must be complete (access,
   * refresh, expires, clientId, scopes with the direct-token scope). The
   * `access` token is the bearer for the OpenAI plan-status result.
   */
  | "native-chatgpt"
  /**
   * GitHub Copilot: the stored `refresh` field is the long-lived GitHub token
   * accepted by the usage endpoint; the short-lived `access` proxy token is
   * not usable there.
   */
  | "copilot-refresh";

export interface ProviderUsageDefinition {
  id: string;
  displayName: string;
  /** Maintained official pages for read-only navigation. */
  links?: readonly ProviderUsageLink[];
  /** Predefined ambient environment keys in Pi resolution order. Internal; never rendered. */
  envVarNames: readonly string[];
  /** Interpretation of a stored OAuth credential for usage requests. */
  storedOAuth: StoredOAuthInterpretation;
  /**
   * Whether the provider accepts stored API-key credentials at all (Pi only
   * composes API-key auth for providers whose base definition has one; the
   * codex provider is OAuth-only).
   */
  supportsStoredApiKey: boolean;
  /**
   * Origin(s) that the source repository accepts for a provider's configured
   * client endpoint. A credential bound to a configured endpoint on a different
   * origin is never forwarded to the official usage API.
   */
  clientOrigins: readonly string[];
  /** Official usage endpoint (documentation and Phase 2 request provenance). */
  usageEndpoint: string;
  /** Runtime-safe bearer requirement (only the source-enforced cases). */
  requiresBearer: boolean;
  /**
   * Restricts the ambient-environment path for sidebar providers that share one
   * environment variable (Moonshot Global/China). Encoded without the variable
   * name itself; the restriction is that the *other* region must not be
   * inferred from that shared variable.
   */
  sharedAmbientVarProtected: boolean;
  /** Set when the source explicitly rejects API-key authentication for usage. */
  apiKeyUsageRejectReason: string | undefined;
}

export const PROVIDER_USAGE_DEFINITIONS: readonly ProviderUsageDefinition[] = [
  {
    id: "baseten",
    displayName: "Baseten",
    envVarNames: ["BASETEN_API_KEY"],
    storedOAuth: "unsupported",
    supportsStoredApiKey: true,
    clientOrigins: ["https://inference.baseten.co", "https://api.baseten.co"],
    usageEndpoint: "https://api.baseten.co/v1/billing/usage_summary",
    requiresBearer: false,
    sharedAmbientVarProtected: false,
    apiKeyUsageRejectReason: undefined,
  },
  {
    id: "openai",
    displayName: "OpenAI",
    links: [{ label: "View usage on ChatGPT", url: "https://chatgpt.com/settings/usage" }],
    envVarNames: ["OPENAI_API_KEY"],
    storedOAuth: "native-chatgpt",
    supportsStoredApiKey: true,
    clientOrigins: ["https://api.openai.com"],
    usageEndpoint: "https://chatgpt.com/settings/usage",
    requiresBearer: false,
    sharedAmbientVarProtected: false,
    // Source contract: ChatGPT plan status verifies the native ChatGPT grant;
    // API-key usage reporting is not supported.
    apiKeyUsageRejectReason: "API-key usage reporting is not supported for OpenAI; ChatGPT plan status requires the native ChatGPT OAuth grant",
  },
  {
    id: "openai-codex",
    displayName: "OpenAI Codex",
    links: [{ label: "View usage on ChatGPT", url: "https://chatgpt.com/settings/usage" }],
    envVarNames: [],
    storedOAuth: "bearer-access",
    // Pi composes API-key auth only for providers whose base definition has one.
    supportsStoredApiKey: false,
    clientOrigins: ["https://chatgpt.com"],
    usageEndpoint: "https://chatgpt.com/backend-api/wham/usage",
    requiresBearer: false,
    sharedAmbientVarProtected: false,
    apiKeyUsageRejectReason: undefined,
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    envVarNames: ["DEEPSEEK_API_KEY"],
    storedOAuth: "unsupported",
    supportsStoredApiKey: true,
    clientOrigins: ["https://api.deepseek.com"],
    usageEndpoint: "https://api.deepseek.com/user/balance",
    requiresBearer: true,
    sharedAmbientVarProtected: false,
    apiKeyUsageRejectReason: undefined,
  },
  {
    id: "fireworks",
    displayName: "Fireworks",
    envVarNames: ["FIREWORKS_API_KEY"],
    storedOAuth: "unsupported",
    supportsStoredApiKey: true,
    clientOrigins: ["https://api.fireworks.ai"],
    usageEndpoint: "https://api.fireworks.ai/* (billing accounts)",
    requiresBearer: false,
    sharedAmbientVarProtected: false,
    apiKeyUsageRejectReason: undefined,
  },
  {
    id: "github-copilot",
    displayName: "GitHub Copilot",
    envVarNames: ["COPILOT_GITHUB_TOKEN"],
    storedOAuth: "copilot-refresh",
    supportsStoredApiKey: true,
    // Source rule (query.ts hasOfficialUrlOrigin): https + api.<region>
    // .githubcopilot.com hostnames, implemented via the copilot pattern in
    // clientOriginIsOfficial. github.com is NOT a client endpoint origin; it is
    // only the public-account value accepted for stored enterpriseUrl fields.
    clientOrigins: [],
    usageEndpoint: "https://api.github.com/copilot_internal/user",
    requiresBearer: false,
    sharedAmbientVarProtected: false,
    // Source resolveGitHubCopilotUsageAuth requires a complete saved OAuth account.
    apiKeyUsageRejectReason: "GitHub Copilot usage requires a saved OAuth account; API-key authentication is unsupported.",
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    envVarNames: ["OPENROUTER_API_KEY"],
    // Pi's OpenRouter OAuth login provisions an API key stored in `access`
    // (empty refresh token), so the stored access value is usable directly.
    storedOAuth: "bearer-access",
    supportsStoredApiKey: true,
    clientOrigins: ["https://openrouter.ai"],
    usageEndpoint: "https://openrouter.ai/api/v1/key",
    requiresBearer: false,
    sharedAmbientVarProtected: false,
    apiKeyUsageRejectReason: undefined,
  },
  {
    id: "vercel-ai-gateway",
    displayName: "Vercel AI Gateway",
    envVarNames: ["AI_GATEWAY_API_KEY"],
    storedOAuth: "unsupported",
    supportsStoredApiKey: true,
    clientOrigins: ["https://ai-gateway.vercel.sh"],
    usageEndpoint: "https://ai-gateway.vercel.sh/v1/credits",
    requiresBearer: false,
    sharedAmbientVarProtected: false,
    apiKeyUsageRejectReason: undefined,
  },
  {
    id: "opencode-go",
    displayName: "OpenCode Go",
    links: [{ label: "Open OpenCode console", url: "https://opencode.ai/console" }],
    envVarNames: ["OPENCODE_API_KEY"],
    storedOAuth: "unsupported",
    supportsStoredApiKey: true,
    clientOrigins: ["https://opencode.ai"],
    usageEndpoint: "https://opencode.ai/zen/go/v1/usage",
    requiresBearer: false,
    sharedAmbientVarProtected: false,
    apiKeyUsageRejectReason: undefined,
  },
  {
    id: "kimi-coding",
    displayName: "Kimi For Coding",
    envVarNames: ["KIMI_API_KEY"],
    // Pi's Kimi Coding OAuth `toAuth` derives `Authorization: Bearer <access>`.
    storedOAuth: "bearer-access",
    supportsStoredApiKey: true,
    clientOrigins: ["https://api.kimi.com"],
    usageEndpoint: "https://api.kimi.com/coding/v1/usages",
    requiresBearer: false,
    sharedAmbientVarProtected: false,
    apiKeyUsageRejectReason: undefined,
  },
  {
    id: "minimax",
    displayName: "MiniMax",
    envVarNames: ["MINIMAX_API_KEY"],
    storedOAuth: "unsupported",
    supportsStoredApiKey: true,
    clientOrigins: ["https://api.minimax.io"],
    usageEndpoint: "https://api.minimax.io/* (quota or balance)",
    requiresBearer: false,
    sharedAmbientVarProtected: false,
    apiKeyUsageRejectReason: undefined,
  },
  {
    id: "minimax-cn",
    displayName: "MiniMax CN",
    envVarNames: ["MINIMAX_CN_API_KEY"],
    storedOAuth: "unsupported",
    supportsStoredApiKey: true,
    clientOrigins: ["https://api.minimaxi.com"],
    usageEndpoint: "https://api.minimaxi.com/* (quota or balance)",
    requiresBearer: false,
    sharedAmbientVarProtected: false,
    apiKeyUsageRejectReason: undefined,
  },
  {
    id: "moonshotai",
    displayName: "Moonshot AI",
    envVarNames: ["MOONSHOT_API_KEY"],
    storedOAuth: "unsupported",
    supportsStoredApiKey: true,
    clientOrigins: ["https://api.moonshot.ai"],
    usageEndpoint: "https://api.moonshot.ai/v1/users/me/balance",
    requiresBearer: false,
    // Same shared variable as the CN entry, with the same region ambiguity.
    sharedAmbientVarProtected: true,
    apiKeyUsageRejectReason: undefined,
  },
  {
    id: "moonshotai-cn",
    displayName: "Moonshot AI CN",
    // Pi uses the same shared variable for both Moonshot regions. The source's
    // region guard blocks the *other* region from being inferred from it, so
    // the CN provider cannot resolve from the shared ambient variable.
    envVarNames: ["MOONSHOT_API_KEY"],
    storedOAuth: "unsupported",
    supportsStoredApiKey: true,
    clientOrigins: ["https://api.moonshot.cn"],
    usageEndpoint: "https://api.moonshot.cn/v1/users/me/balance",
    requiresBearer: false,
    sharedAmbientVarProtected: true,
    apiKeyUsageRejectReason: undefined,
  },
  {
    id: "xai",
    displayName: "xAI",
    envVarNames: ["XAI_API_KEY"],
    // Source contract: consumer-subscription usage is OAuth-only; API-key
    // authentication is explicitly rejected (review spend at console.x.ai).
    storedOAuth: "bearer-access",
    supportsStoredApiKey: true,
    clientOrigins: ["https://api.x.ai"],
    usageEndpoint: "https://cli-chat-proxy.grok.com/v1/user?include=subscription",
    requiresBearer: false,
    sharedAmbientVarProtected: false,
    apiKeyUsageRejectReason: "xAI consumer usage requires the OAuth subscription account; API-key authentication is not supported for usage review",
  },
  {
    id: "zai",
    displayName: "Z.AI",
    envVarNames: ["ZAI_API_KEY"],
    storedOAuth: "unsupported",
    supportsStoredApiKey: true,
    clientOrigins: ["https://api.z.ai"],
    usageEndpoint: "https://api.z.ai/api/monitor/usage/quota/limit",
    requiresBearer: false,
    sharedAmbientVarProtected: false,
    apiKeyUsageRejectReason: undefined,
  },
  {
    id: "zai-coding-cn",
    displayName: "Z.AI Coding CN",
    envVarNames: ["ZAI_CODING_CN_API_KEY"],
    storedOAuth: "unsupported",
    supportsStoredApiKey: true,
    clientOrigins: ["https://open.bigmodel.cn"],
    usageEndpoint: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
    requiresBearer: false,
    sharedAmbientVarProtected: false,
    apiKeyUsageRejectReason: undefined,
  },
];

export function providerDefinition(providerId: string): ProviderUsageDefinition | undefined {
  return PROVIDER_USAGE_DEFINITIONS.find((definition) => definition.id === providerId);
}

/**
 * GitHub Copilot's source-level endpoint pattern (source `query.ts`
 * `hasOfficialUrlOrigin`): https + api.<region>.githubcopilot.com. The
 * github.com host is not a client endpoint origin; it only classifies the
 * public GitHub account on a stored `enterpriseUrl` field.
 */
const COPILOT_API_HOSTNAME_PATTERN = /^api\.[a-z0-9-]+\.githubcopilot\.com$/u;

export function clientOriginIsOfficial(value: string | undefined, providerId: string): boolean {
  if (value === undefined) return true;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const definition = providerDefinition(providerId);
  if (!definition) return false;
  if (definition.clientOrigins.includes(url.origin)) return true;
  if (providerId === "github-copilot") {
    return url.protocol === "https:" && COPILOT_API_HOSTNAME_PATTERN.test(url.hostname);
  }
  return false;
}
