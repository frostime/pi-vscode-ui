<script lang="ts">
  import { tick } from "svelte";
  import type { DesktopDialog, DesktopResumeView } from "../shared/desktopBridge.js";
  import { quickPickMatches } from "./quickPick.js";
  import VscodeLabel from "./VscodeLabel.svelte";

  let { view, picker, onrespond, onretry, ondismiss }: {
    view: DesktopResumeView;
    picker: Extract<DesktopDialog, { kind: "pick" }> | null;
    onrespond(id: string, value: string | null): void;
    onretry(): void;
    ondismiss(): void;
  } = $props();
  let input = $state("");
  let search = $state<HTMLInputElement>();
  let panel = $state<HTMLElement>();
  const items = $derived(picker?.items.filter((item) => quickPickMatches(item, input, picker)) ?? []);
  const busy = $derived(view.phase === "finding" || view.phase === "opening" || view.phase === "loading");
  const title = $derived(view.phase === "finding" ? "Looking for saved sessions"
    : view.phase === "choosing" ? "Choose a session to resume"
    : view.phase === "opening" ? "Opening saved session"
    : view.phase === "loading" ? "Loading conversation history"
    : "Could not resume the session");
  const icon = $derived(view.phase === "finding" ? "search" : view.phase === "choosing" ? "list-selection" : view.phase === "failed" ? "error" : "history");

  $effect(() => {
    const pickerId = picker?.id;
    input = "";
    void tick().then(() => {
      if (pickerId) search?.focus({ preventScroll: true });
      else panel?.focus({ preventScroll: true });
    });
  });

  /** Desktop geometry only: keep the shared tree mounted and its styles untouched. */
  function positionResumeOverlay(element: HTMLElement): { destroy(): void } {
    const root = element.parentElement!;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    let target: HTMLElement | null = null;
    let wasInert = false;
    let frame: number | undefined;
    const resize = new ResizeObserver(schedule);
    const mutation = new MutationObserver(schedule);
    resize.observe(root);
    mutation.observe(root, { childList: true, subtree: true });

    function measure(): void {
      frame = undefined;
      const expandedComposer = root.querySelector<HTMLElement>(".composer-expanded");
      const next = expandedComposer?.closest<HTMLElement>(".composer-region")
        ?? root.querySelector<HTMLElement>(".conversation-frame")
        ?? root.querySelector<HTMLElement>(".onboarding-view")
        ?? root.querySelector<HTMLElement>(".frostpi-root");
      if (target !== next) {
        if (target) { resize.unobserve(target); target.inert = wasInert; }
        target = next;
        if (target) { wasInert = target.inert; target.inert = true; resize.observe(target); }
      }
      if (!target) return;
      const bounds = target.getBoundingClientRect();
      const parent = root.getBoundingClientRect();
      element.style.left = `${bounds.left - parent.left}px`;
      element.style.top = `${bounds.top - parent.top}px`;
      element.style.width = `${bounds.width}px`;
      element.style.height = `${bounds.height}px`;
    }
    function schedule(): void { frame ??= requestAnimationFrame(measure); }
    measure();
    return { destroy: () => {
      resize.disconnect(); mutation.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (target) target.inert = wasInert;
      if (element.contains(document.activeElement) && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    } };
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      // Keep Escape inside this flow; do not collapse an expanded Composer underneath.
      event.preventDefault();
      if (picker) onrespond(picker.id, null);
      else if (view.phase === "failed") ondismiss();
      return;
    }
    if (!picker) return;
    const choices = [...(panel?.querySelectorAll<HTMLButtonElement>(".resume-choice") ?? [])];
    const current = choices.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!choices.length) return;
      event.preventDefault();
      choices[(current + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length]?.focus();
    } else if (event.key === "Enter" && event.target === search && choices[0]) {
      event.preventDefault(); choices[0].click();
    }
  }
</script>

<div class="resume-overlay" use:positionResumeOverlay>
  <div class:failed={view.phase === "failed"} class="resume-card" role="dialog" aria-labelledby="resume-title" tabindex="-1" bind:this={panel} onkeydown={keydown}>
    {#if busy}<div class="resume-activity" aria-hidden="true"><span></span></div>{/if}
    <header>
      <span class={`resume-icon codicon codicon-${icon}`} aria-hidden="true"></span>
      <div class="resume-heading" role="status" aria-live="polite">
        <h2 id="resume-title">{title}</h2>
        <p title={view.cwd}>{view.sessionTitle ?? view.project}{#if !view.sessionTitle && view.cwd}<span class="resume-path"> · {view.cwd}</span>{/if}</p>
      </div>
      {#if view.phase === "choosing"}<span class="waiting">Waiting for you</span>{/if}
    </header>
    <div class="resume-body">
      {#if view.phase === "failed"}
        <p class="resume-error">{view.error ?? "The saved session could not be opened."}</p>
        <footer><button type="button" onclick={ondismiss}>Close</button><button type="button" class="primary" onclick={onretry}>Try again</button></footer>
      {:else if picker}
        <div class="resume-search"><span class="codicon codicon-search" aria-hidden="true"></span><input bind:this={search} bind:value={input} aria-label="Search saved sessions" placeholder={picker.placeholder} /></div>
        <div class="resume-choices">
          {#each items as item (item.id)}
            {#if item.separator}<h3>{item.label}</h3>{:else}
              <button type="button" class="resume-choice" onclick={() => onrespond(picker.id, item.id)}>
                <strong><VscodeLabel label={item.label} /></strong>
                {#if item.description}<span><VscodeLabel label={item.description} /></span>{/if}
                {#if item.detail}<small><VscodeLabel label={item.detail} /></small>{/if}
              </button>
            {/if}
          {/each}
          {#if !items.some((item) => !item.separator)}<p class="empty">No sessions match this search.</p>{/if}
        </div>
        <footer class="picker-footer"><span>↑ ↓ move · Enter resume · Esc cancel</span><button type="button" onclick={() => onrespond(picker.id, null)}>Cancel</button></footer>
      {:else if view.phase === "choosing"}
        <p class="resume-detail">{view.selection === "file" ? "Choose a session file in the system dialog." : view.selection === "confirmation" ? "Complete the confirmation in the system dialog." : "Waiting for the session list…"}</p>
      {:else}
        <p class="resume-detail">{view.phase === "finding" ? "Preparing the project and scanning saved sessions…" : view.phase === "loading" ? "Pi has started. Reading the saved conversation…" : "Opening the selected session and preparing Pi…"}</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .resume-overlay { position: absolute; inset: 0 auto auto 0; z-index: 20; display: flex; align-items: center; justify-content: center; padding: 18px; background: color-mix(in srgb, var(--frost-bg) 58%, transparent); backdrop-filter: blur(2px); font: var(--font-size) var(--font-ui); color: var(--frost-text); }
  .resume-card { position: relative; width: 100%; max-width: 580px; max-height: 100%; min-height: 0; overflow: auto; padding: 16px; border: 1px solid var(--frost-border); border-radius: 10px; background: var(--frost-surface-raised); box-shadow: 0 1px 3px #0003; animation: resume-in 150ms ease-out; }
  .resume-card:focus { outline: none; }
  .resume-card:focus-visible { outline: 1px solid var(--frost-focus); outline-offset: 2px; }
  header { display: flex; align-items: flex-start; gap: 12px; }
  .resume-icon { flex: none; margin-top: 3px; color: var(--frost-link); font-size: 17px; }
  .failed .resume-icon { color: var(--frost-error); }
  .resume-heading { flex: 1; min-width: 0; }
  h2 { margin: 0; font-size: 13px; line-height: 1.5; font-weight: 600; overflow-wrap: anywhere; }
  .resume-heading p { margin: 4px 0 0; color: var(--frost-muted); font-size: 11.5px; overflow-wrap: anywhere; }
  .resume-path { font-family: var(--font-mono); font-size: 10.5px; }
  .waiting { flex: none; padding-top: 3px; color: var(--frost-muted); font-size: 10.5px; }
  .waiting::before { content: ""; display: inline-block; width: 5px; height: 5px; margin-right: 5px; border: 1px solid currentColor; border-radius: 50%; }
  .resume-body { margin: 18px 0 0 29px; }
  .resume-detail, .resume-error { margin: 0; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
  .resume-detail { color: var(--frost-muted); }
  .resume-activity { position: absolute; inset: 0 0 auto; height: 2px; overflow: hidden; }
  .resume-activity span { position: absolute; height: 100%; width: 25%; background: var(--frost-link); opacity: .75; animation: resume-scan 1.6s ease-in-out infinite; }
  .resume-search { display: flex; align-items: center; gap: 7px; padding: 7px 9px; border: 1px solid var(--frost-input-border); border-radius: 5px; background: var(--frost-input-bg); color: var(--frost-muted); }
  .resume-search:focus-within { border-color: var(--frost-focus); }
  input { width: 100%; min-width: 0; padding: 0; border: 0; background: transparent; color: var(--frost-text); font: inherit; font-size: 12px; outline: none; }
  .resume-choices { max-height: min(38vh, 300px); overflow: auto; margin-top: 8px; }
  h3 { margin: 14px 0 4px; color: var(--frost-muted); font-size: 10.5px; font-weight: 500; overflow-wrap: anywhere; }
  button { color: var(--frost-text); font: inherit; cursor: pointer; }
  .resume-choice { display: grid; gap: 4px; width: 100%; padding: 9px 8px; border: 0; border-radius: 5px; background: transparent; text-align: left; overflow-wrap: anywhere; }
  .resume-choice:hover { background: var(--frost-hover); }
  .resume-choice strong { font-size: 12px; font-weight: 500; }
  .resume-choice span, .resume-choice small { color: var(--frost-muted); font-size: 10.5px; }
  .resume-choice small { display: -webkit-box; line-clamp: 2; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  button:focus-visible { outline: 1px solid var(--frost-focus); outline-offset: -1px; }
  .empty { color: var(--frost-muted); font-size: 12px; }
  footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 14px; }
  footer button { flex: none; padding: 5px 10px; border: 1px solid var(--frost-border); border-radius: 5px; background: var(--frost-secondary-bg); font-size: 11.5px; }
  footer button:hover { background: var(--frost-secondary-hover); }
  footer .primary { color: var(--frost-accent-text); background: var(--frost-accent); }
  .picker-footer { justify-content: space-between; }
  .picker-footer > span { color: var(--frost-muted); font-size: 10px; }
  @keyframes resume-in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
  @keyframes resume-scan { from { transform: translateX(-100%); } to { transform: translateX(400%); } }
  @media (prefers-reduced-motion: reduce) { .resume-card, .resume-activity span { animation: none; } }
  @media (max-width: 600px) { .resume-overlay { padding: 12px; } .resume-card { padding: 14px 12px; } .resume-body { margin-left: 0; } header { flex-wrap: wrap; } .waiting { flex: 1 0 calc(100% - 29px); margin-left: 29px; } .picker-footer > span { display: none; } .picker-footer { justify-content: flex-end; } }
</style>
