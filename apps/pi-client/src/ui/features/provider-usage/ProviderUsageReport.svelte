<script lang="ts">
  import type { UsageBucket, UsageMetric, UsageReport } from "@frostime/provider-usage";
  import { bucketProgress, formatUsageValue } from "./providerUsagePresentation";

  let { report, showProviderName = true }: { report: UsageReport; showProviderName?: boolean } = $props();
  const groups = $derived(groupBuckets(report.buckets));
  const metricGroups = $derived(groupMetrics(report.metrics));
  const multipleCurrencies = $derived(metricGroups.filter((group) => group.currency).length > 1);

  function groupBuckets(buckets: readonly UsageBucket[]): { id: string; label: string; buckets: UsageBucket[] }[] {
    const groups = new Map<string, { id: string; label: string; buckets: UsageBucket[] }>();
    for (const bucket of buckets) {
      const key = bucket.groupId ?? bucket.groupLabel ?? "";
      let group = groups.get(key);
      if (!group) { group = { id: key, label: bucket.groupLabel ?? "", buckets: [] }; groups.set(key, group); }
      group.buckets.push(bucket);
    }
    return [...groups.values()];
  }

  function groupMetrics(metrics: readonly UsageMetric[]): { currency: string; metrics: UsageMetric[] }[] {
    const groups = new Map<string, { currency: string; metrics: UsageMetric[] }>();
    for (const metric of metrics) {
      const currency = metric.currency ?? (metric.unit === "usd" ? "USD" : "");
      let group = groups.get(currency);
      if (!group) { group = { currency, metrics: [] }; groups.set(currency, group); }
      group.metrics.push(metric);
    }
    return [...groups.values()];
  }

  function windowLabel(bucket: UsageBucket): string {
    if (bucket.period) return bucket.period;
    if (bucket.windowMinutes === undefined) return bucket.label;
    const minutes = bucket.windowMinutes;
    if (minutes % 1_440 === 0) return `${minutes / 1_440}-day window`;
    if (minutes % 60 === 0) return `${minutes / 60}-hour window`;
    return `${minutes}-minute window`;
  }

  function resetLabel(seconds: number): string {
    return new Date(seconds * 1_000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
</script>

<article class="usage-report">
  <header class="report-heading">
    {#if showProviderName}<h3>{report.providerName}</h3>{/if}
    <p class="semantics">{report.semantics.label}</p>
    <div class="report-context">
      {#if report.accountLabel}<span>{report.accountLabel}</span>{/if}
      <time datetime={new Date(report.capturedAt).toISOString()} title={`Snapshot: ${new Date(report.capturedAt).toLocaleString()}`}>Updated {new Date(report.capturedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</time>
    </div>
  </header>

  {#each groups as group (group.id)}
    <section class="bucket-group" aria-label={group.label || "Usage limits"}>
      {#if group.label}<h4>{group.label}</h4>{/if}
      {#each group.buckets as bucket (bucket.id)}
        {@const progress = bucketProgress(bucket)}
        <div class="bucket">
          <div class="bucket-heading">
            <span title={bucket.label}>{windowLabel(bucket)}</span>
            {#if bucket.used !== undefined}<strong>{formatUsageValue(bucket.used, bucket.unit)} used</strong>{/if}
          </div>
          {#if progress !== undefined}<div class="usage-bar" aria-hidden="true"><span style:width={`${progress}%`}></span></div>{/if}
          <div class="bucket-footer">
            {#if bucket.resetsAt !== undefined}
              <time datetime={new Date(bucket.resetsAt * 1_000).toISOString()} title={new Date(bucket.resetsAt * 1_000).toLocaleString()}>Resets {resetLabel(bucket.resetsAt)}</time>
            {/if}
            {#if bucket.remaining !== undefined}<span>{formatUsageValue(bucket.remaining, bucket.unit)} remaining</span>{/if}
            {#if bucket.limit !== undefined && bucket.unit !== "percent"}<span>Limit {formatUsageValue(bucket.limit, bucket.unit)}</span>{/if}
          </div>
        </div>
      {/each}
    </section>
  {/each}

  {#each metricGroups as group (group.currency)}
    <section class="metric-group" aria-label={group.currency ? `${group.currency} metrics` : "Usage metrics"}>
      {#if multipleCurrencies && group.currency}<h4>{group.currency}</h4>{/if}
      <dl>
        {#each group.metrics as metric (metric.id)}
          {@const textual = typeof metric.value === "string" && !metric.unit && !metric.currency}
          <div class="metric" class:textual>
            <dt>{metric.label}</dt>
            <dd>{formatUsageValue(metric.value, metric.unit, metric.currency)}</dd>
          </div>
        {/each}
      </dl>
    </section>
  {/each}

  {#if report.notes?.length}
    <div class="report-notes">
      {#each report.notes as note, index (index)}<p>{note}</p>{/each}
    </div>
  {/if}
</article>

<style>
  .usage-report { min-width: 0; }
  h3 { margin: 0 0 3px; font-size: var(--font-size-compact); font-weight: 600; }
  h4 { margin: 0 0 5px; color: var(--frost-faint); font-size: calc(var(--font-size-ui) - 3.5px); font-weight: 600; letter-spacing: .04em; text-transform: uppercase; overflow-wrap: anywhere; }
  p { margin: 0; }
  .report-heading { padding-bottom: 8px; border-bottom: 1px solid var(--frost-border-soft); }
  .semantics { color: var(--frost-muted); font-size: calc(var(--font-size-ui) - 2.5px); overflow-wrap: anywhere; }
  .report-context { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 8px; margin-top: 3px; color: var(--frost-faint); font-size: calc(var(--font-size-ui) - 3px); overflow-wrap: anywhere; }
  .report-context time { white-space: nowrap; }
  .bucket-group, .metric-group { padding-top: 8px; }
  .bucket-group + .bucket-group, .metric-group + .metric-group, .bucket-group + .metric-group { margin-top: 7px; border-top: 1px solid var(--frost-border-soft); }
  .bucket + .bucket { margin-top: 12px; }
  .bucket-heading { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 3px 8px; }
  .bucket-heading > span { color: var(--frost-muted); font-size: calc(var(--font-size-ui) - 2.5px); overflow-wrap: anywhere; }
  .bucket-heading strong { margin-left: auto; color: var(--frost-text); font-family: var(--font-mono); font-size: calc(var(--font-size-ui) - 1.5px); font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .usage-bar { height: 4px; margin-top: 6px; overflow: hidden; border-radius: 99px; background: color-mix(in srgb, var(--frost-muted) 15%, transparent); }
  .usage-bar span { display: block; height: 100%; border-radius: inherit; background: var(--frost-link); }
  .bucket-footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 3px 8px; margin-top: 5px; color: var(--frost-muted); font-size: calc(var(--font-size-ui) - 3px); }
  dl { margin: 0; }
  .metric { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 3px 8px; }
  .metric + .metric { margin-top: 6px; }
  dt { color: var(--frost-muted); font-size: calc(var(--font-size-ui) - 2.5px); overflow-wrap: anywhere; }
  dd { min-width: 0; max-width: 100%; margin: 0 0 0 auto; color: var(--frost-text); font-family: var(--font-mono); font-size: calc(var(--font-size-ui) - 1.5px); font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; overflow-wrap: anywhere; }
  .textual { flex-direction: column; align-items: stretch; gap: 2px; }
  .textual dd { margin-left: 0; font: inherit; text-align: left; white-space: pre-wrap; }
  .report-notes { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--frost-border-soft); color: var(--frost-muted); font-size: calc(var(--font-size-ui) - 3px); overflow-wrap: anywhere; }
  .report-notes p + p { margin-top: 4px; }
</style>
