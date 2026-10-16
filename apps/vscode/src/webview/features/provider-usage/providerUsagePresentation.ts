import type { UsageBucket, UsageMetric } from "@frostime/provider-usage";

/** A bar is possible only when the provider reports usage and a meaningful scale. */
export function bucketProgress(bucket: UsageBucket): number | undefined {
  if (bucket.used === undefined || !Number.isFinite(bucket.used)) return undefined;
  const percent = bucket.unit === "percent" ? bucket.used
    : bucket.limit !== undefined && bucket.limit > 0 ? bucket.used / bucket.limit * 100 : undefined;
  return percent === undefined ? undefined : Math.max(0, Math.min(100, percent));
}

export function formatUsageValue(value: number | string, unit?: UsageMetric["unit"], currency?: string): string {
  const amount = typeof value === "number"
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value)
    : value;
  if (currency) return `${currency} ${amount}`;
  if (unit === "usd") return `USD ${typeof value === "number" ? value.toFixed(2) : value}`;
  if (unit === "percent") return `${amount}%`;
  return amount;
}
