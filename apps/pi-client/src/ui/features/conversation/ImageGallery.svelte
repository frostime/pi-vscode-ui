<script lang="ts">
  import type { ImageAttachmentView } from "$shared/model/conversationModel";

  import ImageLightbox from "./ImageLightbox.svelte";

  let { images }: { images: ImageAttachmentView[] } = $props();
  let selected = $state<ImageAttachmentView | null>(null);
</script>

<div class="image-gallery" aria-label="Image attachments">
  {#each images as image (image.id)}
    <button class="image-thumb" type="button" onclick={() => selected = image} aria-label={`Open ${image.name}`}>
      <img src={image.dataUrl} alt={image.name} />
      <span>{image.name}</span>
    </button>
  {/each}
</div>

{#if selected}
  <ImageLightbox src={selected.dataUrl} alt={selected.name} title={selected.name} onclose={() => selected = null} />
{/if}

<style>
.image-gallery { display: flex; flex-wrap: wrap; gap: 7px; margin: 7px 0 2px; }
.image-thumb {
  position: relative;
  width: 112px;
  height: 78px;
  padding: 0;
  overflow: hidden;
  background: var(--frost-bg-alt);
  border: 1px solid var(--frost-border);
  border-radius: 7px;
  cursor: zoom-in;
}
.image-thumb :global(img) { width: 100%; height: 100%; object-fit: cover; }
.image-thumb :global(span) {
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: 3px;
  padding: 2px 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 3px;
  background: rgba(0,0,0,.58);
  color: white;
  font-size: 9px;
}
</style>
