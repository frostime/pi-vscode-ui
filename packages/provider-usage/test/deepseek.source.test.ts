// Adapted normalization tests from the pinned pi-provider-usage snapshot.
// TUI formatting assertions and Pi runtime tests are intentionally excluded.
import assert from "node:assert/strict";
import { test } from "vitest";
import type { DeepSeekBalancePayload } from "../src/providerTypes.js";
import { normalizeDeepSeekBalancePayload } from "../src/providers/deepseek.js";

function balance(currency: "CNY" | "USD", total: string, granted: string, toppedUp: string): Record<string, unknown> {
    return {
        currency,
        total_balance: total,
        granted_balance: granted,
        topped_up_balance: toppedUp,
    };
}

test("DeepSeek API balance preserves exact separate currency amounts and deterministic display", () => {
    const report = normalizeDeepSeekBalancePayload({
        is_available: true,
        balance_infos: [
            balance("USD", "0.12345678901234567890", "0", "0.12345678901234567890"),
            balance("CNY", "110.00", "10.00", "100.00"),
        ],
    }, 1000);
    assert.equal(report.providerId, "deepseek");
    assert.equal(report.source, "deepseek-balance");
    assert.deepEqual(report.semantics, { kind: "api-key", label: "DeepSeek API balance" });
    assert.deepEqual(report.metrics.map((metric) => [metric.id, metric.value, metric.currency]), [
        ["api-availability", "available", undefined],
        ["cny-total", "110.00", "CNY"],
        ["cny-granted", "10.00", "CNY"],
        ["cny-topped-up", "100.00", "CNY"],
        ["usd-total", "0.12345678901234567890", "USD"],
        ["usd-granted", "0", "USD"],
        ["usd-topped-up", "0.12345678901234567890", "USD"],
    ]);
});

test("DeepSeek API balance preserves negative totals reported after a slight overdraft", () => {
    const report = normalizeDeepSeekBalancePayload({
        is_available: true,
        balance_infos: [balance("CNY", "27.02", "0.00", "27.02"), balance("USD", "-0.01", "0.00", "-0.01")],
    }, 1500);
    assert.deepEqual(report.metrics.map((metric) => [metric.id, metric.value, metric.currency]), [
        ["api-availability", "available", undefined],
        ["cny-total", "27.02", "CNY"],
        ["cny-granted", "0.00", "CNY"],
        ["cny-topped-up", "27.02", "CNY"],
        ["usd-total", "-0.01", "USD"],
        ["usd-granted", "0.00", "USD"],
        ["usd-topped-up", "-0.01", "USD"],
    ]);
});

test("DeepSeek API balance reports provider availability without inventing quota semantics", () => {
    const report = normalizeDeepSeekBalancePayload({
        is_available: false,
        balance_infos: [balance("USD", "0.00", "0.00", "0.00")],
    }, 2000);
    assert.equal(report.metrics.find((item) => item.id === "api-availability")?.value, "unavailable");
    assert.deepEqual(report.buckets, []);
});

test("DeepSeek API balance rejects malformed, ambiguous, or hostile response fields", () => {
    const invalid: [
        DeepSeekBalancePayload,
        RegExp
    ][] = [
        [{}, /availability/iu],
        [{ is_available: "yes", balance_infos: [] }, /availability/iu],
        [{ is_available: true }, /no balance information/iu],
        [{ is_available: true, balance_infos: [] }, /no balance information/iu],
        [{ is_available: true, balance_infos: [null] }, /row was not an object/iu],
        [
            {
                is_available: true,
                balance_infos: [
                    {
                        ...balance("CNY", "1.00", "0.00", "1.00"),
                        currency: "EUR",
                    },
                ],
            },
            /unsupported currency/iu,
        ],
        [
            {
                is_available: true,
                balance_infos: [balance("CNY", "1.00", "0.00", "1.00"), balance("CNY", "2", "1", "1")],
            },
            /repeated CNY/iu,
        ],
        [
            {
                is_available: true,
                balance_infos: [{ ...balance("USD", "1", "0", "1"), total_balance: "1-" }],
            },
            /total balance/iu,
        ],
        [
            {
                is_available: true,
                balance_infos: [{ ...balance("USD", "1", "0", "1"), total_balance: "--1" }],
            },
            /total balance/iu,
        ],
        [
            {
                is_available: true,
                balance_infos: [{ ...balance("USD", "1", "0", "1"), granted_balance: "1e3" }],
            },
            /granted balance/iu,
        ],
        [
            {
                is_available: true,
                balance_infos: [{ ...balance("USD", "1", "0", "1"), topped_up_balance: `1\u001b[31m` }],
            },
            /topped-up balance/iu,
        ],
        [
            {
                is_available: true,
                balance_infos: [balance("USD", "9".repeat(65), "0", "0")],
            },
            /total balance/iu,
        ],
    ];
    for (const [payload, pattern] of invalid) {
        assert.throws(() => normalizeDeepSeekBalancePayload(payload, 0), pattern);
    }
});
