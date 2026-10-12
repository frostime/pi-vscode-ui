/**
 * Safe, app-facing provider listing built on the internal resolution core.
 *
 * Only providers with a relevant configured credential source are listed;
 * unconfigured built-in providers and unknown custom providers are omitted.
 * Descriptors never contain credentials, environment variable names, file
 * content or raw errors. Unavailable results keep their safe reason (this
 * includes unsupported kinds, command values, unofficial endpoints and the
 * Moonshot necessary regional guard).
 */
import { PROVIDER_USAGE_DEFINITIONS } from "./providerDefinitions.js";
import { resolveProviderCredentials } from "./configuration.js";
import { type ProviderResolutionInput, type ProviderUsageDescriptor } from "./types.js";

export async function listProviders(input: ProviderResolutionInput): Promise<readonly ProviderUsageDescriptor[]> {
  const outcomes = await resolveProviderCredentials(input);
  const names = new Map(PROVIDER_USAGE_DEFINITIONS.map((definition) => [definition.id, definition.displayName]));
  return outcomes
    .filter((outcome) => outcome.source !== "not-configured")
    .map((outcome) => {
      const descriptor: ProviderUsageDescriptor = {
        providerId: outcome.providerId,
        displayName: names.get(outcome.providerId) ?? outcome.providerId,
        availability: outcome.status === "ready" ? "ready" : "unavailable",
        source: outcome.source,
        reason: outcome.status === "unavailable" ? outcome.reason : "",
      };
      return descriptor;
    });
}
