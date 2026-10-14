<script lang="ts">
  import type { UsageBucket, UsageReport } from "@frostime/provider-usage";
  import { bucketProgress, formatUsageValue } from "./providerUsagePresentation";

  let { report, showProviderName = true }: { report: UsageReport; showProviderName?: boolean } = $props();
  const groups = $derived(groupBuckets(report.buckets));

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
  {#if showProviderName}<h3>{report.providerName}</h3>{/if}
  <div class="report-meta">
    <span class="semantics">{report.semantics.label}</span>
    <time class="snapshot" datetime={new Date(report.capturedAt).toISOString()} title={`Snapshot: ${new Date(report.capturedAt).toLocaleString()}`}>Updated {new Date(report.capturedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</time>
  </div>
  {#if report.accountLabel}<p class="account">{report.accountLabel}</p>{/if}

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

  {#if report.metrics.length}
    <dl class="metrics">
      {#each report.metrics as metric (metric.id)}<div><dt>{metric.label}</dt><dd>{formatUsageValue(metric.value, metric.unit, metric.currency)}</dd></div>{/each}
    </dl>
  {/if}
  {#each report.notes ?? [] as note, index (index)}
    <p class="note">{note}</p>
  {/each}
</article>

<style>
  .usage-report { min-width: 0; }
  h3 { margin: 0 0 3px; font-size: 11px; }
  h4 { margin: 8px 0 4px; font-size: 10px; color: var(--frost-muted); font-weight: 600; }
  p { margin: 3px 0; }
  .report-meta { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 8px; color: var(--frost-muted); font-size: 10px; }
  .semantics { overflow-wrap: anywhere; }
  .snapshot { white-space: nowrap; }
  .account, .note { color: var(--frost-muted); font-size: 10px; overflow-wrap: anywhere; }
  .bucket { padding: 5px 0; }
  .bucket-heading { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; }
  .bucket-heading span { overflow-wrap: anywhere; }
  .bucket-heading strong { flex: none; font-weight: 500; font-variant-numeric: tabular-nums; }
  .usage-bar { height: 4px; background: var(--frost-border); margin: 5px 0; overflow: hidden; }
  .usage-bar span { display: block; height: 100%; background: var(--frost-link); }
  .bucket-footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 8px; color: var(--frost-muted); font-size: 10px; }
  dl { margin: 6px 0 0; font-size: 11px; }
  dl > div { display: flex; justify-content: space-between; gap: 8px; margin: 3px 0; }
  dt { color: var(--frost-muted); overflow-wrap: anywhere; }
  dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .metrics { border-top: 1px solid var(--frost-border-soft); padding-top: 5px; }
  .note { margin-top: 5px; }
</style>
