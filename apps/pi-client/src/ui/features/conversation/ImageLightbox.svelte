<script lang="ts">
  import { onMount } from "svelte";

  let {
    src,
    alt,
    title,
    onclose,
  }: { src: string; alt: string; title: string | undefined; onclose: () => void } = $props();

  let closeButton: HTMLButtonElement;

  onMount(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.focus();
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onclose();
    };
    window.addEventListener("keydown", handleKeydown);
    return () => {
      window.removeEventListener("keydown", handleKeydown);
      previouslyFocused?.focus();
    };
  });

  function closeFromBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) onclose();
  }
</script>

<div
  class="image-lightbox"
  role="dialog"
  aria-modal="true"
  aria-label={title || alt || "Image preview"}
  tabindex="-1"
  onclick={closeFromBackdrop}
  onkeydown={(event) => event.key === "Escape" && onclose()}
>
  <button bind:this={closeButton} class="lightbox-close" type="button" aria-label="Close image" onclick={onclose}>
    <span class="codicon codicon-close" aria-hidden="true"></span>
  </button>
  <figure>
    <img {src} {alt} />
    {#if title}<figcaption>{title}</figcaption>{/if}
  </figure>
</div>

<style>
  .image-lightbox {
    position: fixed;
    z-index: 100;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgba(0,0,0,.72);
    backdrop-filter: blur(4px);
  }
  figure { max-width: 92vw; margin: 0; text-align: center; }
  img {
    display: block;
    max-width: 92vw;
    max-height: 86vh;
    margin: 0 auto;
    object-fit: contain;
    border-radius: 6px;
    box-shadow: 0 20px 60px rgba(0,0,0,.5);
  }
  figcaption { margin-top: 7px; color: white; font-size: 12px; }
  .lightbox-close {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border: 1px solid rgba(255,255,255,.24);
    border-radius: 50%;
    background: rgba(20,20,20,.75);
    color: white;
    cursor: pointer;
  }
  .lightbox-close:focus-visible { outline: 2px solid var(--frost-focus); outline-offset: 2px; }
</style>
