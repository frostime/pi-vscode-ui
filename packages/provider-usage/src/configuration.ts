/**
 * Public resolution core facade: resolves credentials for every supported
 * provider from explicit configuration paths and environment (trusted Node
 * callers only). See `resolveCredentials.ts` for the resolution rules.
 */
import { loadConfigurationSnapshot } from "./configSnapshot.js";
import { PROVIDER_USAGE_DEFINITIONS } from "./providerDefinitions.js";
import { resolveProviderCredential } from "./resolveCredentials.js";
import { type ProviderResolutionInput, type ResolvedProviderCredential } from "./types.js";

/**
 * Internal-only option: request the predefined ambient variable name that
 * produced a ready credential, so the opt-in inspection tooling can print a
 * masked name. The value is sensitive and must always be masked before
 * display; safe descriptors never carry it.
 */
export interface ResolutionInput extends ProviderResolutionInput {
  includeAmbientEnvName?: boolean;
}

/**
 * Resolves credentials for every supported provider. Configuration problems
 * surface as explicit unavailable results with safe reasons; resolution never
 * throws for configuration issues.
 */
export async function resolveProviderCredentials(
  input: ResolutionInput,
): Promise<readonly ResolvedProviderCredential[]> {
  const snapshot = await loadConfigurationSnapshot(input);
  const capturedAt = Date.now();
  return PROVIDER_USAGE_DEFINITIONS.map((definition) =>
    resolveProviderCredential(definition, snapshot, capturedAt, input.includeAmbientEnvName === true),
  );
}
