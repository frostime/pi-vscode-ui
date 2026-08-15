<script lang="ts">
  import type { StreamingBehavior } from "@frostime/pi-rpc";

  let {
    selected,
    disabled = false,
    onselect,
    onsubmit,
  }: {
    selected: StreamingBehavior;
    disabled?: boolean;
    onselect: (behavior: StreamingBehavior) => void;
    onsubmit: (behavior: StreamingBehavior) => void;
  } = $props();

  let open = $state(false);

  function choose(behavior: StreamingBehavior): void {
    open = false;
    onselect(behavior);
  }
</script>

<div class="streaming-send">
  {#if open}<button class="picker-scrim" type="button" aria-label="Close delivery picker" onclick={() => open = false}></button>{/if}
  <div class="streaming-send-group">
    <button
      class="streaming-send-main"
      type="button"
      aria-label={`Send as ${selected === "steer" ? "Steer" : "Queue"}`}
      title={`Send as ${selected === "steer" ? "Steer" : "Queue"} (Ctrl+Enter)`}
      {disabled}
      onclick={() => onsubmit(selected)}
    >
      <span class="codicon codicon-arrow-up"></span>
    </button>
    <button
      class="streaming-send-menu"
      class:active={open}
      type="button"
      aria-label="Choose streaming delivery"
      aria-haspopup="listbox"
      aria-expanded={open}
      title="Choose Steer or Queue"
      {disabled}
      onclick={() => open = !open}
    >
      <span class={`codicon codicon-chevron-${open ? "up" : "down"}`}></span>
    </button>
  </div>

  {#if open}
    <div class="streaming-send-panel" role="listbox" aria-label="Streaming delivery">
      <button type="button" role="option" aria-selected={selected === "steer"} onclick={() => choose("steer")}>
        <span class="codicon codicon-zap" aria-hidden="true"></span>
        <span><strong>Steer</strong><small>Inject before Pi's next response</small></span>
        <span class="option-check">{#if selected === "steer"}<span class="codicon codicon-check"></span>{/if}</span>
      </button>
      <button type="button" role="option" aria-selected={selected === "followUp"} onclick={() => choose("followUp")}>
        <span class="codicon codicon-clock" aria-hidden="true"></span>
        <span><strong>Queue</strong><small>Wait until current work finishes</small></span>
        <span class="option-check">{#if selected === "followUp"}<span class="codicon codicon-check"></span>{/if}</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .streaming-send {
    position: relative;
    z-index: 49;
    flex: none;
    width: 45px;
    animation: streaming-send-in var(--motion-fast) ease-out;
  }
  .streaming-send-group { display: flex; width: 45px; height: 27px; overflow: hidden; border-radius: 7px; }
  .streaming-send-group button { display: grid; place-items: center; height: 27px; padding: 0; background: var(--frost-accent); color: var(--frost-accent-text); cursor: pointer; }
  .streaming-send-group button:hover:not(:disabled) { background: var(--frost-accent-hover); }
  .streaming-send-group button:disabled { opacity: .35; cursor: default; }
  .streaming-send-main { width: 28px; }
  .streaming-send-menu { width: 17px; border-left: 1px solid color-mix(in srgb, var(--frost-accent-text) 24%, transparent); }
  .streaming-send-menu .codicon { font-size: 10px; }
  .streaming-send-panel {
    position: absolute;
    z-index: 50;
    right: 0;
    bottom: calc(100% + 7px);
    width: min(245px, calc(100vw - 20px));
    padding: 4px;
    border: 1px solid var(--frost-border);
    border-radius: 8px;
    background: var(--frost-surface-raised);
    box-shadow: var(--frost-shadow);
  }
  .streaming-send-panel button {
    width: 100%;
    min-height: 42px;
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) 18px;
    align-items: center;
    gap: 6px;
    padding: 5px 7px;
    border-radius: 5px;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .streaming-send-panel button:hover { background: var(--frost-hover); }
  .streaming-send-panel button[aria-selected="true"] { color: var(--frost-link); }
  .streaming-send-panel strong, .streaming-send-panel small { display: block; }
  .streaming-send-panel strong { font-size: 11px; font-weight: 600; }
  .streaming-send-panel small { margin-top: 2px; color: var(--frost-muted); font-size: 9.5px; }
  .option-check { display: grid; place-items: center; }
  @keyframes streaming-send-in {
    from { width: 0; opacity: 0; transform: translateX(5px) scale(.94); }
    to { width: 45px; opacity: 1; transform: translateX(0) scale(1); }
  }
</style>
