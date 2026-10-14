// Adapted normalization tests from the pinned pi-provider-usage snapshot.
// TUI formatting assertions and Pi runtime tests are intentionally excluded.
import assert from "node:assert/strict";
import { test } from "vitest";
import { normalizeBasetenBillingUsagePayload } from "../src/providers/baseten.js";

function billingPayload() {
    return {
        dedicated_usage: {
            total: "1000.00",
            credits_used: "100.00",
            subtotal: "900.00",
        },
        model_apis_usage: {
            total: "171.150000000000000001",
            credits_used: 5,
            subtotal: "166.150000000000000001",
        },
        training_usage: {
            total: "500.00",
            credits_used: "0",
            subtotal: "500.00",
        },
    };
}

test("Baseten billing reports only Model APIs gross, credits, and net spend", () => {
    const report = normalizeBasetenBillingUsagePayload(billingPayload(), 1000);
    assert.equal(report.providerId, "baseten");
    assert.equal(report.source, "baseten-billing-usage-summary");
    assert.deepEqual(report.semantics, {
        kind: "api-key",
        label: "Organization Model APIs spend",
    });
    assert.deepEqual(report.metrics.map((metric) => [metric.id, metric.value, metric.currency]), [
        ["gross-usage", "171.150000000000000001", "USD"],
        ["credits-used", "5", "USD"],
        ["net-subtotal", "166.150000000000000001", "USD"],
    ]);
});

test("Baseten billing treats absent Model APIs usage as an empty provider report", () => {
    for (const payload of [{}, { dedicated_usage: {}, training_usage: {} }, { model_apis_usage: null }]) {
        const report = normalizeBasetenBillingUsagePayload(payload, 2000);
        assert.deepEqual(report.metrics, []);
        assert.deepEqual(report.notes, ["Baseten returned no Model APIs usage for the last 30 days."]);
    }
});

test("Baseten billing rejects malformed, negative, or ambiguous Model APIs money", () => {
    for (const payload of [
        { model_apis_usage: [] },
        { model_apis_usage: { total: "1", credits_used: "0", subtotal: "-1" } },
        { model_apis_usage: { total: "1e3", credits_used: "0", subtotal: "1" } },
        { model_apis_usage: { total: Number.NaN, credits_used: "0", subtotal: "1" } },
        { model_apis_usage: { total: "1", credits_used: {}, subtotal: "1" } },
        { model_apis_usage: { total: "9".repeat(65), credits_used: "0", subtotal: "1" } },
    ]) {
        assert.throws(() => normalizeBasetenBillingUsagePayload(payload, 0), /not an object|not a valid nonnegative amount/iu);
    }
});
