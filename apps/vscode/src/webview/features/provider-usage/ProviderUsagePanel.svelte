<script lang="ts">
  import { onMount } from "svelte";
  import type { ProviderUsageDescriptor, ProviderUsageResult } from "@frostime/provider-usage";

  import ProviderUsageReport from "./ProviderUsageReport.svelte";
  import type { ProviderUsageSource } from "./providerUsageSource";

  let { source, onclose, currentProviderId, mockData = false }: {
    source: ProviderUsageSource;
    onclose: () => void;
    currentProviderId?: string | undefined;
    mockData?: boolean;
  } = $props();

  let providers = $state<readonly ProviderUsageDescriptor[]>([]);
  let results = $state<readonly ProviderUsageResult[]>([]);
  let scope = $state("");
  let loading = $state<"providers" | "usage" | null>("providers");
  let error = $state("");
  let queried = $state(false);
  let closeButton: HTMLButtonElement;
  let pending: AbortController | undefined;

  const selected = $derived(providers.find((provider) => provider.providerId === scope));
  const canQuery = $derived(loading !== "providers" && (scope === "all" ? providers.length > 0 : selected?.availability === "ready"));

  onMount(() => {
    closeButton.focus();
    void loadProviders();
    return () => pending?.abort();
  });

  async function loadProviders(): Promise<void> {
    const request = replaceRequest();
    loading = "providers";
    error = "";
    try {
      const listed = await source.listProviders(request.signal);
      if (request.signal.aborted) return;
      providers = listed;
      if (listed.some((provider) => provider.providerId === currentProviderId)) scope = currentProviderId ?? "";
    } catch {
      if (!request.signal.aborted) error = "Could not list providers. Try again.";
    } finally {
      if (pending === request) loading = null;
    }
  }

  async function query(): Promise<void> {
    if (!canQuery) return;
    const request = replaceRequest();
    const queryScope = scope;
    loading = "usage";
    error = "";
    results = [];
    queried = false;
    try {
      const listed = await source.listProviders(request.signal);
      if (request.signal.aborted) return;
      providers = listed;
      const fetched = await source.queryUsage(queryScope, request.signal);
      if (request.signal.aborted) return;
      results = fetched;
      queried = true;
    } catch {
      if (!request.signal.aborted) error = "Could not retrieve usage. Try again.";
    } finally {
      if (pending === request) loading = null;
    }
  }

  function replaceRequest(): AbortController {
    pending?.abort();
    pending = new AbortController();
    return pending;
  }

  function selectScope(): void {
    pending?.abort();
    loading = null;
    results = [];
    error = "";
    queried = false;
  }

  function close(): void {
    pending?.abort();
    onclose();
  }
</script>

<svelte:window onkeydown={(event) => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  event.preventDefault();
  close();
}} />

<dialog open class="provider-usage-panel" aria-label="Provider usage" aria-modal="false">
  <header>
    <h2>Provider usage</h2>
    <button bind:this={closeButton} class="close" type="button" aria-label="Close provider usage" onclick={close}>×</button>
  </header>
  {#if mockData}<p class="mock-notice">Mock data · UI preview only. No account requests.</p>{/if}
  <p class="source-note">Uses Pi files and the VS Code Host environment. Model-specific and extension-injected authentication are not included.</p>
  <div class="query-controls">
    <label for="usage-provider">Provider</label>
    <select id="usage-provider" bind:value={scope} onchange={selectScope} disabled={loading === "providers"}>
      <option value="">Choose a provider…</option>
      {#if providers.length}<option value="all">All configured providers</option>{/if}
      {#each providers as provider (provider.providerId)}
        <option value={provider.providerId}>{provider.displayName}{provider.availability === "unavailable" ? " · unavailable" : ""}</option>
      {/each}
    </select>
    <button class="query" type="button" disabled={!canQuery} onclick={() => void query()}>{loading === "usage" ? "Restart query" : queried ? "Refresh" : "Query"}</button>
  </div>
  {#if selected}<p class="source-category">Credential source: {selected.source}</p>{/if}
  <div class="results" aria-busy={loading !== null}>
    <div role="status" aria-live="polite">
      {#if loading}<p class="status">{loading === "providers" ? "Listing providers…" : "Fetching usage…"}</p>{/if}
      {#if error}<p class="failure">{error}</p><button type="button" onclick={() => void (providers.length ? query() : loadProviders())}>Try again</button>{/if}
      {#if !loading && !error && !providers.length}<p class="empty">No supported providers are configured.</p>{/if}
      {#if !loading && !error && selected?.availability === "unavailable"}<p class="failure">{selected.reason}</p>{/if}
      {#if !loading && !error && providers.length && !scope}<p class="empty">Choose a provider to view its quota or balance.</p>{/if}
      {#if queried && !results.length}<p class="empty">No provider results were returned.</p>{/if}
    </div>
    {#each results as result (result.providerId)}
      <section class="provider-result">
        {#if result.status === "ready"}
          <ProviderUsageReport report={result.report} />
        {:else}
          <h3>{providers.find((provider) => provider.providerId === result.providerId)?.displayName ?? result.providerId}</h3>
          <p class="result-state">{result.status === "selection-required" ? "Account selection required" : result.status === "unavailable" ? "Usage unavailable" : "Query failed"}</p>
          <p class="failure">{result.reason}</p>
        {/if}
        <p class="result-source">Credential source: {result.source}</p>
      </section>
    {/each}
  </div>
</dialog>

<style>
  .provider-usage-panel {
    position: absolute; z-index: 90; top: calc(var(--header-height) + 8px); right: 10px; left: auto;
    width: min(420px, calc(100% - 20px)); max-height: calc(100% - var(--header-height) - 18px);
    margin: 0; padding: 12px; border: 1px solid var(--frost-border); border-radius: var(--radius-xs);
    background: var(--frost-surface-raised); color: var(--frost-text); font-size: .92em;
    display: flex; flex-direction: column; gap: 9px; overflow: hidden; box-sizing: border-box;
  }
  header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  h2 { margin: 0; font-size: 1.08em; }
  h3 { margin: 0; font-size: 1em; }
  p { margin: 0; }
  button { cursor: pointer; border: 1px solid var(--frost-border); border-radius: 3px; padding: 4px 8px; background: var(--frost-secondary-bg); }
  button:hover:not(:disabled) { background: var(--frost-secondary-hover); }
  button:disabled { opacity: .55; cursor: default; }
  .close { flex: none; width: 26px; height: 26px; padding: 0; font-size: 18px; background: transparent; }
  .mock-notice { color: var(--frost-text); border-left: 2px solid var(--frost-warning); padding-left: 7px; font-size: .9em; }
  .source-note { color: var(--frost-muted); font-size: .88em; }
  .query-controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 8px; }
  label { grid-column: 1 / -1; font-size: .9em; }
  select { width: 100%; min-width: 0; border: 1px solid var(--frost-input-border); border-radius: 3px; background: var(--frost-input-bg); padding: 5px; }
  .query { background: var(--frost-accent); color: var(--frost-accent-text); }
  .query:hover:not(:disabled) { background: var(--frost-accent-hover); }
  .source-category, .result-source { color: var(--frost-muted); font-size: .85em; }
  .results { min-height: 0; overflow: auto; overscroll-behavior: contain; }
  .status, .empty { color: var(--frost-muted); padding: 6px 0; }
  .failure { color: var(--frost-warning); margin: 6px 0; overflow-wrap: anywhere; }
  .provider-result { border-top: 1px solid var(--frost-border); padding: 12px 0; }
  .result-state { color: var(--frost-muted); margin-top: 3px; }
  .result-source { margin-top: 9px; }
</style>
