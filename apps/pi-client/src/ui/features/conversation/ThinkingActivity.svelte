<script lang="ts">
  import { Collapsible } from "bits-ui";
  import type { ReasoningActivityView } from "$shared/model/conversationModel";

  import MarkdownContent from "./MarkdownContent.svelte";
  import { reasoningPreview } from "./reasoningPreview";

  let { activity, open = $bindable(false) }: { activity: ReasoningActivityView; open?: boolean } = $props();
  const preview = $derived(reasoningPreview(activity.text, activity.status === "streaming"));
</script>

<Collapsible.Root bind:open class="activity-row reasoning-activity">
  <Collapsible.Trigger class="activity-trigger reasoning-trigger">
    <span class="codicon codicon-lightbulb activity-leading" aria-hidden="true"></span>
    <span class="activity-title">{activity.status === "streaming" ? "Thinking" : "Reasoning"}</span>
    {#if preview && !open}<span class="reasoning-preview" title={preview}>{preview}</span>{/if}
    {#if activity.status === "streaming"}<span class="thinking-pulse"></span>{/if}
    <span class={`codicon codicon-chevron-${open ? "down" : "right"} activity-chevron`} aria-hidden="true"></span>
  </Collapsible.Trigger>
  <Collapsible.Content class="activity-content reasoning-content">
    <MarkdownContent content={activity.text} />
  </Collapsible.Content>
</Collapsible.Root>

<style>
.reasoning-content { color: var(--frost-muted); font-size: 11.5px; }
/* Same one-line treatment as a tool row's target. */
.reasoning-preview {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--frost-muted);
  font-size: calc(var(--font-size-ui) - 2.5px);
  font-style: italic;
}
.reasoning-content :global(.markdown-body) { color: inherit; }
</style>
