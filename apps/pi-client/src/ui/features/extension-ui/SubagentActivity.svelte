<script lang="ts">
  import type { SubagentRowView, SubagentTarget } from "$shared/model/extensionUiModel";
  import { formatDurationMs } from "../conversation/collapseTurnTrace";

  let { rows, omitted, inspectable, selected, onselect, onstop }: {
    rows: SubagentRowView[];
    omitted: boolean;
    inspectable: boolean;
    selected: SubagentTarget | undefined;
    onselect(name: string, target: SubagentTarget, opener: HTMLElement): void;
    onstop?: (() => void) | undefined;
  } = $props();
  let now = $state(Date.now());
  const running = $derived(rows.some(row => row.state === "running" && row.startedAt));
  const states: Record<string, string> = {
    queued: "Queued", running: "Running", complete: "Complete", failed: "Failed",
    partial: "Partial", paused: "Paused", stopped: "Stopped", rejected: "Rejected",
  };
  const icons: Record<string, string> = {
    queued: "clock", running: "sync", complete: "check", failed: "error",
    partial: "warning", paused: "debug-pause", stopped: "debug-stop", rejected: "circle-slash",
  };

  $effect(() => {
    if (!running) return;
    const update = () => { now = Date.now(); };
    update();
    const timer = setInterval(update, 1_000);
    return () => clearInterval(timer);
  });

  function isSelected(target: SubagentTarget): boolean {
    return selected?.runId === target.runId && selected.childId === target.childId;
  }
</script>

{#if rows.length}
  <section class="workers" aria-label="Subagents">
    <header>
      <h3>Subagents</h3>
      {#if onstop}
        <button class="stop-workers" type="button" title="Choose which background workers to stop in this chat"
          onclick={onstop}>Stop workers…</button>
      {/if}
    </header>
    <ul aria-label="Worker status">
      {#each rows as row, index (`${row.target?.runId ?? row.name}:${row.target?.childId ?? ""}:${index}`)}
        {@const end = row.endedAt ?? (row.state === "running" ? now : undefined)}
        {@const duration = row.startedAt && end && end >= row.startedAt ? formatDurationMs(end - row.startedAt) : undefined}
        <li style:padding-inline-start={`${row.depth * 10}px`}>
          {#snippet summary()}
            <span class={`codicon codicon-${icons[row.state]}`} class:done={row.state === "complete"}
              class:failed={row.state === "failed" || row.state === "rejected"} aria-hidden="true"></span>
            <span class="name" title={row.name}>{row.name}</span>
            <span class="status">{states[row.state]}{duration ? ` · ${duration}` : ""}</span>
          {/snippet}
          {#if inspectable && row.target}
            {@const target = row.target}
            <button type="button" class:active={isSelected(target)} aria-expanded={isSelected(target)}
              aria-label={`View transcript for ${row.name}`}
              onclick={(event) => onselect(row.name, target, event.currentTarget)}>
              {@render summary()}
              <span class="codicon codicon-chevron-right" aria-hidden="true"></span>
            </button>
          {:else}
            <div class="summary">{@render summary()}</div>
          {/if}
        </li>
      {/each}
    </ul>
    {#if omitted}<p>Additional activity omitted by Pi</p>{/if}
  </section>
{/if}

<style>
  .workers { width: 100%; max-width: var(--content-max-width); margin: 0 auto 7px; padding: 5px 7px; display: grid; gap: 4px; min-width: 0; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  h3 { font-size: inherit; margin: 0; padding-inline: 5px; }
  .stop-workers { width: auto; padding: 2px 6px; color: var(--frost-muted); }
  .stop-workers:hover { color: inherit; }
  ul { list-style: none; margin: 0; padding: 0; max-height: 14vh; overflow: auto; }
  li + li { margin-top: 2px; }
  button, .summary { display: flex; width: 100%; min-width: 0; align-items: center; gap: 8px; padding: 4px 5px; color: inherit; text-align: start; }
  button { border: 1px solid transparent; border-radius: 4px; background: transparent; cursor: pointer; }
  button:hover, button.active { background: var(--frost-surface); }
  button:focus-visible { outline: 1px solid var(--frost-link); outline-offset: -1px; }
  .name { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .status, .codicon, p { color: var(--frost-muted); }
  .status, .codicon { flex: none; }
  .codicon.done { color: var(--frost-success); }
  .codicon.failed { color: var(--frost-error); }
  p { margin: 0; padding-inline: 5px; }
</style>
