/**
 * Per-provider credential resolution — package policy, not a wholesale
 * adoption of Pi's runtime behavior.
 *
 * Accepted Phase-1 contract (explicit user decisions; see SPEC.md):
 *
 * 1. No silent source substitution. An explicitly configured credential
 *    (auth.json stored entry or provider-level models.json apiKey) that cannot
 *    resolve yields an explicit unavailable result carrying its own source
 *    category. It never falls back to a different account/source. Ambient
 *    variables are only consulted when no explicit source exists — and never
 *    while a configuration file is unreliable (see rule 3).
 * 2. No expiry evaluation and no OAuth refresh/recovery. The local clock is
 *    never compared with stored token expiry; provider requests decide
 *    rejection in Phase 2. Record-shape validation is the only gate.
 * 3. Unreliable configuration files never resolve credentials from another
 *    source: malformed or unreadable auth.json/models.json produces a fixed
 *    safe file-error result for every supported provider (absent files are
 *    simply absent configuration and resolution proceeds normally).
 * 4. Command values (leading `!`) are unsupported and never executed — an
 *    explicit unavailable result with the same source, no fallback.
 *
 * Syntax and provider rules with source snapshots: `configValues.ts`,
 * `providerDefinitions.ts`, UPSTREAM.md.
 */
import { parseConfigValue, resolveConfigValue, type EnvironmentLookup } from "./configValues.js";
import { clientOriginIsOfficial, type ProviderUsageDefinition } from "./providerDefinitions.js";
import {
  type ConfigurationSnapshot,
  isStringRecord,
  type ModelsProviderConfig,
  type StoredApiKeyCredential,
  type StoredOAuthCredential,
} from "./configSnapshot.js";
import { type ProviderSourceCategory, type ReadyProviderCredential, type ResolvedProviderCredential } from "./types.js";

const CHATGPT_DIRECT_TOKEN_SCOPE = "chatgpt.tokens.use.direct";
const COPILOT_API_VERSION_HEADER = "2025-05-01";

const COMMAND_UNSUPPORTED_REASON =
  "credential command values are not supported by this tool; shell commands are never executed";
const STORED_KEY_UNRESOLVED_REASON =
  "the explicitly configured stored credential has no resolvable key value; no other source is used";
const MODELS_KEY_UNRESOLVED_REASON =
  "the explicitly configured models.json credential has no resolvable key value; no other source is used";
const EMPTY_AUTHORIZATION_REASON = "the explicitly configured Authorization header value is empty";
const NOT_CONFIGURED_REASON = "no configured credential source was found for this provider";
const UNOFFICIAL_ENDPOINT_REASON =
  "the configured endpoint is not an official origin, so this credential is never sent to the official usage endpoints";
const HEADER_CANNOT_RESOLVE_REASON = "a configured models.json header value cannot be resolved";
const WRONG_STORED_KIND_REASON = "the stored credential kind does not match this provider's usage authentication";
const CHATGPT_GRANT_INCOMPLETE_REASON = "the stored OpenAI OAuth credential is not a complete native ChatGPT grant";
const COPILOT_ENTERPRISE_REASON = "GitHub Copilot usage does not yet support GitHub Enterprise accounts";
const COPILOT_INCOMPLETE_REASON = "the stored GitHub Copilot OAuth credential is incomplete";
const OPENAI_GRANT_MISMATCH_REASON = "the configured OpenAI authorization does not match the stored native ChatGPT grant";
const AMBIENT_REGION_UNKNOWN_REASON =
  "the shared regional environment variable cannot determine which region's account applies";
const BEARER_REQUIRED_REASON = "this provider's usage API requires Bearer authentication";
const AUTH_FILE_UNRELIABLE_REASON =
  "the auth.json file could not be read reliably, so no credential is resolved from configuration";
const MODELS_FILE_UNRELIABLE_REASON =
  "the models.json file could not be read reliably, so no credential is resolved from configuration";

/** Truthful ready-result notes (safe; shown by inspection tooling and SPEC). */
const READY_COMMON_NOTE =
  "has no OAuth refresh, repair, or local-clock expiry evaluation; it is not guaranteed to " +
  "match an active Pi session credential and provider requests decide rejection";

function readyNotes(source: ProviderSourceCategory): readonly string[] {
  const provenance =
    source === "auth.json"
      ? "resolved from the explicitly provided auth.json configuration"
      : source === "models.json"
        ? "resolved from provider-level models.json configuration"
        : "resolved from a predefined environment variable";
  return [provenance, `this package ${READY_COMMON_NOTE}`];
}

export function resolveProviderCredential(
  definition: ProviderUsageDefinition,
  snapshot: ConfigurationSnapshot,
  capturedAt: number,
  includeAmbientEnvName: boolean,
): ResolvedProviderCredential {
  const modelsConfig = snapshot.modelsProviders.get(definition.id);

  // Endpoint eligibility does not depend on the credential source: a
  // configured client endpoint on a non-official origin blocks forwarding the
  // credential to the official usage endpoints.
  const endpointReason = configuredEndpointReason(definition, modelsConfig);

  const candidate = resolveCandidate(definition, snapshot, includeAmbientEnvName);
  const outcome = applyProviderExceptions(definition, candidate, capturedAt);

  if (!endpointReason) return outcome;
  if (outcome.status === "unavailable" && outcome.source === "not-configured" && !modelsConfig) {
    // Nothing was configured at all; keep the original not-configured result.
    return outcome;
  }
  // An incompatible endpoint dominates an otherwise usable credential; keep
  // the credential's source category for provenance.
  return unavailable(definition.id, outcome.source, endpointReason, capturedAt);
}

/** Internal resolution state after source selection, before provider rules. */
type CandidateResolution =
  | {
      kind: "ready";
      source: ProviderSourceCategory;
      authorization: string;
      secretPool: readonly string[];
      envVarName?: string;
      extraHeaders?: Record<string, string>;
      /** Whether this ready credential came from stored OAuth or an API-key path. */
      authKind: "api-key" | "stored-oauth";
    }
  | { kind: "unavailable"; source: ProviderSourceCategory; reason: string };

function unavailable(
  providerId: string,
  source: ProviderSourceCategory,
  reason: string,
  capturedAt: number,
): ResolvedProviderCredential {
  return { providerId, source, capturedAt, status: "unavailable", reason };
}

function toOutcome(providerId: string, candidate: CandidateResolution, capturedAt: number): ResolvedProviderCredential {
  if (candidate.kind === "unavailable") {
    return unavailable(providerId, candidate.source, candidate.reason, capturedAt);
  }
  const outcome: ReadyProviderCredential = {
    providerId,
    source: candidate.source,
    capturedAt,
    status: "ready",
    authorization: candidate.authorization,
    secrets: [...new Set(candidate.secretPool)],
    notes: readyNotes(candidate.source),
  };
  if (candidate.envVarName !== undefined) outcome.ambientVarName = candidate.envVarName;
  if (candidate.extraHeaders !== undefined) outcome.extraHeaders = candidate.extraHeaders;
  return outcome;
}

function resolveCandidate(
  definition: ProviderUsageDefinition,
  snapshot: ConfigurationSnapshot,
  includeAmbientEnvName: boolean,
): CandidateResolution {
  // Rule 3: unreliable configuration files never substitute another source.
  const fileError = configurationFileError(snapshot);
  if (fileError) return fileError;

  const stored = snapshot.storedCredentials.get(definition.id);
  // 1) An explicit stored credential owns the provider and never falls back.
  if (stored) {
    if (stored.kind === "oauth") {
      return resolveStoredOAuth(definition, stored, snapshot);
    }
    return resolveStoredApiKey(definition, stored, snapshot);
  }

  // 2) Provider-level models.json apiKey (still an explicit source: no fallback).
  const modelsCandidate = resolveModelsApiKey(definition, snapshot);
  if (modelsCandidate) return modelsCandidate;

  // 3) Predefined ambient variables, only when no explicit source exists.
  return resolveAmbient(definition, snapshot, includeAmbientEnvName);
}

/** Rule 3: a malformed/unreadable configuration file blocks all resolution. */
function configurationFileError(snapshot: ConfigurationSnapshot): CandidateResolution | undefined {
  if (snapshot.authFileState === "malformed" || snapshot.authFileState === "unreadable") {
    return { kind: "unavailable", source: "auth.json", reason: AUTH_FILE_UNRELIABLE_REASON };
  }
  if (snapshot.modelsFileState === "malformed" || snapshot.modelsFileState === "unreadable") {
    return { kind: "unavailable", source: "models.json", reason: MODELS_FILE_UNRELIABLE_REASON };
  }
  return undefined;
}

/** Applies source-verified, provider-specific rejection rules to a candidate. */
function applyProviderExceptions(
  definition: ProviderUsageDefinition,
  candidate: CandidateResolution,
  capturedAt: number,
): ResolvedProviderCredential {
  if (candidate.kind === "unavailable") {
    return toOutcome(definition.id, candidate, capturedAt);
  }
  if (definition.apiKeyUsageRejectReason !== undefined && candidate.authKind === "api-key") {
    // Verified source rule (OpenAI, xAI): API-key authentication cannot drive
    // usage queries for these providers. Stored-OAuth results are unaffected.
    return unavailable(definition.id, candidate.source, definition.apiKeyUsageRejectReason, capturedAt);
  }
  if (definition.requiresBearer && !extractBearer(candidate.authorization)) {
    return unavailable(definition.id, candidate.source, BEARER_REQUIRED_REASON, capturedAt);
  }
  return toOutcome(definition.id, candidate, capturedAt);
}

// ---------------------------------------------------------------------------
// Stored API-key credentials (rule 1: explicit source blocks any substitution)
// ---------------------------------------------------------------------------

function resolveStoredApiKey(
  definition: ProviderUsageDefinition,
  stored: StoredApiKeyCredential,
  snapshot: ConfigurationSnapshot,
): CandidateResolution {
  if (!definition.supportsStoredApiKey) {
    // Pi resolves no auth for a stored API-key credential of an OAuth-only
    // provider (no ambient fallback, no models.json consultation).
    return { kind: "unavailable", source: "auth.json", reason: WRONG_STORED_KIND_REASON };
  }
  const rawKey = stored.rawKey;
  if (rawKey === undefined) {
    // Explicit keyless stored entry: no usable credential, no substitution.
    return { kind: "unavailable", source: "auth.json", reason: STORED_KEY_UNRESOLVED_REASON };
  }
  if (parseConfigValue(rawKey).kind === "command") {
    // Unsupported selected source: explicit reason, no execution, no fallback.
    return { kind: "unavailable", source: "auth.json", reason: COMMAND_UNSUPPORTED_REASON };
  }
  const resolvedKey = resolveConfigValue(rawKey, credentialEnvChain(snapshot, stored.env));
  if (resolvedKey === undefined || resolvedKey.length === 0) {
    // Package policy: an explicit stored entry that cannot resolve is an
    // explicit failure; no ambient or other-source substitution (rule 1).
    return { kind: "unavailable", source: "auth.json", reason: STORED_KEY_UNRESOLVED_REASON };
  }
  const overrides = resolveHeaderOverrides(
    snapshot.modelsProviders.get(definition.id),
    credentialEnvChain(snapshot, stored.env),
    resolvedKey,
  );
  if ("reason" in overrides) {
    return { kind: "unavailable", source: "auth.json", reason: overrides.reason };
  }
  return {
    kind: "ready",
    source: "auth.json",
    authorization: overrides.authorization ?? `Bearer ${resolvedKey}`,
    secretPool: [resolvedKey, ...headerPool(overrides.headers)],
    authKind: "api-key",
  };
}

// ---------------------------------------------------------------------------
// Provider-level models.json apiKey (rule 1: explicit source blocks substitution)
// ---------------------------------------------------------------------------

function resolveModelsApiKey(definition: ProviderUsageDefinition, snapshot: ConfigurationSnapshot): CandidateResolution | undefined {
  const modelsConfig = snapshot.modelsProviders.get(definition.id);
  const rawKey = modelsConfig?.apiKey;
  if (rawKey === undefined) return undefined;
  if (parseConfigValue(rawKey).kind === "command") {
    // Pi records the command as a configured source; this tool never executes it.
    return { kind: "unavailable", source: "models.json", reason: COMMAND_UNSUPPORTED_REASON };
  }
  const resolvedKey = resolveConfigValue(rawKey, snapshot.environment);
  if (resolvedKey === undefined || resolvedKey.length === 0) {
    // Package policy: an explicit models.json entry that cannot resolve is an
    // explicit failure, still listed; no ambient substitution (rule 1).
    return { kind: "unavailable", source: "models.json", reason: MODELS_KEY_UNRESOLVED_REASON };
  }
  const overrides = resolveHeaderOverrides(modelsConfig, snapshot.environment, resolvedKey);
  if ("reason" in overrides) {
    return { kind: "unavailable", source: "models.json", reason: overrides.reason };
  }
  return {
    kind: "ready",
    source: "models.json",
    authorization: overrides.authorization ?? `Bearer ${resolvedKey}`,
    secretPool: [resolvedKey, ...headerPool(overrides.headers)],
    authKind: "api-key",
  };
}

// ---------------------------------------------------------------------------
// Ambient environment variables (only when no explicit source exists)
// ---------------------------------------------------------------------------

function resolveAmbient(
  definition: ProviderUsageDefinition,
  snapshot: ConfigurationSnapshot,
  includeAmbientEnvName: boolean,
): CandidateResolution {
  const envVar = definition.envVarNames.find((name) => (snapshot.environment(name) ?? "").length > 0);
  if (envVar === undefined) {
    return { kind: "unavailable", source: "not-configured", reason: NOT_CONFIGURED_REASON };
  }
  if (definition.sharedAmbientVarProtected) {
    // Verified source rule (Moonshot regions): the shared variable cannot
    // prove which region's account applies, so no credential is resolved.
    return { kind: "unavailable", source: "environment", reason: AMBIENT_REGION_UNKNOWN_REASON };
  }
  const value = snapshot.environment(envVar) ?? "";
  const overrides = resolveHeaderOverrides(
    snapshot.modelsProviders.get(definition.id),
    snapshot.environment,
    value,
  );
  if ("reason" in overrides) {
    return { kind: "unavailable", source: "environment", reason: overrides.reason };
  }
  return {
    kind: "ready",
    source: "environment",
    authorization: overrides.authorization ?? `Bearer ${value}`,
    secretPool: [value, ...headerPool(overrides.headers)],
    ...(includeAmbientEnvName ? { envVarName: envVar } : {}),
    authKind: "api-key",
  };
}

// ---------------------------------------------------------------------------
// Header configuration (provider-level models.json)
// ---------------------------------------------------------------------------

/**
 * Resolves configured header values and the `authHeader` flag into the final
 * authorization override, in the shape of Pi's `withConfiguredAuth`: a
 * configured `Authorization` header overrides the derived bearer, and an
 * enabled `authHeader` writes `Authorization: Bearer <apiKey>` on top.
 *
 * All-or-nothing and fail-closed: one unresolvable or command-valued entry
 * fails the whole override (the way Pi blocks a provider whose header
 * resolution fails), and an explicitly empty `Authorization` value never
 * mutates into a usable bearer (rule 4: no substitution of an empty
 * authorization).
 */
function resolveHeaderOverrides(
  modelsConfig: ModelsProviderConfig | undefined,
  lookupEnvironment: EnvironmentLookup,
  resolvedApiKey: string,
): ResolvedHeaderOverrides | { reason: string } {
  if (!modelsConfig?.headers && !modelsConfig?.authHeader) {
    return { headers: undefined, authorization: undefined };
  }
  const resolvedHeaders: Record<string, string> = {};
  const rawHeaders = modelsConfig.headers;
  if (rawHeaders) {
    if (Object.keys(rawHeaders).filter((name) => name.toLowerCase() === "authorization").length > 1) {
      return { reason: "Multiple authorization headers are configured; the credential is ambiguous." };
    }
    for (const [name, rawValue] of Object.entries(rawHeaders)) {
      if (parseConfigValue(rawValue).kind === "command") {
        return { reason: COMMAND_UNSUPPORTED_REASON };
      }
      const resolved = resolveConfigValue(rawValue, lookupEnvironment);
      if (resolved === undefined) {
        return { reason: HEADER_CANNOT_RESOLVE_REASON };
      }
      resolvedHeaders[name] = resolved;
    }
  }
  let authorization = headerValueOf(resolvedHeaders, "Authorization");
  if (modelsConfig.authHeader) {
    authorization = `Bearer ${resolvedApiKey}`;
  }
  if (authorization !== undefined && authorization.length === 0) {
    // Rule 4: an explicit empty Authorization stays empty and cannot become
    // ready with an empty bearer; the whole override fails explicitly.
    return { reason: EMPTY_AUTHORIZATION_REASON };
  }
  return {
    headers: Object.keys(resolvedHeaders).length > 0 ? resolvedHeaders : undefined,
    authorization,
  };
}

interface ResolvedHeaderOverrides {
  headers: Record<string, string> | undefined;
  authorization: string | undefined;
}

function headerValueOf(headers: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : headers[key];
}

function headerPool(headers: Record<string, string> | undefined): readonly string[] {
  return headers === undefined ? [] : Object.values(headers);
}

// ---------------------------------------------------------------------------
// Stored OAuth credentials (rule 2: never refreshed, expiry never evaluated)
// ---------------------------------------------------------------------------

function resolveStoredOAuth(
  definition: ProviderUsageDefinition,
  stored: StoredOAuthCredential,
  snapshot: ConfigurationSnapshot,
): CandidateResolution {
  const source: ProviderSourceCategory = "auth.json";
  if (definition.storedOAuth === "unsupported") {
    // The record kind does not match the provider's usage authentication.
    // Shape validation passed; no runtime substitution and no expiry check.
    return { kind: "unavailable", source, reason: WRONG_STORED_KIND_REASON };
  }
  if (!stored.access || (definition.id === "xai" && !stored.refresh)) {
    return { kind: "unavailable", source, reason: "The saved OAuth credential is incomplete." };
  }
  const headers = resolveStoredOAuthHeaders(definition, stored, snapshot);
  if ("reason" in headers) {
    return { kind: "unavailable", source, reason: headers.reason };
  }
  const secretPoolAll = headerPool(headers.resolvedHeaders);
  // These subscription adapters require the chosen account to match its saved
  // OAuth grant (source resolveXaiUsageAuth/resolveGitHubCopilotUsageAuth).
  if (["xai", "github-copilot"].includes(definition.id) && headers.authorization !== undefined && headers.authorization !== `Bearer ${stored.access}`) {
    return { kind: "unavailable", source, reason: "The configured authorization does not match the saved OAuth account." };
  }
  switch (definition.storedOAuth) {
    case "bearer-access": {
      // Pi derives the usage bearer directly from the stored `access` token.
      return {
        kind: "ready",
        source,
        authorization: headers.authorization ?? `Bearer ${stored.access}`,
        secretPool: [stored.access, stored.refresh, ...secretPoolAll],
        authKind: "stored-oauth",
      };
    }
    case "native-chatgpt": {
      if (!nativeGrantIsComplete(stored)) {
        return { kind: "unavailable", source, reason: CHATGPT_GRANT_INCOMPLETE_REASON };
      }
      if (headers.authorization !== undefined && headers.authorization !== `Bearer ${stored.access}`) {
        return { kind: "unavailable", source, reason: OPENAI_GRANT_MISMATCH_REASON };
      }
      return {
        kind: "ready",
        source,
        authorization: `Bearer ${stored.access}`,
        secretPool: [stored.access, stored.refresh, ...secretPoolAll],
        authKind: "stored-oauth",
      };
    }
    case "copilot-refresh": {
      const enterpriseUrl = stored.fields.enterpriseUrl;
      if (typeof enterpriseUrl === "string" && enterpriseUrl && !isPublicGitHubDomain(enterpriseUrl)) {
        return { kind: "unavailable", source, reason: COPILOT_ENTERPRISE_REASON };
      }
      if (!stored.refresh) {
        return { kind: "unavailable", source, reason: COPILOT_INCOMPLETE_REASON };
      }
      // Source rule: the long-lived GitHub token is the Copilot usage bearer,
      // pinned to a fixed GitHub REST version (configured header values are
      // validated for availability above but do not reach the usage request).
      // The short-lived `access` expiry is irrelevant here and never checked.
      return {
        kind: "ready",
        source,
        authorization: `Bearer ${stored.refresh}`,
        secretPool: [stored.refresh, stored.access, ...secretPoolAll],
        extraHeaders: { "X-GitHub-Api-Version": COPILOT_API_VERSION_HEADER },
        authKind: "stored-oauth",
      };
    }
    default: {
      return { kind: "unavailable", source, reason: WRONG_STORED_KIND_REASON };
    }
  }
}

/**
 * The OAuth header environment comes from the stored credential's `env`
 * record, then the ambient lookup; `authHeader` requires an API key, which
 * the stored OAuth access token is (Pi `toAuth` derivation).
 */
function resolveStoredOAuthHeaders(
  definition: ProviderUsageDefinition,
  stored: StoredOAuthCredential,
  snapshot: ConfigurationSnapshot,
): { reason: string } | { authorization: string | undefined; resolvedHeaders: Record<string, string> | undefined } {
  const modelsConfig = snapshot.modelsProviders.get(definition.id);
  const headerConfigured =
    (modelsConfig?.headers !== undefined && Object.keys(modelsConfig.headers).length > 0) ||
    modelsConfig?.authHeader === true;
  if (!headerConfigured) {
    return { authorization: undefined, resolvedHeaders: undefined };
  }
  const credentialEnv = stored.fields.env;
  const lookup: EnvironmentLookup = isStringRecord(credentialEnv)
    ? (name) => nonEmpty(credentialEnv[name]) ?? snapshot.environment(name)
    : snapshot.environment;
  const overrides = resolveHeaderOverrides(modelsConfig, lookup, stored.access);
  if ("reason" in overrides) return overrides;
  return { authorization: overrides.authorization, resolvedHeaders: overrides.headers };
}

function nativeGrantIsComplete(stored: StoredOAuthCredential): boolean {
  const clientId = stored.fields.clientId;
  const scopes = stored.fields.scopes;
  return (
    stored.access.length > 0 &&
    stored.refresh.length > 0 &&
    typeof clientId === "string" &&
    clientId.trim().length > 0 &&
    Array.isArray(scopes) &&
    scopes.every((scope) => typeof scope === "string") &&
    scopes.includes(CHATGPT_DIRECT_TOKEN_SCOPE)
  );
}

function isPublicGitHubDomain(value: string): boolean {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.hostname.toLowerCase() === "github.com";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function extractBearer(authorization: string): string | undefined {
  const match = /^Bearer\s+(.+)$/iu.exec(authorization);
  return match?.[1];
}

function credentialEnvChain(
  snapshot: ConfigurationSnapshot,
  credentialEnv: Readonly<Record<string, string | undefined>>,
): EnvironmentLookup {
  return (name) => nonEmpty(credentialEnv[name]) ?? snapshot.environment(name);
}

/** Pi treats empty environment values as missing (`env?.[name] || process.env[name] || undefined`). */
function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

function configuredEndpointReason(
  definition: ProviderUsageDefinition,
  modelsConfig: ModelsProviderConfig | undefined,
): string | undefined {
  const baseUrl = modelsConfig?.baseUrl;
  if (baseUrl === undefined) return undefined;
  return clientOriginIsOfficial(baseUrl, definition.id) ? undefined : UNOFFICIAL_ENDPOINT_REASON;
}
