// Adapted normalization tests from the pinned pi-provider-usage snapshot.
// TUI formatting assertions and Pi runtime tests are intentionally excluded.
import assert from "node:assert/strict";
import { test } from "vitest";
import { normalizeMoonshotBalancePayload } from "../src/providers/moonshot.js";

function successPayload() {
    return {
        code: 0,
        data: {
            available_balance: 49.58894,
            voucher_balance: 46.58893,
            cash_balance: 3.00001,
        },
        scode: "0x0",
        status: true,
    };
}

test("Moonshot balances retain region currency and separate account components", () => {
    for (const [providerId, currency] of [
        ["moonshotai", "USD", "Moonshot AI Balance"],
        ["moonshotai-cn", "CNY", "Moonshot AI CN Balance"],
    ] as const) {
        const report = normalizeMoonshotBalancePayload(providerId, successPayload(), 1000);
        assert.equal(report.providerId, providerId);
        assert.equal(report.source, "moonshot-balance");
        assert.deepEqual(report.semantics, {
            kind: "api-key",
            label: "Moonshot API account balance",
        });
        assert.deepEqual(report.metrics.map((metric) => [metric.id, metric.value, metric.currency]), [
            ["available-balance", "49.58894", currency],
            ["voucher-balance", "46.58893", currency],
            ["cash-balance", "3.00001", currency],
        ]);
    }
});

test("Moonshot balance preserves a negative cash component without making available credit negative", () => {
    const report = normalizeMoonshotBalancePayload("moonshotai", {
        code: 0,
        data: { available_balance: 10, voucher_balance: 10, cash_balance: -2.5 },
        status: true,
    }, 2000);
    assert.equal(report.metrics.find((metric) => metric.id === "cash-balance")?.value, "-2.5");
});

test("Moonshot balance rejects failed, incomplete, or hostile responses", () => {
    for (const payload of [
        {},
        { ...successPayload(), code: 1 },
        { ...successPayload(), status: false },
        { code: 0, status: true, data: null },
        { code: 0, status: true, data: { ...successPayload().data, available_balance: -1 } },
        { code: 0, status: true, data: { ...successPayload().data, voucher_balance: Number.NaN } },
        { code: 0, status: true, data: { ...successPayload().data, cash_balance: "3" } },
        {
            code: 0,
            status: true,
            data: { ...successPayload().data, cash_balance: Number.MAX_SAFE_INTEGER + 1 },
        },
    ]) {
        assert.throws(() => normalizeMoonshotBalancePayload("moonshotai", payload, 0), /not report success|not an object|not a valid amount/iu);
    }
});
