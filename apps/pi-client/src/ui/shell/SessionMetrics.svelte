<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { SessionViewModel } from "$shared/model/sessionViewModel";
  import ContextUsagePopover from "../features/usage/ContextUsagePopover.svelte";
  import ProviderUsagePanel from "../features/provider-usage/ProviderUsagePanel.svelte";
  import { cacheProviderUsage, type ProviderUsageSource } from "../features/provider-usage/providerUsageSource";

  let { session, providerUsageSource }: {
    session: SessionViewModel;
    providerUsageSource?: ProviderUsageSource | undefined;
  } = $props();
  // The shell supplies a stable source; snapshots belong to this metrics mount, not the displayed session/model.
  const usageSource = untrack(() => providerUsageSource ? cacheProviderUsage(providerUsageSource) : undefined);
  let usageOpen = $state(false);
  let usageTrigger = $state<HTMLButtonElement>();
  let now = $state(Date.now());
  const response = $derived(session.responseMetrics);
  const awaitingOutput = $derived(response?.outputTokens === undefined ? response?.startedAt : undefined);
  const elapsedMs = $derived(Math.max(0, now - (response?.startedAt ?? now)));
  const tokensPerSecond = $derived(response?.outputTokensPerSecond ?? (response?.outputTokens && response.durationMs
    ? response.outputTokens * 1000 / response.durationMs : undefined));
  const rateHelp = $derived(response?.outputTokensPerSecond !== undefined
    ? "Rate estimated from the arrivals of streamed output."
    : "Average rate over the full response, including the wait for the first token.");

  $effect(() => {
    if (awaitingOutput === undefined) return;
    now = Date.now();
    const timer = setInterval(() => { now = Date.now(); }, 250);
    return () => clearInterval(timer);
  });

  async function closeUsage(restoreFocus = true): Promise<void> {
    usageOpen = false;
    await tick();
    if (restoreFocus) usageTrigger?.focus();
  }
</script>

{#if session.stats || session.extensionStatuses.length || response}
  <div class="session-metrics">
    <div class="extension-statuses">
      {#each session.extensionStatuses as status (status.key)}
        <span><span class="status-mini-dot"></span>{status.text}</span>
      {/each}
      {#if response}
        <span class="response-metrics" style:color="var(--frost-muted)" style:font-size="calc(var(--font-size-ui) - 2px)"
          style:white-space="nowrap" style:font-variant-numeric="tabular-nums" style:flex-shrink="0"
          title={response.estimated ? `Token count estimated from streamed content. ${rateHelp}` : rateHelp}>
          {#if response.outputTokens !== undefined}
            {response.estimated ? "≈" : ""}{response.outputTokens.toLocaleString()} output tokens
            {#if tokensPerSecond !== undefined} · {response.estimated || response.outputTokensPerSecond !== undefined ? "≈" : ""}{tokensPerSecond.toFixed(1)} tok/s{/if}
          {:else}
            Receiving response · {(elapsedMs / 1000).toFixed(1)} s
          {/if}
        </span>
      {/if}
    </div>
    {#if session.stats}
      <div class="metrics-right">
        {#if usageSource}
          <button bind:this={usageTrigger} class="usage-trigger" type="button" aria-label="Provider usage" aria-expanded={usageOpen} onclick={() => usageOpen ? void closeUsage() : usageOpen = true}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 12V8m5 4V4m5 8V6" /></svg>
            <span>Usage</span>
          </button>
          {#if usageOpen}
            {#key session.model?.provider}
              <ProviderUsagePanel source={usageSource} currentProviderId={session.model?.provider} anchor={usageTrigger} onclose={(restoreFocus) => void closeUsage(restoreFocus)} />
            {/key}
          {/if}
        {/if}
        <ContextUsagePopover {session} />
      </div>
    {/if}
  </div>
{/if}

<style>
.session-metrics {
  width: 100%;
  max-width: var(--content-max-width);
  min-height: 17px;
  margin: 0 auto 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2px 8px;
  flex-wrap: wrap;
  color: var(--frost-faint);
  font-size: calc(var(--font-size-ui) - 4px);
}
.extension-statuses { display: flex; align-items: center; flex-wrap: wrap; gap: 2px 8px; }
.metrics-right { position: relative; display: flex; align-items: center; gap: 4px; margin-left: auto; }
.usage-trigger {
  display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 4px;
  border: 0; border-radius: 4px; background: transparent; color: var(--frost-muted);
  cursor: pointer; font: inherit; white-space: nowrap;
}
.usage-trigger svg { width: 1.4em; height: 1.4em; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; }
.usage-trigger:hover, .usage-trigger:focus-visible { color: var(--frost-text); background: var(--frost-hover); }
.extension-statuses { overflow: hidden; }
.extension-statuses :global(span) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status-mini-dot {
  display: inline-block;
  width: 4px;
  height: 4px;
  margin-right: 4px;
  border-radius: 50%;
  background: var(--frost-link);
}

@media (max-width: 430px) {
  .session-metrics { min-width: 0; }
  .extension-statuses { flex: auto; }
  .metrics-right { flex: none; }
}
</style>
