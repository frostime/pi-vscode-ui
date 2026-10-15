import type { ProviderUsageDescriptor, ProviderUsageResult } from "@frostime/provider-usage";

import type { ProviderUsageSource } from "../../src/webview/features/provider-usage/providerUsageSource";

const providers: readonly ProviderUsageDescriptor[] = [
  { providerId: "openai-codex", displayName: "OpenAI Codex", availability: "ready", source: "auth.json", reason: "" },
  { providerId: "deepseek", displayName: "DeepSeek", availability: "ready", source: "environment", reason: "" },
  { providerId: "openrouter", displayName: "OpenRouter", availability: "ready", source: "models.json", reason: "" },
  { providerId: "opencode-go", displayName: "OpenCode Go", availability: "ready", source: "auth.json", reason: "" },
  { providerId: "openai", displayName: "OpenAI · native ChatGPT", availability: "ready", source: "auth.json", reason: "" },
  { providerId: "github-copilot", displayName: "GitHub Copilot", availability: "ready", source: "auth.json", reason: "" },
  { providerId: "fireworks", displayName: "Fireworks", availability: "ready", source: "environment", reason: "" },
  { providerId: "kimi-coding", displayName: "Kimi Coding", availability: "unavailable", source: "models.json", reason: "The configured credential cannot be resolved." },
];

/** Temporary, synthetic source for UI review. No credentials, files, fetch or Pi calls. */
export const mockProviderUsageSource: ProviderUsageSource = {
  async listProviders(signal) {
    await waitForMockResponse(signal);
    return providers;
  },
  async queryUsage(scope, signal) {
    await waitForMockResponse(signal);
    const selected = providers.filter((provider) => scope === "all" || provider.providerId === scope);
    return selected.map((provider) => mockResult(provider, Date.now()));
  },
};

function mockResult(provider: ProviderUsageDescriptor, capturedAt: number): ProviderUsageResult {
  const { providerId, source } = provider;
  if (provider.availability === "unavailable") return { providerId, source, status: "unavailable", reason: provider.reason };
  if (providerId === "github-copilot") return { providerId, source, status: "query-failed", reason: "The provider usage request timed out." };
  if (providerId === "fireworks") return { providerId, source, status: "selection-required", reason: "Multiple billing accounts are available. Account selection is not supported." };

  const report = {
    providerId,
    providerName: provider.displayName,
    capturedAt,
    source: `mock-${providerId}`,
  };
  if (providerId === "openai-codex") {
    const resetsAt = Math.floor(capturedAt / 1_000);
    return { providerId, source, status: "ready", report: {
      ...report,
      semantics: { kind: "consumer-subscription", label: "ChatGPT subscription limits" },
      buckets: [
        { id: "codex:primary", label: "Primary limit", groupId: "codex", groupLabel: "Codex", used: 38, remaining: 62, limit: 100, unit: "percent", windowMinutes: 300, resetsAt: resetsAt + 7_200 },
        { id: "codex:secondary", label: "Secondary limit", groupId: "codex", groupLabel: "Codex", used: 72, remaining: 28, limit: 100, unit: "percent", windowMinutes: 10_080, resetsAt: resetsAt + 259_200 },
        { id: "spark:primary", label: "Primary limit", groupId: "spark", groupLabel: "Codex Spark", used: 15, remaining: 85, limit: 100, unit: "percent", windowMinutes: 300, resetsAt: resetsAt + 9_000 },
      ],
      metrics: [{ id: "credits", label: "Credits", value: "none" }, { id: "reset-credits", label: "Usage limit resets", value: 2, unit: "count" }],
      notes: ["Plan: plus"],
    } };
  }
  if (providerId === "deepseek") {
    return { providerId, source, status: "ready", report: {
      ...report, semantics: { kind: "api-key", label: "DeepSeek API balance" }, buckets: [],
      metrics: [
        { id: "api-availability", label: "API calls", value: "available" },
        { id: "cny-total", label: "Total balance", value: "128.40", unit: "currency", currency: "CNY" },
        { id: "cny-granted", label: "Granted balance", value: "28.40", unit: "currency", currency: "CNY" },
        { id: "cny-topped-up", label: "Topped-up balance", value: "100.00", unit: "currency", currency: "CNY" },
        { id: "usd-total", label: "Total balance", value: "4.20", unit: "currency", currency: "USD" },
      ],
    } };
  }
  if (providerId === "opencode-go") {
    const resetsAt = Math.floor(capturedAt / 1_000);
    return { providerId, source, status: "ready", report: {
      ...report, semantics: { kind: "consumer-subscription", label: "OpenCode Zen plan usage" },
      buckets: [
        { id: "rolling", label: "Rolling window", used: 25, remaining: 75, limit: 100, unit: "percent", resetsAt: resetsAt + 7_200 },
        { id: "monthly", label: "Monthly window", used: 100, remaining: 0, limit: 100, unit: "percent", resetsAt: resetsAt + 259_200 },
      ],
      metrics: [], notes: ["Weekly window unavailable (error)."],
    } };
  }
  if (providerId === "openrouter") {
    return { providerId, source, status: "ready", report: {
      ...report, semantics: { kind: "api-key", label: "API-key spend limits" }, accountLabel: "Demo key",
      buckets: [{ id: "key-limit", label: "Key limit", used: 12.5, remaining: 37.5, limit: 50, unit: "usd", period: "monthly" }],
      metrics: [{ id: "usage-daily", label: "Usage today", value: 1.25, unit: "usd" }, { id: "usage-total", label: "All-time usage", value: 48.75, unit: "usd" }],
    } };
  }
  return { providerId, source, status: "ready", report: {
    ...report, semantics: { kind: "consumer-subscription", label: "ChatGPT plan authentication status" }, buckets: [],
    metrics: [{ id: "plan-auth", label: "ChatGPT plan authentication", value: "Connected (native OAuth)" }],
    notes: ["Numerical usage and reset times are unavailable for native OpenAI OAuth."],
  } };
}

function waitForMockResponse(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("Mock query cancelled.")); return; }
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, 350);
    function cancel(): void {
      clearTimeout(timer);
      reject(new Error("Mock query cancelled."));
    }
    signal.addEventListener("abort", cancel, { once: true });
  });
}
