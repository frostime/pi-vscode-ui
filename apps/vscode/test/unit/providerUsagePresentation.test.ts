import { render } from "svelte/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderUsageResult, UsageReport } from "@frostime/provider-usage";

import ProviderUsageReport from "../../src/webview/features/provider-usage/ProviderUsageReport.svelte";
import { bucketProgress, formatUsageValue } from "../../src/webview/features/provider-usage/providerUsagePresentation";
import { mockProviderUsageSource } from "./providerUsageFixtures";
import SessionMetrics from "../../src/webview/shell/SessionMetrics.svelte";

async function mockReports(): Promise<readonly ProviderUsageResult[]> {
  vi.useFakeTimers();
  const query = mockProviderUsageSource.queryUsage("all", new AbortController().signal);
  await vi.runAllTimersAsync();
  return query;
}

function readyReport(results: readonly ProviderUsageResult[], id: string): UsageReport {
  const result = results.find((item) => item.providerId === id);
  if (result?.status !== "ready") throw new Error("Expected a synthetic ready report.");
  return result.report;
}

afterEach(() => vi.useRealTimers());

describe("provider usage presentation", () => {
  it("places Usage beside Context in the sidebar metrics without adding it to restricted panels", () => {
    const session = {
      stats: { cost: 0.084 }, extensionStatuses: [],
    } as never;
    const sidebar = render(SessionMetrics, { props: { session, providerUsageAvailable: true } }).body;
    const panel = render(SessionMetrics, { props: { session } }).body;
    expect(sidebar).toContain('aria-label="Provider usage"');
    expect(sidebar.indexOf(">Usage</button>")).toBeLessThan(sidebar.indexOf("Context"));
    expect(panel).not.toContain('aria-label="Provider usage"');
  });

  it("preserves quota groups, reset timestamps in seconds, and read-only reset availability", async () => {
    const report = readyReport(await mockReports(), "openai-codex");
    const { body } = render(ProviderUsageReport, { props: { report } });

    expect(body).toContain("Codex Spark");
    expect(body).toContain("5-hour window");
    expect(body).toContain("38%");
    expect(body).toContain("Usage limit resets");
    expect(body).toContain(new Date(report.buckets[0]!.resetsAt! * 1_000).toISOString());
    expect(body).toContain(new Date(report.capturedAt).toISOString());
    expect(body).not.toContain("<button");
  });

  it("keeps different balances separate and never invents a quota bar", async () => {
    const report = readyReport(await mockReports(), "deepseek");
    const { body } = render(ProviderUsageReport, { props: { report } });

    expect(body).toContain("CNY 128.40");
    expect(body).toContain("USD 4.20");
    expect(body).not.toContain("class=\"usage-bar");
    expect(body).not.toContain("remaining");
  });

  it("does not turn a missing counter into zero and clamps only the visual bar", () => {
    expect(bucketProgress({ id: "a", label: "Quota", unit: "percent", remaining: 40 })).toBeUndefined();
    expect(bucketProgress({ id: "b", label: "Quota", unit: "count", used: 10 })).toBeUndefined();
    expect(bucketProgress({ id: "c", label: "Quota", unit: "percent", used: 130 })).toBe(100);
    expect(formatUsageValue(130, "percent")).toBe("130%");
    expect(formatUsageValue(0, "count")).toBe("0");

    const report: UsageReport = {
      providerId: "example", providerName: "Example", capturedAt: 1_700_000_000_000, source: "synthetic",
      semantics: { kind: "consumer-subscription", label: "Quota" },
      buckets: [{ id: "remaining", label: "Allowance", unit: "count", remaining: 40 }], metrics: [],
    };
    const { body } = render(ProviderUsageReport, { props: { report } });
    expect(body).toContain("40 remaining");
    expect(body).not.toContain(" used</strong>");
    expect(body).not.toContain("class=\"usage-bar");
  });

  it("shows native ChatGPT's limited result without numeric quota", async () => {
    const report = readyReport(await mockReports(), "openai");
    const { body } = render(ProviderUsageReport, { props: { report } });

    expect(body).toContain("Connected (native OAuth)");
    expect(body).toContain("Numerical usage and reset times are unavailable");
    expect(body).not.toContain("<button");
    expect(body).not.toContain("class=\"usage-bar");
  });

  it("supplies mixed real-format results for UI review, including unavailable and account selection", async () => {
    const results = await mockReports();
    expect(results.map((result) => result.status)).toEqual([
      "ready", "ready", "ready", "ready", "query-failed", "selection-required", "unavailable",
    ]);
  });

  it("allows closing/replacing a mock request without a late result", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const query = mockProviderUsageSource.queryUsage("all", controller.signal);
    const rejected = expect(query).rejects.toThrow("Mock query cancelled.");
    controller.abort();
    await vi.runAllTimersAsync();
    await rejected;
  });
});
