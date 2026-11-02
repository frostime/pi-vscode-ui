import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderUsageDescriptor, ProviderUsageResult } from "@frostime/provider-usage";
import ProviderUsagePanel from "$ui/features/provider-usage/ProviderUsagePanel.svelte";
import { cacheProviderUsage, type ProviderUsageSource } from "$ui/features/provider-usage/providerUsageSource";

const bridge = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("$ui/bridge/hostBridge", () => ({ postToHost: bridge.post }));

const officialUrl = "https://chatgpt.com/settings/usage";
const providers: readonly ProviderUsageDescriptor[] = [
  { providerId: "example", displayName: "Example", availability: "ready", source: "auth.json", reason: "",
    links: [{ label: "Official usage page", url: officialUrl }] },
  { providerId: "other", displayName: "Other", availability: "ready", source: "auth.json", reason: "" },
];
const snapshot = (providerId: string, value: string): ProviderUsageResult => ({
  providerId, source: "auth.json", status: "ready", report: {
    providerId, providerName: providerId, capturedAt: 1_700_000_000_000, source: "synthetic",
    semantics: { kind: "api-key", label: "Synthetic usage" }, buckets: [],
    metrics: [{ id: "balance", label: "Balance", value }], notes: ["Arbitrary explanatory text"],
  },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("provider usage component interaction", () => {
  it("explicitly identifies an unsupported current provider without querying, while allowing other providers", async () => {
    const queryUsage = vi.fn<ProviderUsageSource["queryUsage"]>()
      .mockResolvedValue([snapshot("other", "other-result")]);
    const view = render(ProviderUsagePanel, {
      source: { listProviders: () => Promise.resolve(providers), queryUsage },
      currentProviderId: "custom-provider", onclose: vi.fn(),
    });
    await waitFor(() => expect(view.queryByText(/not supported for custom-provider/)).not.toBeNull());
    expect(view.getByRole("button", { name: "Provider: custom-provider" }).textContent).toContain("custom-provider");
    expect((view.getByRole("button", { name: "Query usage" }) as HTMLButtonElement).disabled).toBe(true);
    expect(queryUsage).not.toHaveBeenCalled();
    await fireEvent.click(view.getByRole("button", { name: "Provider: custom-provider" }));
    await fireEvent.click(view.getByRole("option", { name: "Other" }));
    await waitFor(() => expect(view.queryByText("other-result")).not.toBeNull());
    expect(view.queryByText(/not supported for custom-provider/)).toBeNull();
  });

  it("keeps an unavailable provider unqueryable and lists only usable providers", async () => {
    const queryUsage = vi.fn<ProviderUsageSource["queryUsage"]>();
    const unavailable: ProviderUsageDescriptor = {
      ...providers[0]!, availability: "unavailable", source: "not-configured",
      reason: "No supported saved credential source is available.",
    };
    const view = render(ProviderUsagePanel, {
      source: {
        listProviders: () => Promise.resolve([unavailable, { ...unavailable, providerId: "unused", displayName: "Unused" }]),
        queryUsage,
      },
      currentProviderId: "example", onclose: vi.fn(),
    });
    await waitFor(() => expect(view.queryByRole("button", { name: "Provider: Example" })).not.toBeNull());
    await fireEvent.click(view.getByRole("button", { name: "Provider: Example" }));
    expect(view.queryByRole("option", { name: /Unused/ })).toBeNull();
    expect(view.queryByRole("option", { name: "All configured providers" })).toBeNull();
    expect((view.getByRole("button", { name: "Query usage" }) as HTMLButtonElement).disabled).toBe(true);
    expect(queryUsage).not.toHaveBeenCalled();
  });

  it("navigates the picker without querying, commits with the keyboard and dismisses Escape before the panel", async () => {
    const queryUsage = vi.fn<ProviderUsageSource["queryUsage"]>()
      .mockImplementation((scope) => Promise.resolve([snapshot(scope, `result-${scope}`)]));
    const onclose = vi.fn();
    const view = render(ProviderUsagePanel, {
      source: { listProviders: () => Promise.resolve(providers), queryUsage },
      currentProviderId: "example", onclose,
    });
    await waitFor(() => expect(view.queryByText("result-example")).not.toBeNull());
    const trigger = view.getByRole("button", { name: "Provider: Example" });
    await fireEvent.keyDown(trigger, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(view.getByRole("option", { name: "Example" })));
    expect(view.queryByRole("option", { name: "Choose a provider…" })).toBeNull();
    expect(view.getByRole("option", { name: "Example" }).getAttribute("aria-selected")).toBe("true");

    await fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(view.getByRole("option", { name: "Other" }));
    await fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(view.getByRole("option", { name: "All configured providers" }));
    await fireEvent.keyDown(document.activeElement!, { key: "o" });
    expect(document.activeElement).toBe(view.getByRole("option", { name: "Other" }));
    expect(queryUsage).toHaveBeenCalledTimes(1);
    await fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    await waitFor(() => expect(view.queryByText("result-other")).not.toBeNull());
    expect(view.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(queryUsage).toHaveBeenCalledTimes(2);

    await fireEvent.click(trigger);
    await waitFor(() => expect(document.activeElement).toBe(view.getByRole("option", { name: "Other" })));
    await fireEvent.keyDown(document.activeElement!, { key: " " });
    expect(queryUsage).toHaveBeenCalledTimes(2);
    await fireEvent.click(trigger);
    await fireEvent.keyDown(view.getByRole("option", { name: "Other" }), { key: "Escape" });
    expect(view.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onclose).not.toHaveBeenCalled();
    await fireEvent.keyDown(trigger, { key: "Escape" });
    expect(onclose).toHaveBeenCalledWith(true);
  });

  it("dismisses the picker on focus leaving its controls without restoring focus", async () => {
    const view = render(ProviderUsagePanel, {
      source: { listProviders: () => Promise.resolve(providers), queryUsage: () => Promise.resolve([snapshot("example", "ready")]) },
      currentProviderId: "example", onclose: vi.fn(),
    });
    await waitFor(() => expect(view.queryByText("ready")).not.toBeNull());
    await fireEvent.click(view.getByRole("button", { name: "Provider: Example" }));
    await waitFor(() => expect(document.activeElement).toBe(view.getByRole("option", { name: "Example" })));
    const refresh = view.getByRole("button", { name: "Refresh usage" });
    refresh.focus();
    await waitFor(() => expect(view.queryByRole("listbox")).toBeNull());
    expect(document.activeElement).toBe(refresh);
  });

  it("auto-loads, reuses the snapshot after closing/reopening, refreshes and opens predefined links", async () => {
    let requests = 0;
    const source = cacheProviderUsage({
      listProviders: () => Promise.resolve(providers),
      queryUsage: () => Promise.resolve([snapshot("example", `snapshot-${++requests}`)]),
    });
    let view = render(ProviderUsagePanel, { source, currentProviderId: "example", onclose: () => view.unmount() });
    await waitFor(() => expect(view.queryByText("snapshot-1")).not.toBeNull());
    await fireEvent.click(view.getByRole("button", { name: /Official usage page/ }));
    expect(bridge.post).toHaveBeenCalledWith({ type: "openExternal", url: officialUrl });
    await fireEvent.click(view.getByRole("button", { name: "Close provider usage" }));
    expect(document.querySelector("dialog")).toBeNull();
    view = render(ProviderUsagePanel, { source, currentProviderId: "example", onclose: () => view.unmount() });
    await waitFor(() => expect(view.queryByText("snapshot-1")).not.toBeNull());
    expect(requests).toBe(1);
    await fireEvent.click(view.getByRole("button", { name: "Refresh usage" }));
    await waitFor(() => expect(view.queryByText("snapshot-2")).not.toBeNull());
    expect(requests).toBe(2);
  });

  it("clears an old success when Refresh fails and keeps the official link available", async () => {
    let requests = 0;
    const source = cacheProviderUsage({
      listProviders: () => Promise.resolve(providers),
      queryUsage: () => ++requests === 1
        ? Promise.resolve([snapshot("example", "old-success")])
        : Promise.reject(new Error("Synthetic failure")),
    });
    const view = render(ProviderUsagePanel, { source, currentProviderId: "example", onclose: vi.fn() });
    await waitFor(() => expect(view.queryByText("old-success")).not.toBeNull());
    await fireEvent.click(view.getByRole("button", { name: "Refresh usage" }));
    await waitFor(() => expect(view.queryByText(/Could not retrieve usage/)).not.toBeNull());
    expect(view.queryByText("old-success")).toBeNull();
    expect(view.queryByText(/Official usage page/)).not.toBeNull();
    await fireEvent.click(view.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(requests).toBe(3));
    expect(view.queryByText("old-success")).toBeNull();
  });

  it("cancels selection changes and unmounts; ignored aborts cannot overwrite the current result or cache", async () => {
    const first = deferred<readonly ProviderUsageResult[]>();
    const last = deferred<readonly ProviderUsageResult[]>();
    const signals: AbortSignal[] = [];
    let requests = 0;
    const raw: ProviderUsageSource = {
      listProviders: () => Promise.resolve(providers),
      queryUsage: (scope, signal) => {
        signals.push(signal);
        requests++;
        if (requests === 1) return first.promise;
        if (requests === 3) return last.promise;
        return Promise.resolve([snapshot(scope, "current-result")]);
      },
    };
    const source = cacheProviderUsage(raw);
    const view = render(ProviderUsagePanel, { source, currentProviderId: "example", onclose: () => view.unmount() });
    await waitFor(() => expect(signals.length).toBe(1));
    await fireEvent.click(view.getByRole("button", { name: "Provider: Example" }));
    await fireEvent.click(view.getByRole("option", { name: "Other" }));
    await waitFor(() => expect(view.queryByText("current-result")).not.toBeNull());
    expect(signals[0]!.aborted).toBe(true);
    first.resolve([snapshot("example", "stale-result")]);
    await waitFor(() => expect(view.queryByText(/Fetching usage/)).toBeNull());
    expect(view.queryByText("stale-result")).toBeNull();
    await fireEvent.click(view.getByRole("button", { name: "Provider: Other" }));
    await fireEvent.click(view.getByRole("option", { name: "Example" }));
    await waitFor(() => expect(signals.length).toBe(3));
    view.unmount();
    expect(signals[2]!.aborted).toBe(true);
    last.resolve([snapshot("example", "closed-result")]);
    const reopened = render(ProviderUsagePanel, { source, currentProviderId: "example", onclose: () => reopened.unmount() });
    await waitFor(() => expect(reopened.queryByText("current-result")).not.toBeNull());
    expect(requests).toBe(4);
    expect(reopened.queryByText("closed-result")).toBeNull();
  });
});
