<script lang="ts">
  import type { ResponseActivityView } from "$shared/model/conversationModel";

  import { beginAnnotationReview } from "../annotation-review/annotationReviewStore.svelte";
  import ImageGallery from "./ImageGallery.svelte";
  import MarkdownContent from "./MarkdownContent.svelte";
  import { copyMessageText, rawMessageText } from "./copyMessageClient";
  import { formatMessageTimestamp } from "./messageTimestamp";

  let { activity, sessionId }: { activity: ResponseActivityView; sessionId: string } = $props();
  const copyText = $derived(rawMessageText(activity.blocks));
  const completedAtLabel = $derived(formatMessageTimestamp(activity.timestamp));
</script>

<div class="response-activity" class:response-error={activity.status === "error"}>
  {#each activity.blocks as block, index (index)}
    {#if block.type === "text" && block.text}<MarkdownContent content={block.text} />{/if}
    {#if block.type === "images"}<ImageGallery images={block.images} />{/if}
    {#if block.type === "error"}<div class="inline-error">{block.text}</div>{/if}
  {/each}
  {#if activity.status === "aborted"}<div class="message-footnote">Stopped by user</div>{/if}
  {#if copyText && activity.status !== "streaming"}
    <div class="message-actions response-actions">
      <button type="button" aria-label="Copy assistant response" title="Copy raw response text" onclick={() => copyMessageText(activity.blocks)}>
        <span class="codicon codicon-copy" aria-hidden="true"></span>
        <span>Copy</span>
      </button>
      <button
        type="button"
        aria-label="Annotate assistant response"
        title="Annotate this response"
        onclick={() => beginAnnotationReview(sessionId, copyText)}
      >
        <span class="codicon codicon-comment-discussion" aria-hidden="true"></span>
        <span>Annotate</span>
      </button>
      {#if completedAtLabel}
        <time
          class="action-row-timestamp"
          datetime={new Date(activity.timestamp).toISOString()}
          title={new Date(activity.timestamp).toLocaleString()}
        >{completedAtLabel}</time>
      {/if}
    </div>
  {/if}
</div>

<style>
.response-activity:hover > .response-actions { opacity: 1; }
.response-activity:focus-within > .response-actions { opacity: 1; }
.message-footnote { margin-top: 6px; color: var(--frost-muted); font-size: 11px; font-style: italic; }
.response-activity { min-width: 0; padding: 4px 2px 7px; }
/* Sibling chrome crosses component instances; keep unscoped. */
:global(.response-activity + .response-activity) { padding-top: 0; }
.response-actions { justify-content: flex-start; }
/* Timestamp trails the hover row; the shared chip style lives in styles/tokens.css. */
.response-actions .action-row-timestamp { margin-left: auto; }
.response-error { color: var(--frost-error); }
</style>
