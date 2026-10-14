<script lang="ts">
  import { onMount } from "svelte";
  import type { ProviderUsageDescriptor, ProviderUsageResult } from "@frostime/provider-usage";

  import { postToHost } from "../../bridge/vscodeBridge";
  import ProviderUsageReport from "./ProviderUsageReport.svelte";
  import type { ProviderUsageSource } from "./providerUsageSource";

  let { source, onclose, currentProviderId, anchor }: {
    source: ProviderUsageSource;
    onclose: (restoreFocus?: boolean) => void;
    currentProviderId?: string | undefined;
    anchor?: HTMLElement | undefined;
  } = $props();

  let providers = $state<readonly ProviderUsageDescriptor[]>([]);
  let results = $state<readonly ProviderUsageResult[]>([]);
  let scope = $state("");
  let loading = $state<"providers" | "usage" | null>("providers");
  let error = $state("");
  let queried = $state(false);
  let closeButton: HTMLButtonElement;
  let panel: HTMLDialogElement;
  let pending: AbortController | undefined;

  const selected = $derived(providers.find((provider) => provider.providerId === scope));
  const canQuery = $derived(loading !== "providers" && (scope === "all" ? providers.length > 0 : selected?.availability === "ready"));

  onMount(() => {
    closeButton.focus();
    void loadProviders();
    const dismissOutside = (event: PointerEvent): void => {
      if (panel.contains(event.target as Node) || anchor?.contains(event.target as Node)) return;
      close(false);
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => {
      pending?.abort();
      document.removeEventListener("pointerdown", dismissOutside);
    };
  });

  async function loadProviders(): Promise<void> {
    const request = replaceRequest();
    loading = "providers";
    error = "";
    try {
      const listed = await source.listProviders(request.signal);
      if (request.signal.aborted) return;
      providers = listed;
      const current = listed.find((provider) => provider.providerId === currentProviderId);
      if (current) {
        scope = current.providerId;
        if (current.availability === "ready") {
          loading = null;
          await query();
        }
      }
    } catch {
      if (!request.signal.aborted) error = "Could not list providers. Try again.";
    } finally {
      if (pending === request) loading = null;
    }
  }

  async function query(refresh = false): Promise<void> {
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
      const fetched = await source.queryUsage(queryScope, request.signal, { refresh });
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
    if (canQuery) void query();
  }

  function close(restoreFocus = true): void {
    pending?.abort();
    onclose(restoreFocus);
  }
</script>

<svelte:window onkeydown={(event) => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  event.preventDefault();
  close();
}} />

{#snippet providerLinks(provider: ProviderUsageDescriptor | undefined)}
  {#if provider?.links?.length}
    <nav class="provider-links" aria-label={`${provider.displayName} official pages`}>
      {#each provider.links as link (link.url)}
        <button class="usage-link" type="button" onclick={() => postToHost({ type: "openExternal", url: link.url })}>{link.label} ↗</button>
      {/each}
    </nav>
  {/if}
{/snippet}

<dialog bind:this={panel} open class="provider-usage-panel" aria-label="Provider usage" aria-modal="false">
  <header>
    <h2>Provider usage</h2>
    <button bind:this={closeButton} class="close" type="button" aria-label="Close provider usage" onclick={() => close()}>×</button>
  </header>
  <div class="query-controls">
    <select id="usage-provider" aria-label="Provider" bind:value={scope} onchange={selectScope} disabled={loading === "providers"}>
      <option value="">Choose a provider…</option>
      {#if providers.length}<option value="all">All configured providers</option>{/if}
      {#each providers as provider (provider.providerId)}
        <option value={provider.providerId}>{provider.displayName}{provider.availability === "unavailable" ? " · unavailable" : ""}</option>
      {/each}
    </select>
    <button class="query" type="button" disabled={!canQuery} aria-label={loading === "usage" ? "Restart query" : queried ? "Refresh usage" : "Query usage"} title={loading === "usage" ? "Restart query" : queried ? "Refresh usage" : "Query usage"} onclick={() => void query(true)}>{queried || loading === "usage" ? "↻" : "Query"}</button>
  </div>
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
          <ProviderUsageReport report={result.report} showProviderName={scope === "all"} />
        {:else}
          <h3>{providers.find((provider) => provider.providerId === result.providerId)?.displayName ?? result.providerId}</h3>
          <p class="result-state">{result.status === "selection-required" ? "Account selection required" : result.status === "unavailable" ? "Usage unavailable" : "Query failed"}</p>
          <p class="failure">{result.reason}</p>
        {/if}
        {#if scope === "all"}{@render providerLinks(providers.find((provider) => provider.providerId === result.providerId))}{/if}
      </section>
    {/each}
  </div>
  {#if scope !== "all"}{@render providerLinks(selected)}{/if}
  <details class="about-data">
    <summary>About this data</summary>
    <p>Pi files and the VS Code Host environment. Model-specific and extension-injected authentication are not included.</p>
    {#if selected}<p>Credential source: {selected.source}</p>{/if}
  </details>
</dialog>

<style>
  .provider-usage-panel {
    position: absolute; z-index: 90; bottom: calc(100% + 8px); right: 0; left: auto; top: auto;
    width: min(320px, calc(100vw - 20px)); max-height: min(480px, 70vh);
    margin: 0; padding: 10px; border: 1px solid var(--frost-border); border-radius: var(--radius-xs);
    background: var(--frost-surface-raised); color: var(--frost-text); font-size: 11px; line-height: 1.4;
    display: flex; flex-direction: column; gap: 8px; overflow: hidden; box-sizing: border-box;
  }
  header { display: flex; align-items: center; gap: 8px; }
  h2 { flex: 1; margin: 0; font-size: 12px; }
  h3 { margin: 0; font-size: 11px; }
  p { margin: 0; }
  button { cursor: pointer; border: 1px solid var(--frost-border); border-radius: 3px; padding: 3px 7px; background: var(--frost-secondary-bg); }
  button:hover:not(:disabled) { background: var(--frost-secondary-hover); }
  button:disabled { opacity: .55; cursor: default; }
  .close { flex: none; width: 22px; height: 22px; padding: 0; font-size: 16px; border: 0; background: transparent; }
  .query-controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; }
  select { width: 100%; min-width: 0; border: 1px solid var(--frost-input-border); border-radius: 3px; background: var(--frost-input-bg); padding: 4px; }
  .query { min-width: 27px; background: transparent; }
  .results { min-height: 0; overflow: auto; overscroll-behavior: contain; }
  .status, .empty { color: var(--frost-muted); padding: 4px 0; }
  .failure { color: var(--frost-warning); margin: 4px 0; overflow-wrap: anywhere; }
  .provider-result + .provider-result { border-top: 1px solid var(--frost-border); margin-top: 10px; padding-top: 10px; }
  .result-state { color: var(--frost-muted); margin-top: 3px; }
  .provider-links { display: flex; flex-direction: column; gap: 4px; }
  .usage-link { padding: 0; border: 0; background: transparent; color: var(--frost-link); text-decoration: underline; text-align: left; }
  .about-data { color: var(--frost-muted); font-size: 10px; border-top: 1px solid var(--frost-border-soft); padding-top: 6px; }
  .about-data summary { cursor: pointer; }
  .about-data p { margin-top: 5px; }
</style>
