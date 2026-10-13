// Adapted normalization tests from the pinned pi-provider-usage snapshot.
// TUI formatting assertions and Pi runtime tests are intentionally excluded.
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { normalizeXaiBillingPayload } from "../src/providers/xai.js";
import { type XaiBillingPayload } from "../src/providerTypes.js";
import { type XaiUserPayload } from "../src/providerTypes.js";

async function fixture<T>(name: string): Promise<T> {
    const path = fileURLToPath(new URL(`./fixtures/xai/${name}`, import.meta.url));
    return JSON.parse(await readFile(path, "utf8")) as T;
}

test("normalizes current credits while keeping allowance, on-demand, and prepaid values distinct", async () => {
    const billing = await fixture<XaiBillingPayload>("billing-current.json");
    const report = normalizeXaiBillingPayload(billing, "SuperGrok", 123);
    assert.equal(report.semantics.kind, "consumer-subscription");
    assert.deepEqual(report.buckets, [
        {
            id: "included-allowance",
            label: "Included allowance",
            used: 42.5,
            remaining: 57.5,
            unit: "percent",
            period: "Weekly",
            resetsAt: Date.parse("2026-06-08T00:00:00Z") / 1000,
        },
        {
            id: "on-demand",
            label: "On-demand usage",
            limit: 50,
            used: 3,
            remaining: 47,
            unit: "usd",
        },
    ]);
    assert.deepEqual(report.metrics, [
        { id: "prepaid-balance", label: "Prepaid balance", value: 12.5, unit: "usd" },
        { id: "subscription-tier", label: "Plan tier", value: "SuperGrok" },
    ]);
});

test("normalizes legacy limits, signed cents, zero wrappers, and empty configs", async () => {
    const legacy = normalizeXaiBillingPayload(await fixture<XaiBillingPayload>("billing-legacy.json"), null, 123);
    assert.deepEqual(legacy.buckets[0], {
        id: "included-allowance",
        label: "Included allowance",
        limit: 20,
        used: 12.34,
        remaining: 7.66,
        unit: "usd",
        period: "Monthly",
        resetsAt: Date.parse("2025-05-01T00:00:00Z") / 1000,
    });
    assert.deepEqual(legacy.buckets[1], {
        id: "on-demand",
        label: "On-demand usage",
        limit: 0,
        used: -0.5,
        remaining: 0.5,
        unit: "usd",
    });
    assert.deepEqual(legacy.metrics, [{ id: "prepaid-balance", label: "Prepaid balance", value: 0, unit: "usd" }]);
    const limitOnly = normalizeXaiBillingPayload({ config: { monthlyLimit: { val: 2000 } } }, undefined, 123);
    assert.deepEqual(limitOnly.buckets, [
        {
            id: "included-allowance",
            label: "Included allowance",
            limit: 20,
            unit: "usd",
        },
    ]);
    const periodOnly = normalizeXaiBillingPayload({
        config: {
            currentPeriod: {
                type: "USAGE_PERIOD_TYPE_MONTHLY",
                end: "2026-07-01T00:00:00Z",
            },
        },
    }, undefined, 123);
    assert.deepEqual(periodOnly.buckets, [
        {
            id: "included-allowance",
            label: "Included allowance",
            unit: "percent",
            period: "Monthly",
            resetsAt: Date.parse("2026-07-01T00:00:00Z") / 1000,
        },
    ]);
    for (const name of ["billing-null.json", "billing-absent.json"]) {
        const report = normalizeXaiBillingPayload(await fixture(name), undefined, 123);
        assert.deepEqual(report.buckets, []);
        assert.deepEqual(report.metrics, []);
        assert.match(report.notes?.[0] ?? "", /No xAI consumer billing configuration/);
    }
});

test("rejects malformed or unbounded billing values and sanitizes hostile tiers", async () => {
    for (const payload of [
        { config: [] },
        { config: { creditUsagePercent: 101 } },
        { config: { monthlyLimit: { val: Number.MAX_SAFE_INTEGER + 1 } } },
        { config: { currentPeriod: { end: "not-a-date" } } },
    ]) {
        assert.throws(() => normalizeXaiBillingPayload(payload, undefined, 123), /xAI billing/);
    }
    const hostile = await fixture<XaiUserPayload>("user-hostile-tier.json");
    const report = normalizeXaiBillingPayload({ config: null }, hostile.subscriptionTier, 123);
    const tier = report.metrics.find((metric) => metric.id === "subscription-tier")?.value;
    assert.equal(tier, "SuperGrokhostile Tier");
    assert.equal([...String(tier)].some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    }), false);
});
