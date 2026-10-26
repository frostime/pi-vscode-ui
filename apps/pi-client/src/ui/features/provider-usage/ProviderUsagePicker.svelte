<script lang="ts">
  import { tick } from "svelte";

  let { options, value, disabled = false, onselect }: {
    options: readonly { value: string; label: string; status?: "unsupported" | "unavailable" | undefined }[];
    value: string;
    disabled?: boolean;
    onselect: (value: string) => void;
  } = $props();

  const listId = $props.id();
  const selected = $derived(options.find((option) => option.value === value));
  let open = $state(false);
  let above = $state(false);
  let maxHeight = $state(256);
  let activeIndex = $state(0);
  let trigger: HTMLButtonElement;
  let picker: HTMLDivElement;
  let menu = $state<HTMLDivElement>();
  let search = "";
  let lastTypedAt = 0;

  $effect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent): void => {
      if (!picker.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", dismiss);
    // Query completion can move the heading without resizing the window.
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(positionMenu);
    const surface = picker.closest("dialog");
    if (surface) observer?.observe(surface);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      observer?.disconnect();
    };
  });

  function close(restoreFocus = true): void {
    open = false;
    if (restoreFocus) trigger.focus();
  }

  function positionMenu(): void {
    if (!open || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const belowSpace = window.innerHeight - rect.bottom - 14;
    const aboveSpace = rect.top - 14;
    above = belowSpace < Math.min(256, menu.scrollHeight) && aboveSpace > belowSpace;
    maxHeight = Math.max(0, Math.min(256, above ? aboveSpace : belowSpace));
  }

  async function show(last = false): Promise<void> {
    if (disabled || !options.length) return;
    search = "";
    maxHeight = 256;
    open = true;
    const index = options.findIndex((option) => option.value === value);
    activeIndex = index >= 0 ? index : last ? options.length - 1 : 0;
    await tick();
    if (!open || !menu?.isConnected) return;
    positionMenu();
    await tick();
    if (open && menu?.isConnected) focusOption(activeIndex);
  }

  function focusOption(index: number): void {
    activeIndex = index;
    const option = menu?.querySelectorAll<HTMLButtonElement>('[role="option"]')[index];
    option?.focus();
    option?.scrollIntoView?.({ block: "nearest" });
  }

  function choose(next: string): void {
    close();
    if (next !== value) onselect(next);
  }

  function handleMenuKey(event: KeyboardEvent): void {
    const offsets: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };
    if (event.key in offsets || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
        : (activeIndex + offsets[event.key]! + options.length) % options.length;
      focusOption(next);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(options[activeIndex]!.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      close();
      if (event.shiftKey) event.preventDefault();
    } else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      search = now - lastTypedAt < 700 ? search + event.key.toLowerCase() : event.key.toLowerCase();
      lastTypedAt = now;
      const prefix = [...search].every((letter) => letter === search[0]) ? search[0]! : search;
      for (let step = 1; step <= options.length; step++) {
        const index = (activeIndex + step) % options.length;
        if (options[index]!.label.toLowerCase().startsWith(prefix)) { focusOption(index); break; }
      }
    }
  }
</script>

<svelte:window onresize={positionMenu} />

<div bind:this={picker} class="provider-picker" onfocusout={(event) => {
  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(false);
}}>
  <button bind:this={trigger} class="provider-trigger" class:active={open} type="button" aria-label={selected ? `Provider: ${selected.label}` : "Provider"} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} title={selected?.label ?? "Choose a provider"} disabled={disabled || !options.length} onclick={() => open ? close() : void show()} onkeydown={(event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      void show(event.key === "ArrowUp");
    }
  }}>
    <span>{selected?.label ?? "Choose a provider…"}</span>
    <svg class:rotated={open} viewBox="0 0 16 16" aria-hidden="true"><path d="m5 6.5 3 3 3-3" /></svg>
  </button>
  {#if open}
    <div bind:this={menu} id={listId} class="provider-menu" class:above role="listbox" tabindex="-1" aria-label="Providers" style:max-height={`${maxHeight}px`} onkeydown={handleMenuKey}>
      {#each options as option, index (option.value)}
        <button class="provider-option" type="button" role="option" aria-selected={option.value === value} tabindex={index === activeIndex ? 0 : -1} title={option.label} onfocus={() => activeIndex = index} onclick={() => choose(option.value)}>
          <span class="option-label">{option.label}</span>
          {#if option.status}<span class="option-status">{option.status === "unsupported" ? "Unsupported" : "Unavailable"}</span>{/if}
          <span class="option-check" aria-hidden="true">{#if option.value === value}<svg viewBox="0 0 16 16"><path d="m3.5 8 3 3 6-6" /></svg>{/if}</span>
        </button>
        {#if option.value === "all" && options.length > 1}<div class="picker-divider" role="presentation"></div>{/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .provider-picker { flex: 1; min-width: 0; }
  button { color: inherit; font: inherit; cursor: pointer; }
  svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
  .provider-trigger { display: flex; align-items: center; gap: 5px; width: 100%; min-height: 22px; padding: 2px 3px 2px 0; border: 0; border-radius: 4px; background: transparent; text-align: left; font-size: var(--font-size-compact); font-weight: 600; }
  .provider-trigger > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .provider-trigger > svg { flex: none; color: var(--frost-muted); }
  .provider-trigger > svg.rotated { transform: rotate(180deg); }
  .provider-trigger:hover:not(:disabled), .provider-trigger.active { background: var(--frost-hover); }
  .provider-trigger:disabled { cursor: default; }
  /* The positioned Panel header anchors the menu across its full content width. */
  .provider-menu { position: absolute; z-index: 1; top: calc(100% + 6px); left: 0; right: 0; overflow: auto; overscroll-behavior: contain; padding: 4px; border: 1px solid var(--frost-border); border-radius: 7px; background: var(--frost-surface-raised); box-shadow: var(--frost-shadow); font-size: var(--font-size-detail); font-weight: 400; }
  .provider-menu.above { top: auto; bottom: calc(100% + 6px); }
  .provider-option { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 28px; padding: 5px 6px; border: 0; border-radius: 4px; background: transparent; text-align: left; }
  .provider-option:hover, .provider-option:focus-visible { background: var(--frost-hover); }
  .provider-option:focus-visible { outline-offset: -1px; }
  .option-label { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .option-status { flex: none; color: var(--frost-muted); font-size: calc(var(--font-size-ui) - 4px); }
  .option-check { flex: none; display: grid; place-items: center; width: 14px; color: var(--frost-link); }
  .picker-divider { height: 1px; margin: 4px 6px; background: var(--frost-border-soft); }
</style>
