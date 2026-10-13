// Adapted normalization tests from the pinned pi-provider-usage snapshot.
// TUI formatting assertions and Pi runtime tests are intentionally excluded.
import assert from "node:assert/strict";
import { test } from "vitest";
import { normalizeMiniMaxUsagePayload } from "../src/providers/minimax.js";
import type { MiniMaxUsagePayload } from "../src/providerTypes.js";

function quotaPayload() {
    const payload = {
        base_resp: { status_code: 0, status_msg: "success" },
        model_remains: [
            {
                model_name: "MiniMax-M*",
                start_time: 1800000000000,
                end_time: 1800018000000,
                current_interval_total_count: 1500,
                current_interval_usage_count: 228,
                current_interval_status: 1,
                current_weekly_total_count: 1000,
                current_weekly_usage_count: 200,
                current_weekly_remaining_percent: 80,
                current_weekly_status: 1,
                weekly_start_time: 1799971200000,
                weekly_end_time: 1800576000000,
                weekly_boost_permille: 1500,
            },
        ],
    };
    return { ...payload, model_remains: payload.model_remains as [typeof payload.model_remains[number]] };
}

function balancePayload() {
    return {
        base_resp: { status_code: 0, status_msg: "success" },
        available_amount: "98.00001",
        cash_balance: "-2.50",
        voucher_balance: "100.50001",
        credit_balance: "0",
        owed_amount: "2.50",
        balance_alert_switch: true,
        balance_alert_threshold: "10",
    };
}

test("MiniMax Token Plan normalizes legacy and current count semantics", () => {
    const report = normalizeMiniMaxUsagePayload("minimax", "token-plan", quotaPayload(), 1000);
    assert.equal(report.providerId, "minimax");
    assert.equal(report.source, "minimax-token-plan");
    assert.deepEqual(report.semantics, {
        kind: "consumer-subscription",
        label: "MiniMax Token Plan quota",
    });
    assert.deepEqual(report.buckets[0], {
        id: "minimax-m:interval",
        label: "Rolling window",
        groupId: "minimax-m",
        groupLabel: "MiniMax-M*",
        used: 1272,
        remaining: 228,
        limit: 1500,
        unit: "count",
        windowMinutes: 300,
        resetsAt: 1800018000,
    });
    assert.deepEqual(report.buckets[1], {
        id: "minimax-m:weekly",
        label: "Weekly window",
        groupId: "minimax-m",
        groupLabel: "MiniMax-M*",
        used: 200,
        remaining: 800,
        limit: 1000,
        unit: "count",
        windowMinutes: 10080,
        resetsAt: 1800576000,
    });
});

test("MiniMax Token Plan preserves unlimited windows and sanitizes model labels", () => {
    const payload = quotaPayload();
    payload.model_remains[0] = {
        ...payload.model_remains[0],
        model_name: "MiniMax\u001b[31m\nUnlimited",
        current_interval_status: 3,
        current_weekly_status: 3,
    };
    const report = normalizeMiniMaxUsagePayload("minimax-cn", "token-plan", payload, 2000);
    assert.equal(report.buckets[0]?.groupLabel, "MiniMax Unlimited");
    assert.equal(report.buckets[0]?.period, "unlimited");
});

test("MiniMax pay-as-you-go keeps exact regional balance strings and debt components", () => {
    for (const [providerId, currency] of [
        ["minimax", "USD"],
        ["minimax-cn", "CNY"],
    ] as const) {
        const report = normalizeMiniMaxUsagePayload(providerId, "account-balance", balancePayload(), 3000);
        assert.equal(report.source, "minimax-account-balance");
        assert.deepEqual(report.metrics.map((metric) => [metric.id, metric.value, metric.currency]), [
            ["available-balance", "98.00001", currency],
            ["cash-balance", "-2.50", currency],
            ["voucher-balance", "100.50001", currency],
            ["credit-balance", "0", currency],
            ["owed-amount", "2.50", currency],
        ]);
    }
});

test("MiniMax normalizers reject failed, malformed, or contradictory responses", () => {
    for (const [kind, payload] of [
        ["token-plan", {}],
        ["token-plan", { ...quotaPayload(), base_resp: { status_code: 1 } }],
        ["token-plan", { ...quotaPayload(), model_remains: [] }],
        ["token-plan", { ...quotaPayload(), model_remains: [null] }],
        [
            "token-plan",
            {
                ...quotaPayload(),
                model_remains: [{ ...quotaPayload().model_remains[0], current_interval_usage_count: 2000 }],
            },
        ],
        [
            "token-plan",
            {
                ...quotaPayload(),
                model_remains: [{ ...quotaPayload().model_remains[0], current_weekly_remaining_percent: 5 }],
            },
        ],
        ["account-balance", { ...balancePayload(), available_amount: "1e3" }],
        ["account-balance", { ...balancePayload(), voucher_balance: "-1" }],
        ["account-balance", { ...balancePayload(), cash_balance: 1 }],
    ] as const) {
        assert.throws(() => normalizeMiniMaxUsagePayload("minimax", kind, payload, 0), /did not report success|no quota rows|not an object|inconsistent|not a valid amount/iu);
    }
});

test("MiniMax Token Plan renders percent-based buckets when total is zero but percent is valid", () => {
    const base = quotaPayload().model_remains[0];
    const payload = {
        base_resp: { status_code: 0, status_msg: "success" },
        model_remains: [
            {
                ...base,
                model_name: "general",
                current_interval_total_count: 0,
                current_interval_usage_count: 0,
                current_interval_remaining_percent: 38,
                current_weekly_total_count: 0,
                current_weekly_usage_count: 0,
                current_weekly_remaining_percent: 32,
            },
            {
                ...base,
                model_name: "video",
                current_interval_total_count: 5,
                current_interval_usage_count: 0,
                current_interval_remaining_percent: 100,
                current_weekly_total_count: 35,
                current_weekly_usage_count: 2,
                current_weekly_remaining_percent: 94,
            },
        ],
    };
    const report = normalizeMiniMaxUsagePayload("minimax", "token-plan", payload, 1000);
    assert.equal(report.buckets.length, 4);
    const general = report.buckets.filter((b) => b.groupLabel === "general");
    const video = report.buckets.filter((b) => b.groupLabel === "video");
    assert.equal(general.length, 2);
    assert.equal(video.length, 2);
    const generalInterval = general.find((b) => b.label === "Rolling window");
    const generalWeekly = general.find((b) => b.label === "Weekly window");
    assert.equal(generalInterval?.unit, "percent");
    assert.equal(generalInterval?.remaining, 38);
    assert.equal(generalInterval?.used, 62);
    assert.equal(generalInterval?.limit, 0);
    assert.equal(generalWeekly?.unit, "percent");
    assert.equal(generalWeekly?.remaining, 32);
    assert.equal(generalWeekly?.used, 68);
    assert.equal(generalWeekly?.limit, 0);
});

test("MiniMax Token Plan percent-only buckets render with percent and resets, not 'unavailable'", () => {
    const base = quotaPayload().model_remains[0];
    const payload = {
        base_resp: { status_code: 0, status_msg: "success" },
        model_remains: [
            {
                ...base,
                model_name: "general",
                current_interval_total_count: 0,
                current_interval_usage_count: 0,
                current_interval_remaining_percent: 38,
                current_weekly_total_count: 0,
                current_weekly_usage_count: 0,
                current_weekly_remaining_percent: 32,
            },
        ],
    };
    const report = normalizeMiniMaxUsagePayload("minimax", "token-plan", payload, 1000);
    assert.deepEqual(report.buckets.map((bucket) => bucket.remaining), [38, 32]);
    assert.deepEqual(report.buckets.map((bucket) => bucket.unit), ["percent", "percent"]);
});

test("MiniMax Token Plan rejects rows with zero total and no usable percent", () => {
    const base = quotaPayload().model_remains[0];
    const payload = {
        base_resp: { status_code: 0, status_msg: "success" },
        model_remains: [
            {
                ...base,
                model_name: "general",
                current_interval_total_count: 0,
                current_interval_usage_count: 0,
                current_interval_remaining_percent: undefined,
                current_weekly_total_count: 0,
                current_weekly_usage_count: 0,
                current_weekly_remaining_percent: undefined,
            },
        ],
    };
    // We strip the undefined percent fields via JSON serialization; the API never
    // returns them as undefined, but the production code defends against it.
    const cleaned = JSON.parse(JSON.stringify(payload)) as MiniMaxUsagePayload;
    assert.throws(() => normalizeMiniMaxUsagePayload("minimax", "token-plan", cleaned, 0), /no quota and no percent/iu);
});

test("MiniMax Token Plan rejects zero totals with nonzero counts even when percent is valid", () => {
    const base = quotaPayload().model_remains[0];
    const payload = {
        base_resp: { status_code: 0, status_msg: "success" },
        model_remains: [
            {
                ...base,
                model_name: "general",
                current_interval_total_count: 0,
                current_interval_usage_count: 1,
                current_interval_remaining_percent: 38,
            },
        ],
    };
    assert.throws(() => normalizeMiniMaxUsagePayload("minimax", "token-plan", payload, 0), /counts were inconsistent/iu);
});

test("MiniMax Token Plan keeps mixed rows where one window is zero-total and the other has counts", () => {
    const base = quotaPayload().model_remains[0];
    const payload = {
        base_resp: { status_code: 0, status_msg: "success" },
        model_remains: [
            {
                ...base,
                model_name: "general",
                current_interval_total_count: 0,
                current_interval_usage_count: 0,
                current_interval_remaining_percent: 0,
                current_weekly_total_count: 1000,
                current_weekly_usage_count: 200,
                current_weekly_remaining_percent: 80,
            },
        ],
    };
    const report = normalizeMiniMaxUsagePayload("minimax", "token-plan", payload, 1000);
    assert.equal(report.buckets.length, 2);
    const interval = report.buckets.find((b) => b.label === "Rolling window");
    const weekly = report.buckets.find((b) => b.label === "Weekly window");
    assert.equal(interval?.unit, "percent");
    assert.equal(interval?.remaining, 0);
    assert.equal(interval?.used, 100);
    assert.equal(weekly?.unit, "count");
    assert.equal(weekly?.limit, 1000);
    assert.equal(weekly?.used, 200);
    assert.equal(weekly?.remaining, 800);
});

test("MiniMax Token Plan count buckets with remaining 0 still render", () => {
    const payload = quotaPayload();
    payload.model_remains[0] = {
        ...payload.model_remains[0],
        current_interval_usage_count: 0,
        current_weekly_usage_count: 0,
        current_weekly_remaining_percent: 0,
    };
    const report = normalizeMiniMaxUsagePayload("minimax", "token-plan", payload, 1000);
    assert.equal(report.buckets[0]?.remaining, 0);
    assert.equal(report.buckets[0]?.used, 1500);
});
