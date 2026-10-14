// Adapted normalization tests from the pinned pi-provider-usage snapshot.
// TUI formatting assertions and Pi runtime tests are intentionally excluded.
import assert from "node:assert/strict";
import { test } from "vitest";
import { normalizeVercelAIGatewayCreditsPayload } from "../src/providers/vercel-ai-gateway.js";

test("Vercel AI Gateway credits preserve decimal strings and native semantics", () => {
    const report = normalizeVercelAIGatewayCreditsPayload({ balance: "95.500000000000000001", total_used: "4.499999999999999999" }, 1000);
    assert.equal(report.providerId, "vercel-ai-gateway");
    assert.equal(report.source, "vercel-ai-gateway-credits");
    assert.deepEqual(report.semantics, {
        kind: "api-key",
        label: "AI Gateway credits and lifetime spend",
    });
    assert.deepEqual(report.metrics.map((metric) => [metric.id, metric.value, metric.currency]), [
        ["credit-balance", "95.500000000000000001", "USD"],
        ["lifetime-spend", "4.499999999999999999", "USD"],
    ]);
});

test("Vercel AI Gateway credits reject malformed or ambiguous monetary fields", () => {
    for (const payload of [
        {},
        { balance: 95.5, total_used: "4.5" },
        { balance: "-1", total_used: "4.5" },
        { balance: "1e3", total_used: "4.5" },
        { balance: "1", total_used: "NaN" },
        { balance: "9".repeat(65), total_used: "0" },
    ]) {
        assert.throws(() => normalizeVercelAIGatewayCreditsPayload(payload, 0), /not a valid nonnegative amount/iu);
    }
});
