/**
 * Opt-in development inspection with masked output only.
 *
 * The formatter is always safe (every credential-bearing value and
 * environment name is masked through `maskSecret`/`maskEnvName`); reading real
 * configuration is exclusively an explicit, manual invocation — never a unit
 * test or CI step. See the package SPEC for invocation.
 *
 * Example shape (fake values):
 *   openai-codex  ready        source=auth.json   credential=abc…[masked]…xyz
 *   deepseek      ready        source=environment name=DEE…[masked]…KEY credential=def…[masked]…uvw
 *   openrouter    unavailable  reason=required environment value missing
 */
import { maskEnvName, maskSecret } from "./masking.js";
import { resolveProviderCredentials, type ResolutionInput } from "./configuration.js";
import { type ResolvedProviderCredential } from "./types.js";

/**
 * Builds the masked inspection report. Never network-attached; reads only the
 * configured auth/models files this input names.
 */
export async function buildMaskedInspectionReport(
  input: ResolutionInput,
  providerIds?: readonly string[],
): Promise<string> {
  const outcomes = await resolveProviderCredentials(input);
  const selected = providerIds === undefined ? undefined : new Set(providerIds);
  return outcomes
    .filter((outcome) => selected === undefined || selected.has(outcome.providerId))
    .map((outcome) => formatInspectionLine(outcome))
    .join("\n");
}

function formatInspectionLine(outcome: ResolvedProviderCredential): string {
  const availability = outcome.status === "ready" ? "ready" : "unavailable";
  const base = `${outcome.providerId}  ${availability}  source=${outcome.source}`;
  // Unavailable reasons are fixed safe strings; no credential material can appear.
  if (outcome.status === "unavailable") {
    return `${base}  reason=${outcome.reason}`;
  }
  // Inspector-only: the ready credential's masked auth fragment.
  const envName = outcome.ambientVarName === undefined ? "" : ` name=${maskEnvName(outcome.ambientVarName)}`;
  return `${base}${envName}  credential=${maskSecret(firstAuthorizationFragment(outcome.authorization))}`;
}

/** Chooses the masked fragment; the authorization is a `Bearer <token>` value. */
function firstAuthorizationFragment(authorization: string): string {
  const match = /^Bearer\s+(.+)$/iu.exec(authorization);
  return match?.[1] ?? "";
}
