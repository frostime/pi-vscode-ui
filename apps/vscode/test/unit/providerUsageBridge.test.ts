import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostToWebviewMessage } from "../../src/shared/bridge/hostToWebview.js";
import { BRIDGE_VERSION } from "../../src/shared/bridge/bridgeVersion.js";

const bridge = vi.hoisted(() => ({
  post: vi.fn(), listeners: new Set<(message: HostToWebviewMessage) => void>(),
}));
vi.mock("../../src/webview/bridge/vscodeBridge", () => ({
  postToHost: bridge.post,
  onHostMessage: (listener: (message: HostToWebviewMessage) => void) => {
    bridge.listeners.add(listener); return () => bridge.listeners.delete(listener);
  },
}));
const { bridgeProviderUsageSource } = await import("../../src/webview/features/provider-usage/bridgeProviderUsageSource");
function deliver(message: HostToWebviewMessage): void { for (const listener of bridge.listeners) listener(message); }
function requestId(): string { return (bridge.post.mock.calls.at(-1)![0] as { requestId: string }).requestId; }

beforeEach(() => { bridge.post.mockClear(); bridge.listeners.clear(); });

describe("usage bridge source", () => {
  it("matches request IDs, response kinds and bridge version; returns safe results", async () => {
    const result = bridgeProviderUsageSource.listProviders(new AbortController().signal);
    const id = requestId();
    deliver({ type: "usageProvidersResult", requestId: "other", bridgeVersion: BRIDGE_VERSION, providers: [] });
    deliver({ type: "usageProvidersResult", requestId: id, bridgeVersion: "old", providers: [] });
    deliver({ type: "providerUsageResult", requestId: id, bridgeVersion: BRIDGE_VERSION, results: [] });
    expect(bridge.listeners.size).toBe(1);
    const providers = [{ providerId: "deepseek", displayName: "DeepSeek", availability: "ready" as const, source: "auth.json" as const, reason: "" }];
    deliver({ type: "usageProvidersResult", requestId: id, bridgeVersion: BRIDGE_VERSION, providers });
    expect(await result).toEqual(providers);
    expect(bridge.listeners.size).toBe(0);
  });

  it("sends cancellation and removes listeners; errors do not leak raw text", async () => {
    const controller = new AbortController();
    const query = bridgeProviderUsageSource.queryUsage("deepseek", controller.signal);
    const id = requestId();
    const rejected = expect(query).rejects.toThrow("cancelled");
    controller.abort(); await rejected;
    expect(bridge.post).toHaveBeenLastCalledWith({ type: "cancelProviderUsage", requestId: id });
    expect(bridge.listeners.size).toBe(0);
    const failed = bridgeProviderUsageSource.listProviders(new AbortController().signal);
    const safeError = expect(failed).rejects.toThrow("Provider usage request failed.");
    deliver({ type: "providerUsageError", requestId: requestId(), bridgeVersion: BRIDGE_VERSION, message: "Private synthetic details" });
    await safeError;
    expect(bridge.listeners.size).toBe(0);
  });
});
