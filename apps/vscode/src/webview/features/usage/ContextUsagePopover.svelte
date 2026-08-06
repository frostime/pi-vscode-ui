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
        <div class="usage-heading-copy">
          <strong>Context window</strong>
          <span>{session.isCompacting ? "Compacting" : session.status}</span>
        </div>
        <strong class="usage-percent">{context?.percent == null ? "—" : `${Math.round(context.percent)}%`}</strong>
      </div>
      <div class="usage-current">
        <div class="usage-current-line">
          <span>In use</span>
          <strong>{context?.tokens == null ? "—" : compactNumber(context.tokens)} / {context ? compactNumber(context.contextWindow) : "—"}</strong>
        </div>
        <div class="usage-bar" aria-hidden="true"><span style={`width:${clamp(context?.percent ?? 0)}%`}></span></div>
      </div>
      <div class="usage-highlights">
        <div class="usage-highlight">
          <span>Cache hit</span>
          <strong>{session.cacheHitPercent === undefined ? "—" : `${Math.round(session.cacheHitPercent)}%`}</strong>
        </div>
        <div class="usage-highlight">
          <span>Cost</span>
          <strong>${stats.cost.toFixed(3)}</strong>
        </div>
      </div>
      <div class="usage-section">
        <span class="usage-section-title">Tokens</span>
        <dl class="usage-grid">
          <div class="usage-stat"><dt>Input</dt><dd>{compactNumber(stats.tokens.input)}</dd></div>
          <div class="usage-stat"><dt>Output</dt><dd>{compactNumber(stats.tokens.output)}</dd></div>
          <div class="usage-stat"><dt>Cache read</dt><dd>{compactNumber(stats.tokens.cacheRead)}</dd></div>
          <div class="usage-stat"><dt>Cache write</dt><dd>{compactNumber(stats.tokens.cacheWrite)}</dd></div>
          <div class="usage-stat usage-stat-wide"><dt>Total</dt><dd>{compactNumber(stats.tokens.total)}</dd></div>
        </dl>
      </div>
      <div class="usage-section">
        <span class="usage-section-title">Session</span>
        <dl class="usage-grid">
          <div class="usage-stat"><dt>Messages</dt><dd title={`${stats.userMessages} user · ${stats.assistantMessages} assistant`}>{stats.userMessages}u · {stats.assistantMessages}a</dd></div>
          <div class="usage-stat"><dt>Tools</dt><dd>{compactNumber(stats.toolCalls)}</dd></div>
          <div class="usage-stat usage-stat-wide"><dt>Model</dt><dd title={session.model ? `${session.model.provider}/${session.model.id}` : ""}>{modelLabel}</dd></div>
        </dl>
      </div>
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
  width: min(220px, calc(100vw - 18px));
  padding: 10px;
  border: 1px solid var(--frost-border);
  border-radius: 8px;
  background: var(--frost-surface-raised);
  color: var(--frost-text);
  box-shadow: var(--frost-shadow);
  font-size: 11px;
  line-height: 1.35;
}
.usage-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 7px;
}
.usage-heading-copy { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.usage-heading-copy > strong { font-size: 12px; font-weight: 600; }
.usage-heading-copy > span { color: var(--frost-muted); font-size: 10px; text-transform: capitalize; }
.usage-percent {
  flex: none;
  padding-top: 1px;
  color: var(--frost-text);
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.usage-current { padding-bottom: 8px; border-bottom: 1px solid var(--frost-border-soft); }
.usage-current-line { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.usage-current-line > span { color: var(--frost-muted); font-size: 10.5px; }
.usage-current-line > strong {
  color: var(--frost-text);
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.usage-bar {
  height: 4px;
  margin-top: 6px;
  overflow: hidden;
  border-radius: 99px;
  background: color-mix(in srgb, var(--frost-muted) 15%, transparent);
}
.usage-bar :global(span) { display: block; height: 100%; background: var(--frost-link); border-radius: inherit; }
.usage-highlights {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 8px 0 7px;
  border-bottom: 1px solid var(--frost-border-soft);
}
.usage-highlight { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.usage-highlight > span { color: var(--frost-muted); font-size: 10px; }
.usage-highlight > strong {
  color: var(--frost-text);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.usage-section { padding-top: 8px; }
.usage-section + .usage-section { margin-top: 7px; border-top: 1px solid var(--frost-border-soft); }
.usage-section-title {
  display: block;
  margin-bottom: 5px;
  color: var(--frost-faint);
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: .04em;
  text-transform: uppercase;
}
.usage-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px 10px; margin: 0; }
.usage-stat { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; gap: 5px; }
.usage-stat-wide { grid-column: 1 / -1; }
.usage-grid dt { min-width: 0; overflow: hidden; color: var(--frost-muted); font-size: 10.5px; text-overflow: ellipsis; white-space: nowrap; }
.usage-grid dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: color-mix(in srgb, var(--frost-text) 92%, var(--frost-muted));
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 430px) {
  .context-usage-popover { right: -4px; }
}
</style>
