import type { ProviderUsageDescriptor, ProviderUsageResult } from "@frostime/provider-usage";

/** Safe UI operations. Configuration and credentials remain outside the browser. */
export interface ProviderUsageSource {
  listProviders(signal: AbortSignal): Promise<readonly ProviderUsageDescriptor[]>;
  queryUsage(scope: string, signal: AbortSignal): Promise<readonly ProviderUsageResult[]>;
}
