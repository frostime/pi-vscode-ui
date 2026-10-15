/**
 * Safe, app-facing provider listing built on the internal resolution core.
 *
 * By default, only providers with a relevant configured credential source are
 * listed. Include unconfigured definitions to distinguish unsupported providers
 * from supported providers whose credentials cannot be obtained.
 * Descriptors never contain credentials, environment variable names, file
 * content or raw errors. Unavailable results keep their safe reason (this
 * includes unsupported kinds, command values, unofficial endpoints and the
 * Moonshot necessary regional guard).
 */
import { PROVIDER_USAGE_DEFINITIONS } from "./providerDefinitions.js";
import { resolveProviderCredentials } from "./configuration.js";
import { type ProviderResolutionInput, type ProviderUsageDescriptor } from "./types.js";

export async function listProviders(
  input: ProviderResolutionInput,
  options?: { includeUnconfigured: boolean },
): Promise<readonly ProviderUsageDescriptor[]> {
  const outcomes = await resolveProviderCredentials(input);
  const definitions = new Map(PROVIDER_USAGE_DEFINITIONS.map((definition) => [definition.id, definition]));
  return outcomes
    .filter((outcome) => options?.includeUnconfigured || outcome.source !== "not-configured")
    .map((outcome) => {
      const definition = definitions.get(outcome.providerId);
      const descriptor: ProviderUsageDescriptor = {
        providerId: outcome.providerId,
        displayName: definition?.displayName ?? outcome.providerId,
        ...(definition?.links ? { links: definition.links } : {}),
        availability: outcome.status === "ready" ? "ready" : "unavailable",
        source: outcome.source,
        reason: outcome.status === "unavailable" ? outcome.reason : "",
      };
      return descriptor;
    });
}
