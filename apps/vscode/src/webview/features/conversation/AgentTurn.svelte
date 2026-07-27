<script lang="ts">
  import type { AgentTurnItemView, AgentTurnView } from "$shared/model/conversationModel";
  import type { SessionViewModel } from "$shared/model/sessionViewModel";

  import { formatTraceSummaryLabel, planTurnItems } from "./collapseTurnTrace";
  import BranchPointControl from "./BranchPointControl.svelte";
  import BranchSummaryBlock from "./BranchSummaryBlock.svelte";
  import CompactionBlock from "./CompactionBlock.svelte";
  import CustomBlock from "./CustomBlock.svelte";
  import ResponseActivity from "./ResponseActivity.svelte";
  import SessionNotice from "./SessionNotice.svelte";
  import ThinkingActivity from "./ThinkingActivity.svelte";
  import ToolActivity from "./ToolActivity.svelte";
  import UserMessage from "./UserMessage.svelte";

  let { turn, session }: { turn: AgentTurnView; session: SessionViewModel } = $props();
  let traceOpen = $state(false);

  const plan = $derived(planTurnItems(turn, session.collapseTurnTrace));
  const summaryLabel = $derived(plan.mode === "collapsed" ? formatTraceSummaryLabel(plan.summary) : "");

  $effect(() => {
    if (plan.mode !== "collapsed") traceOpen = false;
  });
</script>

<section class="agent-turn" data-turn-id={turn.id}>
  {#if turn.userMessage}<UserMessage message={turn.userMessage} {session} />{/if}
  <div class="turn-activities">
    {#each turn.items as item (item.id)}
      {#if plan.mode === "collapsed" && item.id === plan.firstCollapsedItemId}
        <div class="turn-trace-header">
          <button
            type="button"
            class="activity-trigger"
            aria-expanded={traceOpen}
            aria-label={`${traceOpen ? "Collapse" : "Expand"} work trace: ${summaryLabel}`}
            onclick={() => traceOpen = !traceOpen}
          >
            <span class="codicon codicon-list-tree activity-leading" aria-hidden="true"></span>
            <span class="activity-title">{plan.stateLabel}</span>
            <span class="turn-trace-meta">{summaryLabel}</span>
            <span class={`codicon codicon-chevron-${traceOpen ? "down" : "right"} activity-chevron`} aria-hidden="true"></span>
          </button>
        </div>
      {/if}

      {#if plan.mode === "collapsed" && item.id === plan.anchorItemId}
        <button
          type="button"
          class="turn-trace-break"
          aria-label={`${traceOpen ? "Collapse" : "Expand"} work trace`}
          onclick={() => traceOpen = !traceOpen}
        >
          <span class="turn-trace-break-line" aria-hidden="true"></span>
          <span class="turn-trace-break-label">{plan.anchorLabel}</span>
          <span class="turn-trace-break-line" aria-hidden="true"></span>
        </button>
      {/if}

      {#if plan.mode !== "collapsed" || !plan.collapsedItemIds.has(item.id) || traceOpen}
        {@render turnItemRow(item)}
      {/if}
    {/each}
  </div>
</section>

{#snippet turnItemRow(item: AgentTurnItemView)}
  {#if item.type === "reasoning"}
    <ThinkingActivity activity={item} />
  {:else if item.type === "tool"}
    <ToolActivity activity={item} />
  {:else if item.type === "response"}
    <ResponseActivity activity={item} />
  {:else if item.type === "notice"}
    <SessionNotice notice={item} />
  {:else if item.type === "compaction"}
    <CompactionBlock compaction={item} />
  {:else if item.type === "branchSummary"}
    <BranchSummaryBlock summary={item} />
  {:else if item.type === "customMessage"}
    <CustomBlock message={item} />
  {:else}
    <BranchPointControl control={item} {session} />
  {/if}
{/snippet}

<style>
  .turn-trace-header {
    min-width: 0;
    border-radius: 7px;
    color: var(--frost-muted);
  }

  .turn-trace-header:hover {
    background: color-mix(in srgb, var(--frost-surface) 48%, transparent);
    color: var(--frost-text);
  }

  .turn-trace-meta {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--frost-muted);
    font-size: 10.5px;
  }

  .turn-trace-break {
    display: grid;
    grid-template-columns: minmax(12px, 1fr) auto minmax(12px, 1fr);
    align-items: center;
    gap: 8px;
    width: 100%;
    margin: 7px 2px 5px;
    padding: 3px 2px;
    min-width: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
    transition: background var(--motion-fast) ease;
  }

  .turn-trace-break:hover {
    background: color-mix(in srgb, var(--frost-surface) 48%, transparent);
  }

  .turn-trace-break:hover .turn-trace-break-line {
    background: var(--frost-border);
  }

  .turn-trace-break:hover .turn-trace-break-label {
    color: var(--frost-muted);
  }

  .turn-trace-break-line {
    height: 1px;
    background: var(--frost-border-soft);
  }

  .turn-trace-break-label {
    color: var(--frost-faint);
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    user-select: none;
  }

  .agent-turn { margin: 0 0 22px; }
  .agent-turn:last-of-type { margin-bottom: 8px; }
  .agent-turn :global(.message-user) { margin-bottom: 11px; }
  .turn-activities { display: grid; gap: 2px; min-width: 0; }

  @media (max-width: 430px) {
    .agent-turn { margin-bottom: 18px; }
  }
</style>
