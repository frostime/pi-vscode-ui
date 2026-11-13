<script lang="ts">
  import type { AgentTurnItemView, AgentTurnView } from "$shared/model/conversationModel";
  import type { SessionViewModel } from "$shared/model/sessionViewModel";

  import { formatStepGroupLabel, planTurnItems } from "./collapseTurnTrace";
  import BranchPointControl from "./BranchPointControl.svelte";
  import BranchSummaryBlock from "./BranchSummaryBlock.svelte";
  import CompactionBlock from "./CompactionBlock.svelte";
  import CustomBlock from "./CustomBlock.svelte";
  import ResponseActivity from "./ResponseActivity.svelte";
  import SessionNotice from "./SessionNotice.svelte";
  import ThinkingActivity from "./ThinkingActivity.svelte";
  import ToolActivity from "./ToolActivity.svelte";
  import TurnTiming from "./TurnTiming.svelte";
  import UserMessage from "./UserMessage.svelte";

  let { turn, session }: { turn: AgentTurnView; session: SessionViewModel } = $props();
  /** Folded runs the reader opened, by group id. */
  let openGroupIds = $state<string[]>([]);
  /**
   * Opened reasoning rows, kept here because a row is mounted again when its run folds
   * into a group as the next step starts; it must not close under the reader.
   */
  let openReasoningIds = $state<string[]>([]);

  function setReasoningOpen(id: string, open: boolean): void {
    const isOpen = openReasoningIds.includes(id);
    if (open && !isOpen) openReasoningIds = [...openReasoningIds, id];
    else if (!open && isOpen) openReasoningIds = openReasoningIds.filter((openId) => openId !== id);
  }

  const plan = $derived(planTurnItems(turn, session.collapseTurnTrace, session.focusView));

  function toggleGroup(groupId: string): void {
    openGroupIds = openGroupIds.includes(groupId)
      ? openGroupIds.filter((id) => id !== groupId)
      : [...openGroupIds, groupId];
  }

  function isItemShown(itemId: string): boolean {
    if (plan.mode === "grouped") {
      const groupId = plan.groupIdByItemId.get(itemId);
      return groupId === undefined || openGroupIds.includes(groupId);
    }
    return true;
  }
</script>

<section class="agent-turn" data-turn-id={turn.id}>
  {#if turn.userMessage}<UserMessage message={turn.userMessage} {session} />{/if}
  {#if turn.status === "running"}<TurnTiming startedAt={turn.startedAt} />{/if}
  <div class="turn-activities">
    {#each turn.items as item (item.id)}
      {#if plan.mode === "grouped"}
        {@const group = plan.groupsByFirstItemId.get(item.id)}
        {#if group}
          {@const groupOpen = openGroupIds.includes(group.id)}
          <div class="turn-trace-header turn-step-group">
            <button
              type="button"
              class="activity-trigger"
              aria-expanded={groupOpen}
              aria-label={`${groupOpen ? "Collapse" : "Expand"} ${formatStepGroupLabel(group)}: ${group.detail}`}
              onclick={() => toggleGroup(group.id)}
            >
              <span class="codicon codicon-list-tree activity-leading" aria-hidden="true"></span>
              <span class="activity-title">{group.steps} steps</span>
              {#if group.errors > 0}
                <span class="turn-step-group-errors">{group.errors === 1 ? "1 error" : `${group.errors} errors`}</span>
              {/if}
              <span class="turn-trace-meta" title={group.detail}>{group.detail}</span>
              {#if group.active}<span class="thinking-pulse" role="status" aria-label="In progress"></span>{/if}
              <span class={`codicon codicon-chevron-${groupOpen ? "down" : "right"} activity-chevron`} aria-hidden="true"></span>
            </button>
          </div>
        {/if}
      {/if}

      {#if isItemShown(item.id)}
        {#if plan.mode === "grouped" && plan.groupIdByItemId.has(item.id)}
          <div class="turn-step-group-item">{@render turnItemRow(item)}</div>
        {:else}
          {@render turnItemRow(item)}
        {/if}
      {/if}
    {/each}
  </div>
</section>

{#snippet turnItemRow(item: AgentTurnItemView)}
  {#if item.type === "reasoning"}
    <ThinkingActivity
      activity={item}
      bind:open={() => openReasoningIds.includes(item.id), (open) => setReasoningOpen(item.id, open)}
    />
  {:else if item.type === "tool"}
    <ToolActivity activity={item} />
  {:else if item.type === "response"}
    <ResponseActivity activity={item} sessionId={session.id} />
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
    font-size: calc(var(--font-size-ui) - 2.5px);
  }

  .turn-step-group-errors { flex: none; color: var(--frost-error); font-size: calc(var(--font-size-ui) - 2.5px); }

  /* An opened group keeps its steps visually attached to its summary row. */
  .turn-step-group-item {
    min-width: 0;
    margin-left: 9px;
    padding-left: 6px;
    border-left: 1px solid var(--frost-border-soft);
  }

  .agent-turn { margin: 0 0 22px; }
  .agent-turn:last-of-type { margin-bottom: 8px; }
  .agent-turn :global(.message-user) { margin-bottom: 11px; }
  .turn-activities { display: grid; gap: 2px; min-width: 0; }

  @media (max-width: 430px) {
    .agent-turn { margin-bottom: 18px; }
  }
</style>
