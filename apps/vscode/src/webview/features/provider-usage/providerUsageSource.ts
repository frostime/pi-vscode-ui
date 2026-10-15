import type { ProviderUsageDescriptor, ProviderUsageResult } from "@frostime/provider-usage";

/** Safe UI operations. Configuration and credentials remain outside the browser. */
export interface ProviderUsageSource {
  /** Complete supported catalog, including entries with no configured credentials. */
  listProviders(signal: AbortSignal): Promise<readonly ProviderUsageDescriptor[]>;
  queryUsage(scope: string, signal: AbortSignal, options?: { refresh: boolean }): Promise<readonly ProviderUsageResult[]>;
}

/** Keeps successful snapshots for this source's lifetime; never persists account data. */
export function cacheProviderUsage(source: ProviderUsageSource): ProviderUsageSource {
  const snapshots = new Map<string, Extract<ProviderUsageResult, { status: "ready" }>>();
  let providers: readonly ProviderUsageDescriptor[] = [];

  return {
    async listProviders(signal) {
      const listed = await source.listProviders(signal);
      signal.throwIfAborted();
      for (const previous of providers) {
        const current = listed.find((provider) => provider.providerId === previous.providerId);
        if (!current || current.availability !== "ready" || current.source !== previous.source) snapshots.delete(previous.providerId);
      }
      providers = listed;
      return listed;
    },
    async queryUsage(scope, signal, options) {
      signal.throwIfAborted();
      const ids = scope === "all"
        ? providers.filter((provider) => provider.source !== "not-configured").map((provider) => provider.providerId)
        : [scope];
      if (options?.refresh) {
        for (const id of ids) snapshots.delete(id);
      } else if (ids.length && ids.every((id) => snapshots.has(id))) {
        return ids.map((id) => snapshots.get(id)!);
      }
      const results = await source.queryUsage(scope, signal, options);
      signal.throwIfAborted();
      for (const result of results) {
        if (result.status === "ready") snapshots.set(result.providerId, result);
        else snapshots.delete(result.providerId);
      }
      return results;
    },
  };
}
