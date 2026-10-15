// Adapted normalization tests from the pinned pi-provider-usage snapshot.
// TUI formatting assertions and Pi runtime tests are intentionally excluded.
import assert from "node:assert/strict";
import { test } from "vitest";
import { normalizeCodexBackendPayload } from "../src/providers/codex.js";
import { normalizeGitHubCopilotUsagePayload } from "../src/providers/github-copilot.js";
import { normalizeOpenRouterKeyPayload } from "../src/providers/openrouter.js";

test("GitHub Copilot adapter normalizes legacy premium request quota", () => {
    const report = normalizeGitHubCopilotUsagePayload({
        login: "octocat",
        copilot_plan: "individual",
        quota_reset_date_utc: "2026-08-01T00:00:00Z",
        quota_snapshots: {
            premium_interactions: {
                entitlement: 300,
                remaining: 245,
                percent_remaining: 81.7,
                token_based_billing: false,
                unlimited: false,
            },
        },
    }, 500);
    assert.equal(report.providerId, "github-copilot");
    assert.equal(report.accountLabel, "octocat");
    assert.deepEqual(report.semantics, {
        kind: "consumer-subscription",
        label: "GitHub Copilot premium request quota",
    });
    assert.deepEqual(report.buckets[0], {
        id: "premium-requests",
        label: "Premium requests",
        used: 55,
        remaining: 245,
        limit: 300,
        unit: "count",
        period: "monthly",
        resetsAt: 1785542400,
    });
});

test("GitHub Copilot adapter preserves AI-credit billing semantics", () => {
    const report = normalizeGitHubCopilotUsagePayload({
        quota_reset_date_utc: "2026-08-01T00:00:00Z",
        quota_snapshots: {
            premium_interactions: {
                credits_used: 300,
                entitlement: 1500,
                remaining: 1200,
                token_based_billing: true,
                unlimited: false,
            },
        },
    }, 550);
    assert.deepEqual(report.semantics, {
        kind: "consumer-subscription",
        label: "GitHub Copilot AI Credits allowance",
    });
    assert.deepEqual(report.buckets[0], {
        id: "ai-credits",
        label: "AI credits",
        used: 300,
        remaining: 1200,
        limit: 1500,
        unit: "count",
        period: "monthly",
        resetsAt: 1785542400,
    });
});

test("GitHub Copilot adapter represents overage without rejecting negative remaining quota", () => {
    const report = normalizeGitHubCopilotUsagePayload({
        quota_snapshots: {
            premium_interactions: {
                entitlement: 1500,
                overage_count: 100,
                overage_permitted: true,
                remaining: -100,
                token_based_billing: true,
                unlimited: false,
            },
        },
    }, 575);
    assert.equal(report.buckets[0]?.remaining, 0);
    assert.equal(report.buckets[0]?.used, 1600);
    assert.deepEqual(report.metrics, [{ id: "overage-used", label: "Additional usage", value: 100, unit: "count" }]);
});

test("GitHub Copilot adapter normalizes the free-tier quota shape", () => {
    const report = normalizeGitHubCopilotUsagePayload({
        access_type_sku: "free_limited_copilot",
        limited_user_quotas: { chat: 40, completions: 1900 },
        limited_user_reset_date: "2026-08-01T00:00:00Z",
        monthly_quotas: { chat: 50, completions: 2000 },
    }, 590);
    assert.deepEqual(report.semantics, {
        kind: "consumer-subscription",
        label: "GitHub Copilot Free chat quota",
    });
    assert.deepEqual(report.buckets[0], {
        id: "chat-requests",
        label: "Chat requests",
        used: 10,
        remaining: 40,
        limit: 50,
        unit: "count",
        period: "monthly",
        resetsAt: 1785542400,
    });
});

test("GitHub Copilot adapter handles unlimited quota and rejects incomplete responses", () => {
    const unlimited = normalizeGitHubCopilotUsagePayload({
        quota_snapshots: { premium_interactions: { unlimited: true } },
    }, 600);
    const unlimitedCredits = normalizeGitHubCopilotUsagePayload({
        quota_snapshots: {
            premium_interactions: { token_based_billing: true, unlimited: true },
        },
    }, 650);
    assert.deepEqual(unlimited.buckets, [{ id: "premium-requests", label: "Premium requests", unit: "count" }]);
    assert.deepEqual(unlimitedCredits.buckets, [{ id: "ai-credits", label: "AI credits", unit: "count" }]);
    const derivedOverage = normalizeGitHubCopilotUsagePayload({
        quota_snapshots: {
            premium_interactions: {
                entitlement: 300,
                quota_remaining: -20,
                unlimited: false,
            },
        },
    }, 675);
    assert.equal(derivedOverage.metrics[0]?.value, 20);
    assert.throws(() => normalizeGitHubCopilotUsagePayload({}, 0), /supported quota/iu);
    assert.throws(() => normalizeGitHubCopilotUsagePayload({ quota_snapshots: { premium_interactions: { entitlement: 300 } } }, 0), /incomplete/iu);
});

test("OpenRouter adapter normalizes documented per-key spend limits without claiming subscription quota", () => {
    const report = normalizeOpenRouterKeyPayload({
        data: {
            label: "Production key",
            limit: 100,
            limit_remaining: 74.5,
            limit_reset: "monthly",
            usage: 25.5,
            usage_daily: 1.25,
            usage_weekly: 8,
            usage_monthly: 25.5,
            is_free_tier: false,
        },
    }, 1000);
    assert.equal(report.providerId, "openrouter");
    assert.deepEqual(report.semantics, { kind: "api-key", label: "API-key spend limits" });
    assert.equal(report.accountLabel, "Production key");
    assert.deepEqual(report.buckets[0], {
        id: "key-limit",
        label: "Key limit",
        used: 25.5,
        remaining: 74.5,
        limit: 100,
        unit: "usd",
        period: "monthly",
    });
    assert.deepEqual(report.metrics.map((metric) => [metric.id, metric.value]), [
        ["usage-daily", 1.25],
        ["usage-weekly", 8],
        ["usage-monthly", 25.5],
        ["usage-total", 25.5],
    ]);
});

test("OpenRouter adapter keeps unlimited keys meaningful and sanitizes account labels", () => {
    const report = normalizeOpenRouterKeyPayload({
        data: {
            label: "main\u001b[31m\nkey",
            limit: null,
            limit_remaining: null,
            limit_reset: null,
            usage: 12.75,
            usage_daily: 0,
            usage_weekly: 2,
            usage_monthly: 4,
            is_free_tier: true,
        },
    }, 2000);
    assert.equal(report.accountLabel, "main key");
    assert.deepEqual(report.buckets, []);
});

test("OpenRouter adapter distinguishes unlimited keys from incomplete capped responses", () => {
    const unlimited = normalizeOpenRouterKeyPayload({
        data: {
            label: "unlimited",
            limit: null,
            limit_remaining: null,
            usage: 5,
        },
    }, 2500);
    assert.deepEqual(unlimited.buckets, []);
    assert.deepEqual(unlimited.notes, ["No per-key spend cap"]);
    const incomplete = normalizeOpenRouterKeyPayload({
        data: {
            label: "capped",
            limit: 100,
            limit_remaining: null,
            limit_reset: "monthly",
            usage: 5,
        },
    }, 2750);
    assert.equal(incomplete.buckets[0]?.limit, 100);
    assert.equal(incomplete.buckets[0]?.remaining, undefined);
});

test("OpenRouter adapter rejects malformed or empty documented responses", () => {
    assert.throws(() => normalizeOpenRouterKeyPayload({}, 0), /data/);
    assert.throws(() => normalizeOpenRouterKeyPayload({ data: { label: "empty" } }, 0), /no displayable usage data/);
});

test("Codex adapter preserves credit availability without a numeric balance", () => {
    const report = normalizeCodexBackendPayload({
        credits: { has_credits: true, unlimited: false },
    }, 2900);
    assert.deepEqual(report.metrics, [{ id: "credits", label: "Credits", value: "available" }]);
});

test("Codex adapter preserves explicit credit unavailability without rate-limit windows", () => {
    const report = normalizeCodexBackendPayload({ credits: { has_credits: false } }, 2950);
    assert.deepEqual(report.metrics, [{ id: "credits", label: "Credits", value: "none" }]);
});

test("Codex adapter preserves windows, credits, and model-specific limit buckets", () => {
    const report = normalizeCodexBackendPayload({
        plan_type: "pro",
        rate_limit: {
            primary_window: { used_percent: 30, limit_window_seconds: 18000, reset_at: 10000 },
            secondary_window: { used_percent: 80, limit_window_seconds: 604800, reset_at: 174700 },
        },
        credits: { has_credits: true, unlimited: false, balance: "12" },
        rate_limit_reset_credits: { available_count: 2 },
        additional_rate_limits: [
            {
                limit_name: "GPT-5.3 Codex Spark",
                metered_feature: "gpt-5.3-codex-spark",
                rate_limit: {
                    primary_window: { used_percent: 10, limit_window_seconds: 18000 },
                },
            },
        ],
    }, 3000);
    assert.equal(report.providerId, "openai-codex");
    assert.deepEqual(report.semantics, {
        kind: "consumer-subscription",
        label: "ChatGPT subscription limits",
    });
    assert.equal(report.buckets.length, 3);
    assert.equal(report.metrics.find((metric) => metric.id === "reset-credits")?.value, 2);
});
