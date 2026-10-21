<script lang="ts">
  import type { RpcModel } from "@frostime/pi-rpc";

  let {
    provider,
    models,
    selected,
    open,
    toggle,
    onselect,
  }: {
    provider: string;
    models: RpcModel[];
    selected: RpcModel | null;
    open: boolean;
    toggle: () => void;
    onselect: (model: RpcModel) => void;
  } = $props();
</script>

<section class="provider-group">
  <button class="provider-trigger" type="button" aria-expanded={open} onclick={toggle}>
    <span class={`codicon codicon-chevron-${open ? "down" : "right"}`}></span>
    <span class="provider-name">{provider}</span>
    <span class="provider-count">{models.length}</span>
  </button>
  {#if open}
    <div class="provider-models">
      {#each models as model (`${model.provider}/${model.id}`)}
        <button
          class:selected={selected?.provider === model.provider && selected?.id === model.id}
          class="model-option"
          type="button"
          title={`${model.provider}/${model.id}`}
          aria-label={`${model.name ?? model.id}, ${model.provider}/${model.id}`}
          onclick={() => onselect(model)}
        >
          <span class="model-option-name">{model.name ?? model.id}</span>
          <span class="model-capabilities">
            {#if model.reasoning}<span title="Reasoning model" class="codicon codicon-lightbulb"></span>{/if}
            {#if supportsImages(model)}<span title="Supports images" class="codicon codicon-file-media"></span>{/if}
            {#if selected?.provider === model.provider && selected?.id === model.id}<span class="codicon codicon-check"></span>{/if}
          </span>
        </button>
      {/each}
    </div>
  {/if}
</section>

<script lang="ts" module>
  function supportsImages(model: RpcModel): boolean {
    return model.supportsImages === true || (Array.isArray(model.input) && model.input.includes("image"));
  }
</script>
