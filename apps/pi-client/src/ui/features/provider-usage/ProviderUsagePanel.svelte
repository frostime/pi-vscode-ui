<script lang="ts">
  import { onMount } from "svelte";
  import type { ProviderUsageDescriptor, ProviderUsageResult } from "@frostime/provider-usage";

  import { postToHost } from "../../bridge/hostBridge";
  import ProviderUsageReport from "./ProviderUsageReport.svelte";
  import ProviderUsagePicker from "./ProviderUsagePicker.svelte";
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
  let credentialDetailsOpen = $state(false);
  let closeButton: HTMLButtonElement;
  let panel: HTMLDialogElement;
  let pending: AbortController | undefined;

  const selected = $derived(providers.find((provider) => provider.providerId === scope));
  const configuredProviders = $derived(providers.filter((provider) => provider.source !== "not-configured"));
  const selectableProviders = $derived(providers.filter((provider) => provider.source !== "not-configured" || provider.providerId === currentProviderId));
  const pickerOptions = $derived([
    ...(configuredProviders.length ? [{ value: "all", label: "All configured providers" }] : []),
    ...(currentProviderId && !providers.some((provider) => provider.providerId === currentProviderId)
      ? [{ value: currentProviderId, label: currentProviderId, status: "unsupported" as const }] : []),
    ...selectableProviders.map((provider) => ({
      value: provider.providerId, label: provider.displayName,
      status: provider.availability === "unavailable" ? "unavailable" as const : undefined,
    })),
  ]);
  const unsupported = $derived(Boolean(scope && scope !== "all" && !selected));
  const canQuery = $derived(loading !== "providers" && (scope === "all" ? configuredProviders.length > 0 : selected?.availability === "ready"));

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
      scope = currentProviderId ?? "";
      const current = listed.find((provider) => provider.providerId === scope);
      if (current?.availability === "ready") {
        loading = null;
        await query();
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
    credentialDetailsOpen = false;
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
    <ProviderUsagePicker options={pickerOptions} value={scope} disabled={loading === "providers"} onselect={(value) => {
      scope = value;
      selectScope();
    }} />
    <button class="icon-action" type="button" disabled={!canQuery} aria-label={loading === "usage" ? "Restart query" : queried ? "Refresh usage" : "Query usage"} title={loading === "usage" ? "Restart query" : queried ? "Refresh usage" : "Query usage"} onclick={() => void query(true)}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.7 5.5A5 5 0 1 0 13 9M13 2.5v3.5H9.5" /></svg>
    </button>
    <button bind:this={closeButton} class="icon-action" type="button" aria-label="Close provider usage" title="Close provider usage" onclick={() => close()}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>
    </button>
  </header>
  <div class="results" aria-busy={loading !== null}>
    <div role="status" aria-live="polite">
      {#if loading}<p class="status">{loading === "providers" ? "Listing providers…" : "Fetching usage…"}</p>{/if}
      {#if error}<p class="failure">{error}</p><button type="button" onclick={() => void (providers.length ? query() : loadProviders())}>Try again</button>{/if}
      {#if !loading && !error}
        {#if unsupported}
          <p class="empty">Usage queries are not supported for {scope}.</p>
          {#if configuredProviders.length}<p class="empty">You can select another configured provider.</p>{/if}
        {:else if selected?.availability === "unavailable"}
          <p class="empty">
            Could not obtain credentials for {selected.displayName}.
            <button class="credential-details-toggle" type="button" aria-expanded={credentialDetailsOpen} aria-controls="usage-credential-details" onclick={() => credentialDetailsOpen = !credentialDetailsOpen}>Details</button>
          </p>
          {#if credentialDetailsOpen}
            <div id="usage-credential-details" class="credential-details">
              <p>{selected.reason}</p>
              <p>FrostPi can read credentials from auth.json, provider-level models.json, and environment variables available to the Extension Host. Credentials injected dynamically by Pi extensions are not accessible.</p>
              <p>(This feature uses credentials only for usage queries. It does not log them, send them to an LLM, or save additional copies.)</p>
            </div>
          {/if}
        {:else if !scope}
          <p class="empty">{configuredProviders.length ? "Choose a provider to view its quota or balance." : "No supported providers are configured."}</p>
        {/if}
      {/if}
      {#if queried && !results.length}<p class="empty">No provider results were returned.</p>{/if}
    </div>
    {#each results as result (result.providerId)}
      <section class="provider-result">
        {#if result.status === "ready"}
          <ProviderUsageReport report={result.report} showProviderName={scope === "all"} />
        {:else}
          <h3>{providers.find((provider) => provider.providerId === result.providerId)?.displayName ?? result.providerId}</h3>
          <p class="result-state">{result.status === "selection-required" ? "Account selection required" : result.status === "unavailable" ? "Usage unavailable" : "Query failed"}</p>
          <p class="result-detail" class:failure={result.status === "query-failed"}>{result.reason}</p>
        {/if}
        {#if scope === "all"}{@render providerLinks(providers.find((provider) => provider.providerId === result.providerId))}{/if}
      </section>
    {/each}
  </div>
  {#if scope !== "all"}{@render providerLinks(selected)}{/if}
</dialog>

<style>
  .provider-usage-panel {
    position: absolute; z-index: 90; bottom: calc(100% + 6px); right: 0; left: auto; top: auto;
    width: min(var(--metrics-popover-width), calc(100vw - 20px)); max-height: min(480px, 70vh);
    margin: 0; padding: 10px; border: 1px solid var(--frost-border); border-radius: 8px;
    background: var(--frost-surface-raised); color: var(--frost-text); box-shadow: var(--frost-shadow);
    font-family: var(--font-ui); font-size: 11px; line-height: 1.35;
    display: flex; flex-direction: column; gap: 8px; overflow: visible; box-sizing: border-box;
  }
  header { position: relative; flex: none; display: flex; align-items: center; gap: 4px; }
  h3 { margin: 0; font-size: 12px; font-weight: 600; }
  p { margin: 0; }
  button { cursor: pointer; border: 1px solid var(--frost-border); border-radius: 4px; padding: 3px 7px; background: var(--frost-secondary-bg); color: inherit; font: inherit; }
  button:hover:not(:disabled) { background: var(--frost-hover); }
  button:disabled { opacity: .55; cursor: default; }
  svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
  .icon-action { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 0; background: transparent; color: var(--frost-muted); }
  .icon-action:hover:not(:disabled) { color: var(--frost-text); }
  .results { min-height: 0; overflow: auto; overscroll-behavior: contain; }
  .status, .empty { color: var(--frost-muted); padding: 4px 0; }
  .failure { color: var(--frost-warning); margin: 4px 0; overflow-wrap: anywhere; }
  .provider-result + .provider-result { border-top: 1px solid var(--frost-border-soft); margin-top: 10px; padding-top: 10px; }
  .result-state { color: var(--frost-muted); margin-top: 3px; }
  .result-detail { color: var(--frost-muted); margin-top: 5px; overflow-wrap: anywhere; }
  .result-detail.failure { color: var(--frost-warning); }
  .provider-links { flex: none; display: flex; flex-direction: column; gap: 4px; margin-top: 2px; padding-top: 8px; border-top: 1px solid var(--frost-border-soft); }
  .usage-link { align-self: flex-start; padding: 0; border: 0; background: transparent; color: var(--frost-link); font-size: 10px; text-align: left; }
  .usage-link:hover:not(:disabled) { background: transparent; text-decoration: underline; }
  .credential-details-toggle { padding: 0 2px; border: 0; background: transparent; color: var(--frost-muted); font-size: 10px; text-decoration: underline; }
  .credential-details { color: var(--frost-muted); font-size: 10px; overflow-wrap: anywhere; }
  .credential-details p { margin: 5px 0; }
</style>
