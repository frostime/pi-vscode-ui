// Adapted normalization tests from the pinned pi-provider-usage snapshot.
// TUI formatting assertions and Pi runtime tests are intentionally excluded.
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import type { KimiCodingUsagePayload } from "../src/providerTypes.js";
import { normalizeKimiCodingUsagePayload } from "../src/providers/kimi-coding.js";

const TERMINAL_ESCAPE = String.fromCharCode(27);

function fixture(name: string): KimiCodingUsagePayload {
    return JSON.parse(readFileSync(new URL(`./fixtures/kimi-coding-${name}.json`, import.meta.url), "utf8")) as KimiCodingUsagePayload;
}

function combinedPlanFixture(): KimiCodingUsagePayload {
    return {
        ...fixture("weekly"),
        limits: fixture("five-hour").limits,
    };
}

test("Kimi fixtures are sanitized and contain no credential or account fields", () => {
    for (const name of [
        "weekly",
        "five-hour",
        "daily",
        "monthly",
        "malformed",
        "booster-wallet",
        "remaining-only",
        "empty",
    ]) {
        const text = readFileSync(new URL(`./fixtures/kimi-coding-${name}.json`, import.meta.url), "utf8");
        assert.doesNotMatch(text, /authorization|access_token|refresh_token|api[_-]?key|email/iu);
    }
});

test("Kimi adapter normalizes weekly, five-hour, and daily numeric-string windows", () => {
    const report = normalizeKimiCodingUsagePayload(combinedPlanFixture(), 500);
    assert.equal(report.providerId, "kimi-coding");
    assert.equal(report.providerName, "Kimi For Coding");
    assert.equal(report.source, "kimi-managed-usage");
    assert.deepEqual(report.semantics, {
        kind: "consumer-subscription",
        label: "Kimi Coding Plan usage",
    });
    assert.deepEqual(report.buckets, [
        {
            id: "five-hour",
            label: "Five-hour limit",
            used: 1,
            remaining: 99,
            limit: 100,
            unit: "count",
            windowMinutes: 300,
            resetsAt: 1893474000,
        },
        {
            id: "weekly",
            label: "Weekly window",
            used: 40,
            remaining: 960,
            limit: 1000,
            unit: "count",
            windowMinutes: 10080,
            resetsAt: 1893974400,
        },
    ]);
    const daily = normalizeKimiCodingUsagePayload(fixture("daily"), 600);
    assert.deepEqual(daily.buckets[0], {
        id: "daily",
        label: "Daily cap",
        used: 5,
        remaining: 95,
        limit: 100,
        unit: "count",
        windowMinutes: 1440,
        resetsAt: 1893542400,
    });
});

test("Kimi adapter displays a ratio-only monthly plan alongside a count-based five-hour window", () => {
    const report = normalizeKimiCodingUsagePayload(fixture("monthly"), 650);
    assert.deepEqual(report.buckets, [
        {
            id: "five-hour",
            label: "5h window",
            used: 44,
            remaining: 56,
            limit: 100,
            unit: "count",
            windowMinutes: 300,
            resetsAt: Math.floor(Date.parse("2026-09-23T06:47:09.122865Z") / 1000),
        },
        {
            id: "monthly",
            label: "Monthly window",
            used: 78.77,
            remaining: 100 - 78.77,
            unit: "percent",
            resetsAt: Date.parse("2026-10-17T00:00:00Z") / 1000,
        },
    ]);
    assert.equal(report.notes, undefined);
});

test("Kimi ratio report percentages remain complementary at half-percent boundaries", () => {
    for (const [ratio] of [
        [0, 0, 100],
        [0.005, 0, 100],
        [0.125, 12, 88],
        [0.875, 87, 13],
        [0.995, 99, 1],
        [1, 100, 0],
    ]) {
        const report = normalizeKimiCodingUsagePayload({ usages: { limit_month_total: { used_ratio: ratio } } }, 0);
        assert.equal(report.buckets[0]?.used, ratio! * 100);
        assert.equal(report.buckets[0]?.remaining, 100 - ratio! * 100);
    }
});

test("Kimi ratio-only plans show five-hour, weekly, and monthly windows without guessed month duration", () => {
    const payload = fixture("monthly") as KimiCodingUsagePayload & {
        usages: Record<string, unknown>;
    };
    delete payload.limits;
    payload.usages.limit_week = { used_ratio: 0.25, reset_time: "2026-09-30T00:00:00Z" };
    const report = normalizeKimiCodingUsagePayload(payload, 675);
    assert.deepEqual(report.buckets.map(({ id, unit, windowMinutes }) => ({ id, unit, windowMinutes })), [
        { id: "five-hour", unit: "percent", windowMinutes: 300 },
        { id: "weekly", unit: "percent", windowMinutes: 10080 },
        { id: "monthly", unit: "percent", windowMinutes: undefined },
    ]);
});

test("Kimi ratio windows never override explicit windows or mask duplicates", () => {
    const payload = fixture("monthly") as KimiCodingUsagePayload & {
        usages: Record<string, unknown>;
    };
    payload.usage = { limit: "100", used: "10" };
    payload.usages.limit_week = { used_ratio: 0.25 };
    const report = normalizeKimiCodingUsagePayload(payload, 680);
    assert.deepEqual(report.buckets.map((bucket) => [bucket.id, bucket.unit]), [
        ["five-hour", "count"],
        ["weekly", "count"],
        ["monthly", "percent"],
    ]);
    const duplicate = fixture("malformed") as KimiCodingUsagePayload & {
        usages: Record<string, unknown>;
    };
    duplicate.usages = { limit_5h: { used_ratio: 0.25 }, limit_month_total: { used_ratio: 0 } };
    const withDuplicate = normalizeKimiCodingUsagePayload(duplicate, 685);
    assert.deepEqual(withDuplicate.buckets.map((bucket) => bucket.id), ["daily", "weekly", "monthly"]);
    assert.deepEqual(withDuplicate.notes, ["Unsupported, malformed, or duplicate plan windows were unavailable."]);
});

test("Kimi ratio windows reject invalid values and ignore unrecognized keys", () => {
    for (const invalid of [-0.1, 1.01, Number.NaN, Number.POSITIVE_INFINITY, "0.5", null]) {
        const payload: KimiCodingUsagePayload & {
            usages: unknown;
        } = {
            usages: { limit_month_total: { used_ratio: invalid } },
        };
        assert.throws(() => normalizeKimiCodingUsagePayload(payload, 0), /no displayable usage data/iu);
    }
    const payload: KimiCodingUsagePayload & {
        usages: unknown;
    } = {
        usages: {
            limit_month_total: { used_ratio: 1, reset_time: "2030-02-30T00:00:00Z" },
            limit_month_code: { used_ratio: 0.25 },
            future_window: { used_ratio: 0.5 },
        },
    };
    const report = normalizeKimiCodingUsagePayload(payload, 690);
    assert.deepEqual(report.buckets, [
        { id: "monthly", label: "Monthly window", used: 100, remaining: 0, unit: "percent" },
    ]);
    assert.equal(report.notes, undefined);
    assert.throws(() => normalizeKimiCodingUsagePayload({ usages: { limit_month_code: { used_ratio: 0.25 } } }, 0), /no displayable usage data/iu);
    const malformedMap = normalizeKimiCodingUsagePayload({ ...fixture("five-hour"), usages: [] }, 695);
    assert.deepEqual(malformedMap.buckets.map((bucket) => bucket.id), ["five-hour"]);
    assert.deepEqual(malformedMap.notes, ["Unsupported, malformed, or duplicate plan windows were unavailable."]);
    const invalidMonthly = normalizeKimiCodingUsagePayload({ ...fixture("five-hour"), usages: { limit_month_total: { used_ratio: 2 } } }, 696);
    assert.deepEqual(invalidMonthly.buckets.map((bucket) => bucket.id), ["five-hour"]);
    assert.deepEqual(invalidMonthly.notes, ["Unsupported, malformed, or duplicate plan windows were unavailable."]);
    const invalidCount = normalizeKimiCodingUsagePayload({
        limits: [{ window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" }, detail: { limit: "100", used: "bad" } }],
        usages: { limit_5h: { used_ratio: 0.25 }, limit_month_total: { used_ratio: 0.5 } },
    }, 697);
    assert.deepEqual(invalidCount.buckets.map((bucket) => bucket.id), ["monthly"]);
    assert.deepEqual(invalidCount.notes, ["Unsupported, malformed, or duplicate plan windows were unavailable."]);
});

test("Kimi adapter omits malformed, duplicate, unknown, and unsafe window fields", () => {
    const report = normalizeKimiCodingUsagePayload(fixture("malformed"), 700);
    assert.deepEqual(report.buckets, [
        {
            id: "daily",
            label: "Daily cap",
            used: 5,
            remaining: 95,
            limit: 100,
            unit: "count",
            windowMinutes: 1440,
        },
        {
            id: "weekly",
            label: "limit-only",
            used: 0,
            remaining: 100,
            limit: 100,
            unit: "count",
            windowMinutes: 10080,
        },
    ]);
    assert.deepEqual(report.notes, ["Unsupported, malformed, or duplicate plan windows were unavailable."]);
    const oversized = fixture("daily") as {
        limits?: Record<string, unknown>[];
    };
    const first = oversized.limits?.[0];
    if (first)
        first.name = `safe${"x".repeat(10000)}\u001b[31m`;
    const oversizedReport = normalizeKimiCodingUsagePayload(oversized, 800);
    assert.ok((oversizedReport.buckets[0]?.label.length ?? 0) <= 80);
    assert.equal((oversizedReport.buckets[0]?.label ?? "").includes(TERMINAL_ESCAPE), false);
    const impossibleTimestamp = fixture("daily") as {
        limits?: Record<string, unknown>[];
    };
    const detail = impossibleTimestamp.limits?.[0]?.detail as Record<string, unknown> | undefined;
    if (detail)
        detail.resetTime = "2030-02-30T00:00:00Z";
    assert.equal(normalizeKimiCodingUsagePayload(impossibleTimestamp, 850).buckets[0]?.resetsAt, undefined);
});

test("Kimi adapter derives missing counters from limit on remaining-only and untouched rows", () => {
    const report = normalizeKimiCodingUsagePayload(fixture("remaining-only"), 550);
    assert.deepEqual(report.buckets, [
        {
            id: "five-hour",
            label: "5h window",
            used: 2,
            remaining: 98,
            limit: 100,
            unit: "count",
            windowMinutes: 300,
            resetsAt: 1789231428,
        },
        {
            id: "weekly",
            label: "Weekly window",
            used: 0,
            remaining: 100,
            limit: 100,
            unit: "count",
            windowMinutes: 10080,
            resetsAt: 1789821828,
        },
    ]);
    assert.equal(report.notes, undefined);
    // The disabled booster wallet in the live response carries no balance amounts, so no metrics are invented.
    assert.deepEqual(report.metrics, []);
    // A row with a bare `limit` and no counters is untouched: zero used, everything remaining.
    const untouched = normalizeKimiCodingUsagePayload({ usage: { limit: "100", resetTime: "2026-09-19T12:43:48.701124Z" } }, 0);
    assert.deepEqual(untouched.buckets, [
        {
            id: "weekly",
            label: "Weekly window",
            used: 0,
            remaining: 100,
            limit: 100,
            unit: "count",
            windowMinutes: 10080,
            resetsAt: 1789821828,
        },
    ]);
});

test("Kimi adapter keeps booster-wallet currency separate from plan counts", () => {
    const report = normalizeKimiCodingUsagePayload(fixture("booster-wallet"), 900);
    assert.deepEqual(report.buckets, []);
    assert.deepEqual(report.metrics, [
        { id: "booster-balance", label: "Balance", value: 100, unit: "currency", currency: "USD" },
        {
            id: "booster-total",
            label: "Total balance",
            value: 200,
            unit: "currency",
            currency: "USD",
        },
        {
            id: "booster-monthly-used",
            label: "Used this month",
            value: 50,
            unit: "currency",
            currency: "USD",
        },
        {
            id: "booster-monthly-limit",
            label: "Monthly limit",
            value: 200,
            unit: "currency",
            currency: "USD",
        },
    ]);
});

test("Kimi booster wallet accepts the top-level snake-case alias without mixing plan and money", () => {
    const wallet = fixture("booster-wallet").boosterWallet;
    const payload = { ...fixture("monthly"), booster_wallet: wallet };
    const report = normalizeKimiCodingUsagePayload(payload, 920);
    assert.deepEqual(report.metrics, normalizeKimiCodingUsagePayload(fixture("booster-wallet"), 900).metrics);
    const both = { ...payload, boosterWallet: { balance: { type: "BOOSTER", amount: "1" } } };
    assert.deepEqual(normalizeKimiCodingUsagePayload(both, 921).metrics, []);
    assert.deepEqual(normalizeKimiCodingUsagePayload({ ...payload, boosterWallet: null }, 922).metrics, []);
});

test("Kimi booster wallet omits unverifiable currency and absent monthly fields", () => {
    const missingCurrency = {
        ...combinedPlanFixture(),
        ...fixture("booster-wallet"),
    } as KimiCodingUsagePayload & {
        boosterWallet?: {
            monthlyChargeLimit?: Record<string, unknown>;
            monthlyUsed?: Record<string, unknown>;
        };
    };
    assert.ok(missingCurrency.boosterWallet);
    delete missingCurrency.boosterWallet.monthlyChargeLimit;
    delete missingCurrency.boosterWallet.monthlyUsed;
    assert.deepEqual(normalizeKimiCodingUsagePayload(missingCurrency, 925).metrics, []);
    const conflicting = {
        ...combinedPlanFixture(),
        ...fixture("booster-wallet"),
    } as KimiCodingUsagePayload & {
        boosterWallet?: {
            monthlyUsed?: Record<string, unknown>;
        };
    };
    assert.ok(conflicting.boosterWallet?.monthlyUsed);
    conflicting.boosterWallet.monthlyUsed.currency = "CNY";
    assert.deepEqual(normalizeKimiCodingUsagePayload(conflicting, 930).metrics, []);
    const partial = fixture("booster-wallet") as KimiCodingUsagePayload & {
        boosterWallet?: {
            monthlyUsed?: Record<string, unknown>;
        };
    };
    assert.ok(partial.boosterWallet);
    delete partial.boosterWallet.monthlyUsed;
    const partialReport = normalizeKimiCodingUsagePayload(partial, 935);
    assert.deepEqual(partialReport.metrics.map((metric) => metric.id), ["booster-balance", "booster-total", "booster-monthly-limit"]);
});

test("Kimi booster wallet honors an enabled zero-dollar monthly cap", () => {
    const payload = fixture("booster-wallet") as KimiCodingUsagePayload & {
        boosterWallet?: {
            monthlyChargeLimit?: Record<string, unknown>;
        };
    };
    assert.ok(payload.boosterWallet?.monthlyChargeLimit);
    payload.boosterWallet.monthlyChargeLimit.priceInCents = "0";
    const report = normalizeKimiCodingUsagePayload(payload, 945);
    assert.equal(report.metrics.find((metric) => metric.id === "booster-monthly-limit")?.value, 0);
});

test("Kimi booster wallet preserves first-party minimum cents and unlimited monthly limits", () => {
    const payload = fixture("booster-wallet") as {
        boosterWallet?: {
            balance?: Record<string, unknown>;
            monthlyChargeLimitEnabled?: boolean;
            monthlyChargeLimit?: Record<string, unknown>;
            monthlyUsed?: Record<string, unknown>;
        };
    };
    const wallet = payload.boosterWallet;
    assert.ok(wallet?.balance);
    wallet.balance.amount = "1";
    delete wallet.balance.amountLeft;
    wallet.monthlyChargeLimitEnabled = false;
    delete wallet.monthlyChargeLimit;
    if (wallet.monthlyUsed)
        wallet.monthlyUsed.currency = "CNY";
    const report = normalizeKimiCodingUsagePayload(payload, 950);
    assert.equal(report.metrics.find((metric) => metric.id === "booster-balance")?.value, 0);
    assert.equal(report.metrics.find((metric) => metric.id === "booster-total")?.value, 0.01);
    assert.equal(report.metrics.find((metric) => metric.id === "booster-monthly-limit")?.value, "unlimited");
});

test("Kimi adapter rejects empty data, malformed counters, and future units", () => {
    assert.throws(() => normalizeKimiCodingUsagePayload(fixture("empty"), 0), /no displayable usage data/iu);
    assert.throws(() => normalizeKimiCodingUsagePayload({
        limits: [
            {
                window: { duration: 1, timeUnit: "TIME_UNIT_MONTH" },
                detail: { used: "1", limit: "10" },
            },
        ],
    }, 0), /no displayable usage data/iu);
    // A counter that is present but malformed still rejects the row instead of silently inventing a count.
    assert.throws(() => normalizeKimiCodingUsagePayload({ usage: { limit: "10", used: "1,000" } }, 0), /no displayable usage data/iu);
});
