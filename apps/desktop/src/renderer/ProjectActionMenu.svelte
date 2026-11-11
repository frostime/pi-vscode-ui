<script lang="ts">
  import { onMount } from "svelte";
  import type { DesktopProjectActionView } from "../shared/desktopBridge.js";

  const MENU_GAP = 4;
  const VIEWPORT_MARGIN = 8;
  const ITEM_SELECTOR = '[role="menuitem"]';

  let {
    anchor,
    projectName,
    actions,
    showActions = false,
    onconfigure,
    onaction,
    onremove,
    onclose,
  }: {
    anchor: HTMLElement;
    projectName: string;
    actions: DesktopProjectActionView[];
    showActions?: boolean;
    onconfigure: () => void;
    onaction: (id: string) => void;
    onremove: () => void;
    onclose: () => void;
  } = $props();

  let menuElement = $state<HTMLDivElement | null>(null);
  let placement = $state({ left: 0, top: 0 });
  const openInActions = $derived(actions.filter((action) => action.section !== "actions"));
  const commandActions = $derived(actions.filter((action) => action.section === "actions"));

  // The anchor sits in the scrolling `.project-list`, so a CSS popover would be
  // clipped by that container. The menu is mounted at shell level and placed
  // from measured geometry: right edge on the anchor, below it, flipped up when
  // it would leave the viewport, and clamped horizontally.
  function placementFor(rect: DOMRect, width: number, height: number): { left: number; top: number } {
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.right - width, window.innerWidth - width - VIEWPORT_MARGIN),
    );
    const below = rect.bottom + MENU_GAP;
    const overflowsBelow = below + height > window.innerHeight - VIEWPORT_MARGIN;
    const top = overflowsBelow ? Math.max(VIEWPORT_MARGIN, rect.top - height - MENU_GAP) : below;
    return { left, top };
  }

  function items(): HTMLElement[] {
    return menuElement ? [...menuElement.querySelectorAll<HTMLElement>(ITEM_SELECTOR)] : [];
  }

  function cycleFocus(offset: number): void {
    const entries = items();
    if (entries.length === 0) return;
    const current = entries.indexOf(document.activeElement as HTMLElement);
    entries[(current + offset + entries.length) % entries.length]?.focus();
  }

  /** Escape restores the trigger; pointer and resize dismissals do not. Item
   * activation is reported to the shell, which closes the menu and focuses the
   * trigger before running the callback. */
  function close(restoreFocus: boolean): void {
    if (restoreFocus) anchor.focus();
    onclose();
  }

  function menuKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      close(true);
      return;
    }
    const offset = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (offset === 0 || !menuElement?.contains(document.activeElement)) return;
    event.preventDefault();
    cycleFocus(offset);
  }

  onMount(() => {
    if (menuElement) {
      placement = placementFor(anchor.getBoundingClientRect(), menuElement.offsetWidth, menuElement.offsetHeight);
      items()[0]?.focus();
    }
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      // The anchor toggles the menu itself; it closes through its own click.
      if (menuElement?.contains(target) || anchor.contains(target)) return;
      close(false);
    };
    // A scrolled row list would otherwise leave the fixed menu pointing at another Project.
    const dismissOnScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && menuElement?.contains(target)) return;
      close(false);
    };
    const dismissOnResize = () => close(false);
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("scroll", dismissOnScroll, true);
    window.addEventListener("keydown", menuKeyDown, true);
    window.addEventListener("resize", dismissOnResize);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("scroll", dismissOnScroll, true);
      window.removeEventListener("keydown", menuKeyDown, true);
      window.removeEventListener("resize", dismissOnResize);
    };
  });
</script>

<div
  class="project-menu"
  role="menu"
  aria-label={`Actions for ${projectName}`}
  bind:this={menuElement}
  style={`left: ${placement.left}px; top: ${placement.top}px`}
>
  <div class="menu-heading">Open In</div>
  {#each openInActions as action (action.id)}
    <button type="button" class="menu-item" role="menuitem" onclick={() => onaction(action.id)}>
      <span class={`codicon ${action.icon}`} aria-hidden="true"></span>
      <span class="menu-label">{action.label}</span>
    </button>
  {/each}
  {#if showActions}
    <div class="menu-separator" role="separator"></div>
    <div class="menu-heading"><span>Actions</span>
      <button type="button" class="configure" role="menuitem" aria-label="Configure Actions" title="Configure Actions" onclick={onconfigure}>
        <span class="codicon codicon-settings-gear" aria-hidden="true"></span>
      </button>
    </div>
    {#each commandActions as action (action.id)}
      <button type="button" class="menu-item" role="menuitem" aria-label={`${action.label} (${action.scope === "project" ? "Project" : "Global"})`} onclick={() => onaction(action.id)}>
        <span class={`codicon codicon-${action.scope === "project" ? "folder" : "globe"}`} aria-hidden="true"></span>
        <span class="menu-label">{action.label}</span>
      </button>
    {/each}
  {/if}
  <div class="menu-separator" role="separator"></div>
  <button type="button" class="menu-item danger" role="menuitem" onclick={onremove}>
    <span class="codicon codicon-trash" aria-hidden="true"></span>
    <span class="menu-label">Remove Project</span>
  </button>
</div>

<style>
  .project-menu {
    position: fixed; z-index: 100; min-width: 214px; max-width: min(300px, calc(100vw - 16px));
    display: flex; flex-direction: column; padding: 4px;
    max-height: calc(100dvh - 16px); overflow-y: auto;
    border: 1px solid var(--frost-border); border-radius: 6px;
    background: var(--frost-surface-raised); box-shadow: var(--frost-shadow);
    font-family: var(--font-ui); font-size: calc(var(--font-size-ui) - 1.5px);
  }
  .menu-heading { display: flex; align-items: center; justify-content: space-between; min-height: 24px; padding: 2px 8px; color: var(--frost-muted); font-size: var(--font-size-detail); }
  .configure { display: inline-flex; padding: 3px; border: 0; border-radius: 3px; background: transparent; color: var(--frost-muted); cursor: pointer; }
  .configure:hover { background: var(--frost-hover); color: var(--frost-text); }
  .configure:focus-visible { outline: 1px solid var(--frost-focus); outline-offset: 1px; }
  .configure .codicon { font-size: 13px; }
  .menu-item {
    width: 100%; display: flex; align-items: center; gap: 7px; padding: 5px 8px;
    border-radius: 4px; background: transparent; color: var(--frost-text);
    font-size: calc(var(--font-size-ui) - 1.5px); text-align: left; cursor: pointer;
  }
  .menu-item:hover { background: var(--frost-hover); }
  .menu-item:focus-visible { outline: 1px solid var(--frost-focus); outline-offset: -1px; background: var(--frost-hover); }
  .menu-item > .codicon { flex: none; width: 14px; font-size: 14px; color: var(--frost-muted); }
  .menu-label { min-width: 0; overflow-wrap: anywhere; }
  .menu-item.danger { color: var(--frost-error); }
  .menu-item.danger > .codicon { color: var(--frost-error); }
  .menu-item.danger:hover, .menu-item.danger:focus-visible { background: color-mix(in srgb, var(--frost-error) 16%, transparent); }
  .menu-separator { height: 1px; margin: 4px 2px; background: var(--frost-border-soft); }
</style>
