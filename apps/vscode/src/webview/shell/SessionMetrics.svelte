<script lang="ts">
  import { tick } from "svelte";
  import type { SessionViewModel } from "$shared/model/sessionViewModel";
  import ContextUsagePopover from "../features/usage/ContextUsagePopover.svelte";
  import ProviderUsagePanel from "../features/provider-usage/ProviderUsagePanel.svelte";
  import { mockProviderUsageSource } from "../features/provider-usage/mockProviderUsage";
  import { cacheProviderUsage } from "../features/provider-usage/providerUsageSource";

  let { session, providerUsageAvailable = false }: {
    session: SessionViewModel;
    providerUsageAvailable?: boolean;
  } = $props();
  const usageSource = cacheProviderUsage(mockProviderUsageSource);
  let usageOpen = $state(false);
  let usageTrigger = $state<HTMLButtonElement>();

  async function closeUsage(restoreFocus = true): Promise<void> {
    usageOpen = false;
    await tick();
    if (restoreFocus) usageTrigger?.focus();
  }
</script>

{#if session.stats || session.extensionStatuses.length}
  <div class="session-metrics">
    <div class="extension-statuses">
      {#each session.extensionStatuses as status (status.key)}
        <span><span class="status-mini-dot"></span>{status.text}</span>
      {/each}
    </div>
    {#if session.stats}
      <div class="metrics-right">
        {#if providerUsageAvailable}
          <button bind:this={usageTrigger} class="usage-trigger" type="button" aria-label="Provider usage" aria-expanded={usageOpen} onclick={() => usageOpen ? void closeUsage() : usageOpen = true}>Usage</button>
          {#if usageOpen}
            {#key session.model?.provider}
              <ProviderUsagePanel source={usageSource} currentProviderId={session.model?.provider} anchor={usageTrigger} mockData onclose={(restoreFocus) => void closeUsage(restoreFocus)} />
            {/key}
          {/if}
        {/if}
        <ContextUsagePopover {session} />
        <span title="Estimated session cost">${session.stats.cost.toFixed(3)}</span>
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
  gap: 8px;
  color: var(--frost-faint);
  font-size: 9px;
}
.extension-statuses { display: flex; align-items: center; gap: 8px; }
.metrics-right { position: relative; display: flex; align-items: center; gap: 8px; }
.usage-trigger { padding: 1px 3px; border-radius: 3px; background: transparent; color: inherit; cursor: pointer; font-size: inherit; }
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
  .extension-statuses { flex: 1; }
  .metrics-right { flex: none; }
}
</style>
