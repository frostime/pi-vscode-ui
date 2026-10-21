<script lang="ts">
  import type { DraftImage } from "../../features/composer/composerDraftStore.svelte";

  let { images, onremove }: { images: DraftImage[]; onremove: (id: string) => void } = $props();
</script>

{#if images.length}
  <div class="attachment-strip">
    {#each images as image (image.id)}
      <div class="attachment-item" title={`${image.name} (${formatSize(image.size)})`}>
        <img src={image.dataUrl} alt={image.name} />
        <div class="attachment-meta"><span>{image.name}</span><small>{formatSize(image.size)}</small></div>
        <button type="button" aria-label={`Remove ${image.name}`} title={`Remove ${image.name}`} onclick={() => onremove(image.id)}><span class="codicon codicon-close"></span></button>
      </div>
    {/each}
  </div>
{/if}

<script lang="ts" module>
  function formatSize(size: number): string {
    return size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`;
  }
</script>

<style>
.attachment-strip {
  display: flex;
  gap: 5px;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  padding: 0 2px 7px;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
}
.attachment-item {
  position: relative;
  flex: 0 0 84px;
  width: 84px;
  height: 56px;
  overflow: hidden;
  background: var(--frost-surface);
  border: 1px solid var(--frost-border-soft);
  border-radius: 6px;
}
.attachment-item :global(img) { display: block; width: 100%; height: 100%; object-fit: cover; }
.attachment-meta {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 2px 4px;
  background: rgba(0, 0, 0, .62);
  color: #fff;
  line-height: 1.15;
}
.attachment-meta :global(span) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attachment-meta :global(small) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attachment-meta :global(span) { font-size: 9px; }
.attachment-meta :global(small) { color: rgba(255, 255, 255, .78); font-size: 8px; }
.attachment-item :global(button) {
  position: absolute;
  z-index: 1;
  top: 3px;
  right: 3px;
  width: 19px;
  height: 19px;
  padding: 0;
  border-radius: 4px;
  background: rgba(0, 0, 0, .58);
  color: #fff;
  cursor: pointer;
}
.attachment-item :global(button:hover) { background: rgba(0, 0, 0, .8); color: #fff; }
</style>
