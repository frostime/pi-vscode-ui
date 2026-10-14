// Adapted normalization tests from the pinned pi-provider-usage snapshot.
// TUI formatting assertions and Pi runtime tests are intentionally excluded.
import assert from "node:assert/strict";
import { test } from "vitest";
import { normalizeZaiQuotaPayload } from "../src/providers/zai.js";

const ZAI_QUOTA_PAYLOAD = {
    code: 200,
    msg: "Success",
    success: true,
    data: {
        limits: [
            {
                type: "TIME_LIMIT",
                unit: 5,
                number: 1,
                usage: 4000,
                currentValue: 224,
                remaining: 3776,
                percentage: 5,
                nextResetTime: 1772615765983,
                usageDetails: [{ modelCode: "search-prime", usage: 67 }],
            },
            {
                type: "TOKENS_LIMIT",
                unit: 3,
                number: 5,
                percentage: 13,
                nextResetTime: 1771073738808,
            },
            {
                type: "TOKENS_LIMIT",
                unit: 6,
                usage: 500000,
                currentValue: 120000,
                percentage: 24,
                nextResetTime: 1744137600000,
            },
        ],
        level: "lite",
    },
};

test("Z.AI adapter normalizes 5h, weekly, and MCP monthly windows", () => {
    const report = normalizeZaiQuotaPayload("zai", "Z.AI", ZAI_QUOTA_PAYLOAD, 500);
    assert.equal(report.providerId, "zai");
    assert.equal(report.providerName, "Z.AI");
    assert.equal(report.source, "zai-quota");
    assert.deepEqual(report.semantics, {
        kind: "consumer-subscription",
        label: "GLM Coding Plan usage",
    });
    assert.equal(report.buckets.length, 3);
    const fiveHour = report.buckets.find((bucket) => bucket.id === "five-hour");
    assert.deepEqual(fiveHour, {
        id: "five-hour",
        label: "5h window",
        used: 13,
        remaining: 87,
        limit: 100,
        unit: "percent",
        windowMinutes: 300,
        resetsAt: 1771073738,
    });
    const weekly = report.buckets.find((bucket) => bucket.id === "weekly");
    assert.deepEqual(weekly, {
        id: "weekly",
        label: "Weekly window",
        used: 120000,
        remaining: 380000,
        limit: 500000,
        unit: "count",
        windowMinutes: 10080,
        resetsAt: 1744137600,
    });
    const mcpMonthly = report.buckets.find((bucket) => bucket.id === "mcp-monthly");
    assert.deepEqual(mcpMonthly, {
        id: "mcp-monthly",
        label: "MCP monthly allowance",
        used: 224,
        remaining: 3776,
        limit: 4000,
        unit: "count",
        resetsAt: 1772615765,
    });
    assert.deepEqual(report.metrics, [{ id: "mcp-search-prime", label: "search-prime", value: 67, unit: "count" }]);
    assert.deepEqual(report.notes, ["Plan: lite"]);
});

test("Z.AI adapter keeps percentage-only 5h windows displayable without weekly data", () => {
    const report = normalizeZaiQuotaPayload("zai-coding-cn", "Z.AI Coding CN", {
        data: {
            limits: [
                { type: "TOKENS_LIMIT", unit: 3, percentage: 40, nextResetTime: 1744137600499 },
                { type: "TOKENS_LIMIT", unit: 6 },
                { type: "TIME_LIMIT", currentValue: 10 },
            ],
        },
    }, 600);
    assert.equal(report.providerId, "zai-coding-cn");
    assert.equal(report.providerName, "Z.AI Coding CN");
    assert.equal(report.buckets.length, 1);
    assert.deepEqual(report.buckets[0], {
        id: "five-hour",
        label: "5h window",
        used: 40,
        remaining: 60,
        limit: 100,
        unit: "percent",
        windowMinutes: 300,
        resetsAt: 1744137600,
    });
    assert.equal(report.notes, undefined);
    assert.equal(report.metrics.length, 0);
});

test("Z.AI adapter shows percentage-only weekly windows as percent buckets", () => {
    const report = normalizeZaiQuotaPayload("zai", "Z.AI", {
        data: {
            limits: [
                { type: "TIME_LIMIT", unit: 5, usage: 100, currentValue: 0, percentage: 0 },
                { type: "TOKENS_LIMIT", unit: 3, usage: null, currentValue: null, percentage: 22 },
                { type: "TOKENS_LIMIT", unit: 6, usage: null, currentValue: null, percentage: 10 },
            ],
        },
    }, 700);
    assert.deepEqual(report.buckets.map((bucket) => [bucket.id, bucket.unit, bucket.remaining]), [
        ["mcp-monthly", "count", 100],
        ["five-hour", "percent", 78],
        ["weekly", "percent", 90],
    ]);
    const weekly = report.buckets.find((bucket) => bucket.id === "weekly");
    assert.equal(weekly?.windowMinutes, 10080);
});

test("Z.AI adapter accepts current credit-limit and mixed rollout window names", () => {
    for (const types of [
        ["CREDIT_LIMIT", "CREDIT_LIMIT"],
        ["TOKENS_LIMIT", "CREDIT_LIMIT"],
    ] as const) {
        const report = normalizeZaiQuotaPayload("zai", "Z.AI", {
            data: {
                limits: [
                    { type: types[0], unit: 3, percentage: 42 },
                    { type: types[1], unit: 6, percentage: 15 },
                ],
            },
        }, 800);
        assert.deepEqual(report.buckets.map((bucket) => [bucket.id, bucket.used, bucket.remaining]), [
            ["five-hour", 42, 58],
            ["weekly", 15, 85],
        ]);
    }
});

test("Z.AI adapter derives window length and label from the payload window number", () => {
    const report = normalizeZaiQuotaPayload("zai", "Z.AI", {
        data: {
            limits: [
                {
                    type: "CREDIT_LIMIT",
                    unit: 3,
                    number: 1,
                    percentage: 10,
                    nextResetTime: 1744137600000,
                },
                { type: "CREDIT_LIMIT", unit: 3, percentage: 20 },
                { type: "CREDIT_LIMIT", unit: 6, number: 2, usage: 100, currentValue: 40 },
            ],
        },
    }, 900);
    assert.deepEqual(report.buckets.map((bucket) => [bucket.label, bucket.windowMinutes]), [
        ["1h window", 60],
        ["5h window", 300],
        ["Weekly window", 20160],
    ]);
});

test("Z.AI adapter rejects malformed or empty quota responses", () => {
    assert.throws(() => normalizeZaiQuotaPayload("zai", "Z.AI", {}, 0), /not an object/);
    assert.throws(() => normalizeZaiQuotaPayload("zai", "Z.AI", { data: { limits: [] } }, 0), /no displayable usage data/);
    assert.throws(() => normalizeZaiQuotaPayload("zai", "Z.AI", { data: { limits: "broken" } }, 0), /no displayable usage data/);
});

test("Z.AI quota classification depends on error codes, not message text or quota data", () => {
    for (const data of [undefined, null, [], false, 0, {}, ZAI_QUOTA_PAYLOAD.data]) {
        for (const msg of [undefined, "No subscription", "Server error", "任意訊息"]) {
            const payload = { code: 500, success: false, msg, data };
            assert.throws(() => normalizeZaiQuotaPayload("zai", "Z.AI", payload, 0), {
                message: "Z.AI 500: API request failed.",
            });
        }
    }
});
