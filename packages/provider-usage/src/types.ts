/**
 * Public and internal result types for provider credential resolution.
 *
 * Safe descriptor types may cross the application boundary (bridge/Webview).
 * `ResolvedProviderCredential` is trusted internal output: it carries the real
 * credential material for HTTP callers and must never reach browser code.
 */

import type { UsageFetch } from "./http.js";
import type { UsageReport } from "./providerTypes.js";

/** Safe category of the configured credential source. Never contains variable names. */
export type ProviderSourceCategory = "auth.json" | "models.json" | "environment" | "not-configured";

/** Fixed official navigation metadata, never extracted from provider responses. */
export interface ProviderUsageLink {
  label: string;
  url: string;
}

/** A safe, browser-facing description of one supported configured provider. */
export interface ProviderUsageDescriptor {
  providerId: string;
  displayName: string;
  availability: "ready" | "unavailable";
  links?: readonly ProviderUsageLink[];
  source: ProviderSourceCategory;
  /** Safe reason; sanitized, never file content, always present for unavailable results. */
  reason: string;
}

/** Explicit input for resolution; explicit paths beat agent-directory defaults. */
export interface ProviderResolutionInput {
  /** Pi agent directory containing auth.json and models.json (e.g. `~/.pi/agent`). */
  agentDirectory?: string;
  /** Explicit auth.json path; overrides `agentDirectory`. */
  authPath?: string;
  /** Explicit models.json path; overrides `agentDirectory`. */
  modelsJsonPath?: string;
  /**
   * Authoritative environment map consulted after credential-local environment
   * values. When provided, `process.env` is NOT consulted (keeps tests isolated
   * and matches a Host-supplied environment); when omitted, process.env is used.
   */
  environment?: Readonly<Record<string, string | undefined>>;
}

/** Shared fields of both resolution outcomes. */
interface ResolvedProviderCredentialBase {
  providerId: string;
  source: ProviderSourceCategory;
  /** Capture time (epoch ms) when the resolved configuration was read. */
  capturedAt: number;
}

/**
 * Engine-facing successful resolution for one supported provider.
 *
 * The resolved authorization value is actual credential material for trusted
 * Node callers (Phase 2 HTTP queries). It must never be passed to browser
 * code or formatted without masking.
 */
export interface ReadyProviderCredential extends ResolvedProviderCredentialBase {
  status: "ready";
  /** Final `Authorization: Bearer <token>` value for the usage request. */
  authorization: string;
  /** Request headers beyond the bearer authorization (e.g. required API-version headers). */
  extraHeaders?: Record<string, string>;
  /** Redaction pool for Phase 2 error sanitization; internal only. */
  secrets: readonly string[];
  /** Inspector-only ambient variable name (sensitive; masked before display). */
  ambientVarName?: string;
  /** Safe statements about what was NOT done: no refresh, no runtime-auth matching. */
  notes: readonly string[];
}

/**
 * Explicit "not usable" evidence for one supported provider. Unavailable is a
 * normal result — it never implies silent fallback to another account.
 */
export interface UnavailableProviderCredential extends ResolvedProviderCredentialBase {
  status: "unavailable";
  /** Safe reason; never contains secrets, full environment names, or file content. */
  reason: string;
}

export type ResolvedProviderCredential = ReadyProviderCredential | UnavailableProviderCredential;

/** Optional trusted transport injection; browser requests cannot supply this. */
export interface QueryUsageOptions extends ProviderResolutionInput {
  fetch?: UsageFetch;
}

export type ProviderUsageResult =
  | { providerId: string; status: "ready"; source: ProviderSourceCategory; report: UsageReport }
  | { providerId: string; status: "unavailable" | "query-failed" | "selection-required"; source: ProviderSourceCategory; reason: string };
