<script lang="ts">
  import type { BranchSummaryView } from "$shared/model/conversationModel";

  import MarkdownContent from "./MarkdownContent.svelte";

  let { summary }: { summary: BranchSummaryView } = $props();
  let expanded = $state(false);
</script>

<section class="branch-summary-block">
  <button
    class="branch-summary-trigger"
    type="button"
    aria-expanded={expanded}
    aria-label={`${expanded ? "Collapse" : "Expand"} branch summary`}
    onclick={() => expanded = !expanded}
  >
    <span class="codicon codicon-list-tree" aria-hidden="true"></span>
    <span class="branch-summary-label">Branch summary</span>
    <span class="branch-summary-context">Context preserved from another path</span>
    <span class={`codicon codicon-chevron-${expanded ? "down" : "right"}`} aria-hidden="true"></span>
  </button>
  {#if expanded}
    <div class="branch-summary-content"><MarkdownContent content={summary.summary} /></div>
  {/if}
</section>

<style>
.branch-summary-block {
  margin: 5px 0 16px;
  overflow: hidden;
  border: 1px solid var(--frost-border-soft);
  border-radius: 7px;
  background: color-mix(in srgb, var(--frost-surface) 56%, transparent);
}
.branch-summary-trigger {
  width: 100%;
  min-height: 34px;
  display: grid;
  grid-template-columns: 16px auto minmax(0, 1fr) 16px;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  background: transparent;
  color: var(--frost-muted);
  cursor: pointer;
  text-align: left;
}
.branch-summary-trigger:hover { color: var(--frost-text); background: var(--frost-hover); }
.branch-summary-trigger > :global(.codicon:first-child) { color: var(--frost-link); }
.branch-summary-label { color: var(--frost-text); font-size: 11px; font-weight: 600; }
.branch-summary-context { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10.5px; }
.branch-summary-content {
  padding: 8px 10px 10px 31px;
  border-top: 1px solid var(--frost-border-soft);
  color: var(--frost-muted);
  font-size: 11.5px;
}
.branch-summary-content :global(.markdown-body > :first-child) { margin-top: 0; }
.branch-summary-content :global(.markdown-body > :last-child) { margin-bottom: 0; }
</style>
