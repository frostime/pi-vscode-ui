// Adapted normalization tests from the pinned pi-provider-usage snapshot.
// TUI formatting assertions and Pi runtime tests are intentionally excluded.
import assert from "node:assert/strict";
import { test } from "vitest";
import { normalizeFireworksAccountsPayload } from "../src/providers/fireworks.js";
import { normalizeFireworksBillingSummaryPayload } from "../src/providers/fireworks.js";

function money(units: string, nanos: number): Record<string, unknown> {
    return { currencyCode: "USD", units, nanos };
}

function lineItem(series: string, totalCost: unknown, currencyCode = "USD"): Record<string, unknown> {
    return { category: "Text Completion", series, totalCost, currencyCode };
}

test("Fireworks billing summary sums rated line items exactly per currency and series", () => {
    const report = normalizeFireworksBillingSummaryPayload({
        lineItems: [
            { category: "Serverless", series: "SERVERLESS", totalCost: money("12", 345678901) },
            {
                category: "Dedicated",
                series: "DEDICATED_DEPLOYMENT",
                totalCost: money("0", 750000000),
            },
            {
                category: "Training",
                series: "TRAINING",
                totalCost: { ...money("-1", -250000000), currencyCode: "USD" },
            },
            {
                category: "Audio",
                series: "SERVERLESS",
                totalCost: { currencyCode: "EUR", units: "0", nanos: 5 },
            },
        ],
    }, "acme", 1000);
    assert.equal(report.providerId, "fireworks");
    assert.equal(report.providerName, "Fireworks");
    assert.equal(report.accountLabel, "acme");
    assert.equal(report.source, "fireworks-billing-summary");
    assert.deepEqual(report.semantics, { kind: "api-key", label: "Fireworks API spend" });
    assert.deepEqual(report.buckets, []);
    assert.deepEqual(report.metrics.map((metric) => [metric.id, metric.value, metric.currency]), [
        ["usd-total", "11.845678901", "USD"],
        ["usd-serverless", "12.345678901", "USD"],
        ["usd-dedicated", "0.75", "USD"],
        ["usd-training", "-1.25", "USD"],
        ["eur-total", "0.000000005", "EUR"],
        ["eur-serverless", "0.000000005", "EUR"],
    ]);
});

test("Fireworks billing summary accepts empty rated line items without inventing quota semantics", () => {
    const report = normalizeFireworksBillingSummaryPayload({ lineItems: [] }, "acme", 2000);
    assert.equal(report.providerId, "fireworks");
    assert.deepEqual(report.metrics, []);
    assert.deepEqual(report.notes, [
        "Rated line items may differ from the final invoice once credits or adjustments are applied.",
        "Fireworks returned no rated line items for the last 30 days.",
    ]);
});

test("Fireworks billing summary rejects malformed, ambiguous, or hostile payloads", () => {
    const invalid: [
        Record<string, unknown>,
        RegExp
    ][] = [
        [{ lineItems: "nope" }, /lineItems was not an array/iu],
        [{ lineItems: [null] }, /line item was not an object/iu],
        [{ lineItems: [{ category: "x" }] }, /total cost.*money object/iu],
        [
            {
                lineItems: [{ category: "Serverless", totalCost: { currencyCode: "usd", units: "1", nanos: 0 } }],
            },
            /currency was not an ISO 4217/iu,
        ],
        [
            {
                lineItems: [{ category: "Serverless", series: 5, totalCost: money("1", 0) }],
            },
            /series was invalid/iu,
        ],
        [
            {
                lineItems: [
                    {
                        category: "Serverless",
                        series: "SERVERLESS",
                        totalCost: { ...money("1", 0), currencyCode: "EU" },
                    },
                ],
            },
            /ISO 4217/iu,
        ],
        [
            {
                lineItems: [
                    {
                        ...lineItem("SERVERLESS", money("1", 0)),
                        totalCost: { ...money("1", 0), units: "1e3" },
                    },
                ],
            },
            /whole units was not a bounded integer/iu,
        ],
        [
            {
                lineItems: [
                    {
                        series: "SERVERLESS",
                        totalCost: { ...money("0", 0), units: "9223372036854775808" },
                    },
                ],
            },
            /whole units exceeded the int64 range/iu,
        ],
        [
            {
                lineItems: [
                    {
                        series: "SERVERLESS",
                        totalCost: { ...money("0", 0), units: "-9223372036854775809" },
                    },
                ],
            },
            /whole units exceeded the int64 range/iu,
        ],
        [
            { lineItems: [{ series: "SERVERLESS", totalCost: { ...money("1", 0), nanos: 1.5 } }] },
            /nano units was not a bounded integer/iu,
        ],
        [
            {
                lineItems: [{ series: "SERVERLESS", totalCost: { ...money("0", 0), nanos: 1000000000 } }],
            },
            /nano units exceeded the Money range/iu,
        ],
        [
            {
                lineItems: [{ series: "SERVERLESS", totalCost: { ...money("0", 0), nanos: -1000000000 } }],
            },
            /nano units exceeded the Money range/iu,
        ],
        [
            {
                lineItems: [
                    {
                        series: "SERVERLESS",
                        totalCost: { currencyCode: "USD", units: "-1", nanos: 750000000 },
                    },
                ],
            },
            /mixed unit and nano signs/iu,
        ],
        [
            {
                lineItems: [{ series: "SERVERLESS", totalCost: { ...money("1", 0), currencyCode: "EURO" } }],
            },
            /currency was not an ISO 4217/iu,
        ],
    ];
    for (const [payload, pattern] of invalid) {
        assert.throws(() => normalizeFireworksBillingSummaryPayload(payload, "acme", 0), pattern);
    }
});

test("Fireworks account discovery normalizes and validates the documented listing", () => {
    assert.deepEqual(normalizeFireworksAccountsPayload({
        accounts: [{ name: "accounts/acme" }, { name: "accounts/b.io" }],
    }), ["acme", "b.io"]);
    const invalid: [
        Record<string, unknown>,
        RegExp
    ][] = [
        [{}, /did not contain an accounts array/iu],
        [{ accounts: "acme" }, /did not contain an accounts array/iu],
        [{ accounts: [null] }, /row was not an object/iu],
        [{ accounts: [{ displayName: "Acme" }] }, /omitted the account resource name/iu],
        [{ accounts: [{ name: "accounts/../secrets" }] }, /unsafe account resource name/iu],
        [{ accounts: [{ name: "accounts/acme/deployments/x" }] }, /unsafe account resource name/iu],
        [{ accounts: [{ name: "accounts/acme" }, { name: "accounts/acme" }] }, /repeated acme/iu],
    ];
    for (const [payload, pattern] of invalid) {
        assert.throws(() => normalizeFireworksAccountsPayload(payload), pattern);
    }
});
