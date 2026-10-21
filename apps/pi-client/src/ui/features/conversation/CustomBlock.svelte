<script lang="ts">
  import type { CustomMessageView } from "$shared/model/conversationModel";

  import ImageGallery from "./ImageGallery.svelte";
  import MarkdownContent from "./MarkdownContent.svelte";

  let { message }: { message: CustomMessageView } = $props();
  let expanded = $state(false);
</script>

<section class="custom-message-block">
  <button
    class="custom-message-trigger"
    type="button"
    aria-expanded={expanded}
    aria-label={`${expanded ? "Collapse" : "Expand"} custom message from ${message.customType}`}
    onclick={() => expanded = !expanded}
  >
    <span class="codicon codicon-extensions" aria-hidden="true"></span>
    <span class="custom-message-type">{message.customType}</span>
    <span class="custom-message-label">Custom message</span>
    <span class={`codicon codicon-chevron-${expanded ? "down" : "right"}`} aria-hidden="true"></span>
  </button>
  {#if expanded}
    <div class="custom-message-content">
      {#each message.blocks as block, index (index)}
        {#if block.type === "text"}<MarkdownContent content={block.text} />{/if}
        {#if block.type === "images"}<ImageGallery images={block.images} />{/if}
        {#if block.type === "error"}<div class="inline-error">{block.text}</div>{/if}
      {/each}
    </div>
  {/if}
</section>

<style>
.custom-message-block {
  margin: 5px 0 16px;
  overflow: hidden;
  border: 1px solid var(--frost-border-soft);
  border-radius: 7px;
  background: color-mix(in srgb, var(--frost-surface) 56%, transparent);
}
.custom-message-trigger {
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
.custom-message-trigger:hover { color: var(--frost-text); background: var(--frost-hover); }
.custom-message-trigger > :global(.codicon:first-child) { color: var(--frost-link); }
.custom-message-type { color: var(--frost-text); font-size: 11px; font-weight: 600; }
.custom-message-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10.5px; }
.custom-message-content {
  padding: 8px 10px 10px 31px;
  border-top: 1px solid var(--frost-border-soft);
  color: var(--frost-muted);
  font-size: 11.5px;
}
.custom-message-content :global(.markdown-body > :first-child) { margin-top: 0; }
.custom-message-content :global(.markdown-body > :last-child) { margin-bottom: 0; }
</style>
