<script lang="ts">
  import type { RpcModel, ThinkingLevel } from "@frostime/pi-rpc";

  import { postToHost } from "../../bridge/hostBridge";
  import { getSupportedThinkingLevels, normalizeThinkingLevel } from "./thinkingLevels";

  let { sessionId, model, level, disabled = false }: { sessionId: string; model: RpcModel | null; level: ThinkingLevel; disabled?: boolean } = $props();
  let open = $state(false);
  const options = $derived(getSupportedThinkingLevels(model));
  const effectiveLevel = $derived(normalizeThinkingLevel(model, level));
  const active = $derived(options.find((option) => option.level === effectiveLevel) ?? options[0]);
  const selectable = $derived(Boolean(model?.reasoning) && options.length > 1 && !disabled);

  function choose(next: ThinkingLevel): void {
    open = false;
    if (next === level) return;
    postToHost({ type: "setThinkingLevel", sessionId, level: next });
  }
</script>

<div class="thinking-picker">
  {#if open}<button class="picker-scrim" type="button" aria-label="Close thinking level picker" onclick={() => open = false}></button>{/if}
  <button
    class="composer-chip thinking-trigger-button"
    class:active={open}
    type="button"
    aria-haspopup="listbox"
    aria-expanded={open}
    title={active?.description ?? "Thinking disabled"}
    disabled={!selectable}
    onclick={() => open = !open}
  >
    <span class="codicon codicon-lightbulb"></span>
    <span class="thinking-trigger-label">{active?.label ?? "Off"}</span>
    {#if selectable}<span class={`codicon codicon-chevron-${open ? "up" : "down"} thinking-chevron`}></span>{/if}
  </button>

  {#if open}
    <div class="thinking-picker-panel" role="listbox" aria-label="Thinking level">
      <div class="compact-picker-title">Thinking level</div>
      <div class="thinking-options">
        {#each options as option (option.level)}
          <button class:selected={option.level === effectiveLevel} type="button" role="option" aria-selected={option.level === effectiveLevel} title={option.description} onclick={() => choose(option.level)}>
            <span class="thinking-option-mark">{#if option.level === effectiveLevel}<span class="codicon codicon-check"></span>{/if}</span>
            <span>{option.label}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
