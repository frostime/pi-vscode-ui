<script lang="ts">
  import type { SessionViewModel } from "$shared/model/sessionViewModel";

  let { session }: { session: SessionViewModel } = $props();
  let open = $state(false);
  let closeTimer: number | undefined;

  const stats = $derived(session.stats);
  const context = $derived(stats?.contextUsage);
  const modelLabel = $derived(session.model ? `${session.model.name ?? session.model.id}` : "—");

  function show(): void {
    if (closeTimer) window.clearTimeout(closeTimer);
    open = true;
  }

  function scheduleClose(): void {
    closeTimer = window.setTimeout(() => { open = false; }, 120);
  }
</script>

<div class="context-usage-wrap" role="presentation" onmouseenter={show} onmouseleave={scheduleClose}>
  <button class="context-usage-trigger" type="button" aria-expanded={open} onfocus={show} onblur={scheduleClose}>
    Context {context?.percent === null || context?.percent === undefined ? "—" : `${Math.round(context.percent)}%`}
  </button>
  {#if open && stats}
    <div class="context-usage-popover" role="dialog" tabindex="-1" aria-label="Context and session usage" onmouseenter={show} onmouseleave={scheduleClose}>
      <div class="usage-heading">
        <strong>Context</strong>
        <span>{session.isCompacting ? "Compacting" : session.status}</span>
      </div>
      <div class="usage-current">
        <div>
          <span>In use</span>
          <strong>{context?.tokens == null ? "—" : compactNumber(context.tokens)} / {context ? compactNumber(context.contextWindow) : "—"}</strong>
        </div>
        <div class="usage-bar" aria-hidden="true"><span style={`width:${clamp(context?.percent ?? 0)}%`}></span></div>
      </div>
      <dl class="usage-grid">
        <dt>Input</dt><dd>{compactNumber(stats.tokens.input)}</dd>
        <dt>Output</dt><dd>{compactNumber(stats.tokens.output)}</dd>
        <dt>Cache hit</dt><dd>{session.cacheHitPercent === undefined ? "—" : `${Math.round(session.cacheHitPercent)}%`}</dd>
        <dt>Cache read</dt><dd>{compactNumber(stats.tokens.cacheRead)}</dd>
        <dt>Cache write</dt><dd>{compactNumber(stats.tokens.cacheWrite)}</dd>
        <dt>Total</dt><dd>{compactNumber(stats.tokens.total)}</dd>
        <dt>Messages</dt><dd title={`${stats.userMessages} user · ${stats.assistantMessages} assistant`}>{stats.userMessages}u · {stats.assistantMessages}a</dd>
        <dt>Tools</dt><dd>{compactNumber(stats.toolCalls)}</dd>
        <dt>Cost</dt><dd>${stats.cost.toFixed(3)}</dd>
        <dt>Model</dt><dd title={session.model ? `${session.model.provider}/${session.model.id}` : ""}>{modelLabel}</dd>
      </dl>
    </div>
  {/if}
</div>

<script lang="ts" module>
  const full = new Intl.NumberFormat();
  const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

  function compactNumber(value: number): string {
    if (!Number.isFinite(value)) return "—";
    // Keep exact values for small counts; compress large token totals that force width.
    return Math.abs(value) >= 10_000 ? compact.format(value) : full.format(value);
  }

  function clamp(value: number): number {
    return Math.max(0, Math.min(100, value));
  }
</script>

<style>
.context-usage-wrap { position: relative; }
.context-usage-trigger {
  padding: 1px 3px;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  cursor: default;
  font-size: inherit;
}
.context-usage-trigger:hover { color: var(--frost-text); background: var(--frost-hover); }
.context-usage-trigger:focus-visible { color: var(--frost-text); background: var(--frost-hover); }
.context-usage-popover {
  position: absolute;
  z-index: 70;
  right: 0;
  bottom: calc(100% + 6px);
  width: min(200px, calc(100vw - 18px));
  padding: 8px 9px 7px;
  border: 1px solid var(--frost-border);
  border-radius: 8px;
  background: var(--frost-surface-raised);
  color: var(--frost-text);
  box-shadow: var(--frost-shadow);
  font-size: 10px;
  line-height: 1.3;
}
.usage-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.usage-current > :global(div:first-child) { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.usage-heading { margin-bottom: 6px; }
.usage-heading :global(strong) { font-size: 10.5px; font-weight: 600; }
.usage-heading :global(span) { color: var(--frost-muted); font-size: 9.5px; text-transform: capitalize; }
.usage-current { padding-bottom: 7px; border-bottom: 1px solid var(--frost-border-soft); }
.usage-current > :global(div:first-child > span) { color: var(--frost-muted); }
.usage-current :global(strong) { font-family: var(--font-mono); font-size: 9.5px; font-weight: 500; font-variant-numeric: tabular-nums; }
.usage-bar {
  height: 3px;
  margin-top: 5px;
  overflow: hidden;
  border-radius: 99px;
  background: color-mix(in srgb, var(--frost-muted) 15%, transparent);
}
.usage-bar :global(span) { display: block; height: 100%; background: var(--frost-link); border-radius: inherit; }
.usage-grid { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 3px 10px; margin: 6px 0 0; }
.usage-grid :global(dt) { color: var(--frost-muted); font-size: 9.5px; }
.usage-grid :global(dd) {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  color: color-mix(in srgb, var(--frost-text) 92%, var(--frost-muted));
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 430px) {
  .context-usage-popover { right: -4px; }
}
</style>
