<script lang="ts">
  import { tick } from "svelte";
  import type { RpcModel } from "@frostime/pi-rpc";

  import { postToHost } from "../../bridge/vscodeBridge";
  import ProviderGroup from "./ProviderGroup.svelte";

  type ModelScope = "scoped" | "all";

  let {
    sessionId,
    model,
    models,
    scopedModelIds,
    disabled = false,
  }: {
    sessionId: string;
    model: RpcModel | null;
    models: RpcModel[];
    scopedModelIds: string[];
    disabled?: boolean;
  } = $props();
  let open = $state(false);
  let query = $state("");
  let scope = $state<ModelScope>("all");
  let searchInput = $state<HTMLInputElement | null>(null);
  let scrollContainer = $state<HTMLDivElement | null>(null);
  let expandedProviders = $state<Set<string>>(new Set());

  const scopedIds = $derived.by(() => new Set(scopedModelIds));
  const hasScopedModels = $derived(scopedIds.size > 0);
  const visibleModels = $derived(
    scope === "scoped" && hasScopedModels
      ? models.filter((item) => scopedIds.has(`${item.provider}/${item.id}`))
      : models,
  );

  const groups = $derived.by(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = normalized
      ? visibleModels.filter((item) => `${item.provider} ${item.name ?? ""} ${item.id}`.toLowerCase().includes(normalized))
      : visibleModels;
    const map = new Map<string, RpcModel[]>();
    for (const item of filtered) map.set(item.provider, [...(map.get(item.provider) ?? []), item]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  });

  const allVisibleOpen = $derived(groups.length > 0 && groups.every(([provider]) => query.trim().length > 0 || expandedProviders.has(provider)));

  function selectModel(next: RpcModel): void {
    open = false;
    query = "";
    postToHost({ type: "setModel", sessionId, provider: next.provider, modelId: next.id });
  }

  function setScope(next: ModelScope): void {
    if (next === "scoped" && !hasScopedModels) return;
    scope = next;
    expandProviderForScope(next);
  }

  function expandProviderForScope(next: ModelScope): void {
    const currentModelVisible = model !== null && (next === "all" || scopedIds.has(modelKey(model)));
    const provider = currentModelVisible
      ? model?.provider
      : models.find((item) => next === "all" || scopedIds.has(modelKey(item)))?.provider;
    if (!provider || expandedProviders.has(provider)) return;
    expandedProviders = new Set(expandedProviders).add(provider);
  }

  async function togglePicker(): Promise<void> {
    if (open) {
      open = false;
      return;
    }

    query = "";
    scope = scopedModelIds.length > 0 ? "scoped" : "all";
    expandProviderForScope(scope);
    open = true;

    await tick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (!open) return;

    searchInput?.focus();
    const selected = scrollContainer?.querySelector<HTMLButtonElement>(".model-option.selected");
    if (!selected || !scrollContainer) return;

    const selectedBounds = selected.getBoundingClientRect();
    const containerBounds = scrollContainer.getBoundingClientRect();
    scrollContainer.scrollTop += selectedBounds.top + selectedBounds.height / 2 - (containerBounds.top + containerBounds.height / 2);
  }

  function toggleProvider(provider: string): void {
    const next = new Set(expandedProviders);
    if (next.has(provider)) next.delete(provider);
    else next.add(provider);
    expandedProviders = next;
  }

  function setAllExpanded(expanded: boolean): void {
    expandedProviders = expanded ? new Set(groups.map(([provider]) => provider)) : new Set();
  }

  function modelKey(item: RpcModel): string {
    return `${item.provider}/${item.id}`;
  }
</script>

<div class="model-picker">
  <button class="composer-chip model-picker-trigger" type="button" {disabled} onclick={togglePicker} title={model ? `${model.provider}/${model.id}` : "Choose model"}>
    <span class="codicon codicon-sparkle"></span>
    <span class="chip-text">{model?.name ?? model?.id ?? "Model"}</span>
    <span class={`codicon codicon-chevron-${open ? "down" : "up"}`}></span>
  </button>
  {#if open}
    <button class="picker-scrim" type="button" aria-label="Close model picker" onclick={() => open = false}></button>
    <div class="model-picker-panel">
      <div class="picker-header">
        <strong>Models</strong>
        {#if hasScopedModels}
          <div class="picker-scope" role="group" aria-label="Model scope">
            <button class:active={scope === "scoped"} type="button" aria-pressed={scope === "scoped"} onclick={() => setScope("scoped")}>Scoped <span>{scopedModelIds.length}</span></button>
            <button class:active={scope === "all"} type="button" aria-pressed={scope === "all"} onclick={() => setScope("all")}>All <span>{models.length}</span></button>
          </div>
        {:else}
          <span class="picker-scope-label">All models</span>
        {/if}
        <div class="picker-header-actions">
          <button type="button" aria-label={allVisibleOpen ? "Collapse all providers" : "Expand all providers"} title={allVisibleOpen ? "Collapse all" : "Expand all"} onclick={() => setAllExpanded(!allVisibleOpen)}>
            <span class={`codicon codicon-${allVisibleOpen ? "collapse-all" : "expand-all"}`}></span>
          </button>
          <button type="button" aria-label="Refresh models" title="Refresh models" onclick={() => postToHost({ type: "refreshModels", sessionId })}><span class="codicon codicon-refresh"></span></button>
        </div>
      </div>
      <div class="picker-search">
        <span class="codicon codicon-search"></span>
        <input bind:this={searchInput} bind:value={query} placeholder={scope === "scoped" ? "Search scoped models" : "Search all models"} aria-label={scope === "scoped" ? "Search scoped models" : "Search all models"} onkeydown={(event) => { if (event.key === "Escape") open = false; }} />
      </div>
      <div class="picker-scroll" bind:this={scrollContainer}>
        {#if groups.length}
          {#each groups as [provider, providerModels] (provider)}
            <ProviderGroup
              {provider}
              models={providerModels}
              selected={model}
              open={query.trim().length > 0 || expandedProviders.has(provider)}
              toggle={() => toggleProvider(provider)}
              onselect={selectModel}
            />
          {/each}
        {:else}
          <div class="picker-empty">No matching models</div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .model-picker-panel .picker-header {
    gap: 7px;
  }

  .model-picker-panel .picker-header > strong {
    flex: none;
  }

  .model-picker-panel .picker-header-actions {
    margin-left: auto;
    flex: none;
  }

  .picker-scope {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 2px;
    background: var(--frost-input-bg);
    border: 1px solid var(--frost-border-soft);
    border-radius: 5px;
  }

  .picker-scope button {
    width: auto;
    height: 21px;
    padding: 0 6px;
    border-radius: 3px;
    color: var(--frost-muted);
    font-size: 10px;
    line-height: 1;
    white-space: nowrap;
  }

  .picker-scope button:hover {
    background: var(--frost-hover);
    color: var(--frost-text);
  }

  .picker-scope button.active {
    background: var(--frost-active);
    color: var(--frost-text);
  }

  .picker-scope button span {
    color: var(--frost-muted);
    font-size: 9px;
  }

  .picker-scope-label {
    min-width: 0;
    overflow: hidden;
    color: var(--frost-muted);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 330px) {
    .picker-scope button {
      padding-left: 4px;
      padding-right: 4px;
    }

    .picker-scope button span {
      display: none;
    }
  }
</style>
