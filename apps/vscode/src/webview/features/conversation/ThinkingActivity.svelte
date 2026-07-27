<script lang="ts">
  import { Collapsible } from "bits-ui";
  import type { ReasoningActivityView } from "$shared/model/conversationModel";

  import MarkdownContent from "./MarkdownContent.svelte";

  let { activity }: { activity: ReasoningActivityView } = $props();
  let open = $state(false);
</script>

<Collapsible.Root bind:open class="activity-row reasoning-activity">
  <Collapsible.Trigger class="activity-trigger reasoning-trigger">
    <span class="codicon codicon-lightbulb activity-leading" aria-hidden="true"></span>
    <span class="activity-title">{activity.status === "streaming" ? "Thinking" : "Reasoning"}</span>
    {#if activity.status === "streaming"}<span class="thinking-pulse"></span>{/if}
    <span class={`codicon codicon-chevron-${open ? "down" : "right"} activity-chevron`} aria-hidden="true"></span>
  </Collapsible.Trigger>
  <Collapsible.Content class="activity-content reasoning-content">
    <MarkdownContent content={activity.text} />
  </Collapsible.Content>
</Collapsible.Root>

<style>
.reasoning-content { color: var(--frost-muted); font-size: 11.5px; }
.reasoning-content :global(.markdown-body) { color: inherit; }
</style>
