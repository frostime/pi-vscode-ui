<script lang="ts">
  import type { UsageBucket, UsageReport } from "@frostime/provider-usage";
  import { postToHost } from "../../bridge/vscodeBridge";
  import { bucketProgress, formatUsageValue } from "./providerUsagePresentation";

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

  function windowLabel(bucket: UsageBucket): string | undefined {
    if (bucket.period) return bucket.period;
    if (bucket.windowMinutes === undefined) return undefined;
    const minutes = bucket.windowMinutes;
    if (minutes % 1_440 === 0) return `${minutes / 1_440}-day window`;
    if (minutes % 60 === 0) return `${minutes / 60}-hour window`;
    return `${minutes}-minute window`;
  }

  let { report }: { report: UsageReport } = $props();
  const groups = $derived(groupBuckets(report.buckets));
  const usagePage = "https://chatgpt.com/settings/usage";
</script>

<article class="usage-report">
  <h3>{report.providerName}</h3>
  <p class="semantics">{report.semantics.label}</p>
  {#if report.accountLabel}<p class="account">{report.accountLabel}</p>{/if}
  <p class="snapshot">Snapshot: <time datetime={new Date(report.capturedAt).toISOString()}>{new Date(report.capturedAt).toLocaleString()}</time></p>

  {#each groups as group (group.id)}
    <section class="bucket-group" aria-label={group.label || "Usage limits"}>
      {#if group.label}<h4>{group.label}</h4>{/if}
      {#each group.buckets as bucket (bucket.id)}
        {@const progress = bucketProgress(bucket)}
        {@const window = windowLabel(bucket)}
        <div class="bucket">
          <div class="bucket-heading"><strong>{bucket.label}</strong>{#if window}<span>{window}</span>{/if}</div>
          {#if progress !== undefined}<div class="usage-bar" aria-hidden="true"><span style:width={`${progress}%`}></span></div>{/if}
          <dl class="bucket-values">
            {#if bucket.used !== undefined}<div><dt>Used</dt><dd>{formatUsageValue(bucket.used, bucket.unit)}</dd></div>{/if}
            {#if bucket.remaining !== undefined}<div><dt>Remaining</dt><dd>{formatUsageValue(bucket.remaining, bucket.unit)}</dd></div>{/if}
            {#if bucket.limit !== undefined && bucket.unit !== "percent"}<div><dt>Limit</dt><dd>{formatUsageValue(bucket.limit, bucket.unit)}</dd></div>{/if}
          </dl>
          {#if bucket.resetsAt !== undefined}
            <p class="reset-time">Resets <time datetime={new Date(bucket.resetsAt * 1_000).toISOString()}>{new Date(bucket.resetsAt * 1_000).toLocaleString()}</time></p>
          {/if}
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
    {#if note === `Manage usage: ${usagePage}`}
      <button class="usage-link" type="button" onclick={() => postToHost({ type: "openExternal", url: usagePage })}>View usage on ChatGPT ↗</button>
    {:else}<p class="note">{note}</p>{/if}
  {/each}
</article>

<style>
  .usage-report { min-width: 0; }
  h3 { margin: 0; font-size: 1em; }
  h4 { margin: 12px 0 6px; font-size: .92em; color: var(--frost-text); }
  p { margin: 3px 0; }
  .semantics, .snapshot, .account, .note, .reset-time { color: var(--frost-muted); font-size: .88em; overflow-wrap: anywhere; }
  .snapshot { margin-top: 6px; }
  .bucket { padding: 9px 0; }
  .bucket + .bucket { border-top: 1px solid var(--frost-border-soft); }
  .bucket-heading { display: flex; flex-wrap: wrap; gap: 3px 8px; justify-content: space-between; font-size: .92em; }
  .bucket-heading span { color: var(--frost-muted); }
  .usage-bar { height: 5px; background: var(--frost-border); margin: 8px 0; overflow: hidden; }
  .usage-bar span { display: block; height: 100%; background: var(--frost-link); }
  dl { margin: 6px 0 0; font-size: .92em; }
  dl > div { display: flex; justify-content: space-between; gap: 8px; margin: 4px 0; }
  dt { color: var(--frost-muted); overflow-wrap: anywhere; }
  dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .metrics { border-top: 1px solid var(--frost-border); margin-top: 10px; padding-top: 6px; }
  .note { margin-top: 8px; }
  .usage-link { padding: 0; margin-top: 8px; background: transparent; color: var(--frost-link); text-decoration: underline; cursor: pointer; text-align: left; }
</style>
