import { describe, expect, it } from "vitest";
import type { ProviderUsageDescriptor, ProviderUsageResult } from "@frostime/provider-usage";
import { cacheProviderUsage, type ProviderUsageSource } from "../../src/webview/features/provider-usage/providerUsageSource";

const provider: ProviderUsageDescriptor = { providerId: "example", displayName: "Example", availability: "ready", source: "auth.json", reason: "" };
function snapshot(capturedAt: number): ProviderUsageResult {
  return { providerId: "example", source: "auth.json", status: "ready", report: {
    providerId: "example", providerName: "Example", source: "synthetic", capturedAt,
    semantics: { kind: "api-key", label: "Balance" }, buckets: [], metrics: [],
  } };
}
const signal = () => new AbortController().signal;

describe("provider usage snapshot cache", () => {
  it("reuses a successful snapshot across openings/scopes and refreshes only on request", async () => {
    let requests = 0;
    const source = cacheProviderUsage({
      listProviders: () => Promise.resolve([provider, {
        ...provider, providerId: "unconfigured", availability: "unavailable", source: "not-configured", reason: "No accessible credentials.",
      }]),
      queryUsage: () => Promise.resolve([snapshot(++requests)]),
    });
    await source.listProviders(signal());
    const first = await source.queryUsage("example", signal());
    await source.listProviders(signal());
    expect(await source.queryUsage("example", signal())).toEqual(first);
    expect(await source.queryUsage("all", signal())).toEqual(first);
    expect(requests).toBe(1);
    expect(await source.queryUsage("example", signal(), { refresh: true })).toEqual([snapshot(2)]);
  });

  it("does not keep a previous success after failed refresh or cache failures", async () => {
    let requests = 0;
    const failed: ProviderUsageResult = { providerId: "example", source: "auth.json", status: "query-failed", reason: "Request failed." };
    const source = cacheProviderUsage({
      listProviders: () => Promise.resolve([provider]),
      queryUsage: () => Promise.resolve(++requests === 1 ? [snapshot(1)] : [failed]),
    });
    await source.queryUsage("example", signal());
    expect(await source.queryUsage("example", signal(), { refresh: true })).toEqual([failed]);
    expect(await source.queryUsage("example", signal())).toEqual([failed]);
    expect(requests).toBe(3);
  });

  it("drops snapshots when the configured source changes or becomes unavailable", async () => {
    let descriptor = provider;
    let requests = 0;
    const source = cacheProviderUsage({ listProviders: () => Promise.resolve([descriptor]), queryUsage: () => Promise.resolve([snapshot(++requests)]) });
    await source.listProviders(signal());
    await source.queryUsage("example", signal());
    descriptor = { ...provider, source: "models.json" };
    await source.listProviders(signal());
    await source.queryUsage("example", signal());
    expect(requests).toBe(2);
    descriptor = { ...descriptor, availability: "unavailable", reason: "Missing credential." };
    await source.listProviders(signal());
    descriptor = provider;
    await source.listProviders(signal());
    await source.queryUsage("example", signal());
    expect(requests).toBe(3);
  });

  it("does not cache late results from a source that ignores cancellation", async () => {
    let complete!: (result: readonly ProviderUsageResult[]) => void;
    let requests = 0;
    const raw: ProviderUsageSource = {
      listProviders: () => Promise.resolve([provider]),
      queryUsage: () => ++requests === 1 ? new Promise((resolve) => complete = resolve) : Promise.resolve([snapshot(2)]),
    };
    const source = cacheProviderUsage(raw);
    const controller = new AbortController();
    const query = source.queryUsage("example", controller.signal);
    const cancelled = expect(query).rejects.toThrow();
    controller.abort();
    complete([snapshot(1)]);
    await cancelled;
    expect(await source.queryUsage("example", signal())).toEqual([snapshot(2)]);
    expect(requests).toBe(2);
  });
});
