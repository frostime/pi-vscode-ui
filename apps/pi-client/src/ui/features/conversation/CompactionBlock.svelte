<script lang="ts">
  import type { CompactionView } from "$shared/model/conversationModel";

  import MarkdownContent from "./MarkdownContent.svelte";

  let { compaction }: { compaction: CompactionView } = $props();
  let expanded = $state(false);
</script>

<section class="compaction-block">
  <button
    class="compaction-trigger"
    type="button"
    aria-expanded={expanded}
    aria-label={`${expanded ? "Collapse" : "Expand"} compaction summary from ${compaction.tokensBefore.toLocaleString()} tokens`}
    onclick={() => expanded = !expanded}
  >
    <span class="codicon codicon-fold" aria-hidden="true"></span>
    <span class="compaction-label">Compaction</span>
    <span class="compaction-tokens">Compacted from {compaction.tokensBefore.toLocaleString()} tokens</span>
    <span class={`codicon codicon-chevron-${expanded ? "down" : "right"}`} aria-hidden="true"></span>
  </button>
  {#if expanded}
    <div class="compaction-summary"><MarkdownContent content={compaction.summary} /></div>
  {/if}
</section>

<style>
.compaction-block {
  margin: 5px 0 16px;
  overflow: hidden;
  border: 1px solid var(--frost-border-soft);
  border-radius: 7px;
  background: color-mix(in srgb, var(--frost-surface) 56%, transparent);
}
.compaction-trigger {
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
.compaction-trigger:hover { color: var(--frost-text); background: var(--frost-hover); }
.compaction-trigger > :global(.codicon:first-child) { color: var(--frost-link); }
.compaction-label { color: var(--frost-text); font-size: 11px; font-weight: 600; }
.compaction-tokens { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10.5px; }
.compaction-summary {
  padding: 8px 10px 10px 31px;
  border-top: 1px solid var(--frost-border-soft);
  color: var(--frost-muted);
  font-size: 11.5px;
}
.compaction-summary :global(.markdown-body > :first-child) { margin-top: 0; }
.compaction-summary :global(.markdown-body > :last-child) { margin-bottom: 0; }
</style>
