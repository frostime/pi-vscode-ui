<script lang="ts">
  import { transcriptUrl } from "$shared/files/transcriptUrl";
  import { onDestroy, onMount } from "svelte";

  import ImageLightbox from "../ImageLightbox.svelte";
  import { markdownImageCaption } from "./markdownImageCaption";
  import { sanitizeMarkdownSvg } from "./sanitizeMarkdownSvg";

  const UNSUPPORTED_IMAGE_TYPE = "Unsupported image type. Supported: PNG, JPEG, WebP, GIF, AVIF, BMP, SVG.";

  let {
    source,
    alt,
    title,
    linked,
  }: { source: string; alt: string; title: string | undefined; linked: boolean } = $props();

  type Phase = "waiting" | "loading" | "ready" | "failed";
  let root: HTMLSpanElement;
  let phase = $state<Phase>("waiting");
  let imageUrl = $state<string | null>(null);
  let error = $state<string | null>(null);
  let svgWarning = $state(false);
  let previewOpen = $state(false);
  let ownedObjectUrl: string | null = null;
  let disposed = false;

  const remote = $derived(transcriptUrl(source, URL));
  const label = $derived(title || alt || "Markdown image");
  const caption = $derived(markdownImageCaption(title, alt));
  const sourceLabel = $derived(remote ? `Remote image blocked · ${new URL(remote).hostname}` : "Ask Pi to read this image to preview it.");

  onMount(() => {
    if (!/^data:/i.test(source)) return;
    if (typeof IntersectionObserver === "undefined") {
      void loadInlineImage();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void loadInlineImage();
    }, { rootMargin: "320px" });
    observer.observe(root);
    return () => observer.disconnect();
  });

  onDestroy(() => {
    disposed = true;
    if (ownedObjectUrl) URL.revokeObjectURL(ownedObjectUrl);
  });

  async function loadInlineImage(): Promise<void> {
    if (phase !== "waiting") return;
    phase = "loading";
    try {
      const image = decodeDataImage(source);
      if (!image) {
        fail("Unsupported data image");
        return;
      }
      await displayBytes(image.mimeType, image.bytes);
    } catch {
      if (!disposed) fail("Unable to load image");
    }
  }

  async function displayBytes(mimeType: string, bytes: Uint8Array): Promise<void> {
    let blob: Blob;
    if (mimeType === "image/svg+xml") {
      const sanitized = sanitizeMarkdownSvg(new TextDecoder().decode(bytes));
      if (!sanitized.ok) {
        fail("Unable to parse SVG");
        return;
      }
      svgWarning = sanitized.removedScripts;
      blob = new Blob([sanitized.svg], { type: mimeType });
    } else if (["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/bmp"].includes(mimeType)) {
      blob = new Blob([Uint8Array.from(bytes).buffer], { type: mimeType });
    } else {
      fail(UNSUPPORTED_IMAGE_TYPE);
      return;
    }
    if (disposed) return;
    ownedObjectUrl = URL.createObjectURL(blob);
    imageUrl = ownedObjectUrl;
  }

  function imageLoaded(): void {
    phase = "ready";
  }

  function fail(message: string): void {
    if (ownedObjectUrl) {
      URL.revokeObjectURL(ownedObjectUrl);
      ownedObjectUrl = null;
    }
    imageUrl = null;
    phase = "failed";
    error = message;
  }

  function openPreview(): void {
    if (phase === "ready" && !linked) previewOpen = true;
  }

  function handlePreviewKey(event: KeyboardEvent): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openPreview();
  }

  function decodeDataImage(value: string): { mimeType: string; bytes: Uint8Array } | null {
    const match = value.match(/^data:(image\/(?:png|jpeg|webp|gif|avif|bmp|svg\+xml));base64,([a-z\d+/=\s]+)$/i);
    if (match) {
      try {
        return { mimeType: match[1]!.toLowerCase(), bytes: decodeBase64(match[2]!.replace(/\s/g, "")) };
      } catch {
        return null;
      }
    }
    const svg = value.match(/^data:image\/svg\+xml(?:;charset=[^,;]+)?,(.*)$/is);
    if (!svg) return null;
    try {
      return { mimeType: "image/svg+xml", bytes: new TextEncoder().encode(decodeURIComponent(svg[1]!)) };
    } catch {
      return null;
    }
  }

  function decodeBase64(value: string): Uint8Array {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

</script>

<span class="markdown-image" bind:this={root}>
  {#if imageUrl}
    <span class="loaded-image" class:image-loading={phase === "loading"}>
      {#if linked}
        <img
          src={imageUrl}
          {alt}
          title={title}
          loading="lazy"
          decoding="async"
          referrerpolicy="no-referrer"
          onload={imageLoaded}
          onerror={() => fail("Unable to load image")}
        />
      {:else}
        <span
          class="image-trigger"
          role="button"
          tabindex={phase === "ready" ? 0 : -1}
          aria-label={`Open ${label}`}
          onkeydown={handlePreviewKey}
          onclick={openPreview}
        >
          <img
            src={imageUrl}
            {alt}
            title={title}
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            onload={imageLoaded}
            onerror={() => fail("Unable to load image")}
          />
        </span>
      {/if}
      {#if phase === "loading"}<span class="loading-label" role="status">Loading image…</span>{/if}
    </span>
    {#if caption}<span class="image-caption">{caption}</span>{/if}
    {#if svgWarning}
      <span class="svg-warning" role="status"><span aria-hidden="true">⚠</span> Removed SVG scripts</span>
    {/if}
  {:else if phase === "waiting" && !/^data:/i.test(source)}
    <span class="image-placeholder">
      <span class="placeholder-icon codicon codicon-file-media" aria-hidden="true"></span>
      <span class="placeholder-copy"><strong>{label}</strong><small title={sourceLabel}>{sourceLabel}</small></span>
    </span>
  {:else if phase === "loading"}
    <span class="image-placeholder" role="status">
      <span class="placeholder-icon codicon codicon-loading codicon-modifier-spin" aria-hidden="true"></span>
      <span class="placeholder-copy"><strong>{label}</strong><small>Loading image…</small></span>
    </span>
  {:else if phase === "failed"}
    <span class="image-placeholder image-failed" role="status">
      <span class="placeholder-icon codicon codicon-warning" aria-hidden="true"></span>
      <span class="placeholder-copy"><strong>{label}</strong><small title={error}>{error}</small></span>
    </span>
  {:else}
    <span class="image-placeholder" aria-hidden="true"></span>
  {/if}
</span>

{#if previewOpen && imageUrl}
  <ImageLightbox src={imageUrl} {alt} title={caption} onclose={() => { previewOpen = false; }} />
{/if}

<style>
  .markdown-image { display: inline-flex; max-width: 100%; flex-direction: column; margin: .55em 0 .75em; vertical-align: top; }
  .loaded-image { position: relative; display: block; width: fit-content; max-width: min(92%, 640px); }
  .image-trigger { display: block; width: fit-content; max-width: 100%; cursor: zoom-in; border-radius: 7px; }
  .image-trigger:focus-visible { outline: 2px solid var(--frost-focus); outline-offset: 2px; }
  img { display: block; width: auto; height: auto; max-width: 100%; max-height: min(400px, 55vh); object-fit: contain; border-radius: 7px; }
  .image-loading img { opacity: .45; }
  .loading-label { position: absolute; inset: 0; display: grid; place-items: center; color: var(--frost-muted); font-size: var(--font-size-detail); }
  .image-caption { align-self: stretch; padding: 5px 4px 0; color: var(--frost-faint); font-size: calc(var(--font-size-ui) - 1.5px); text-align: center; }
  .svg-warning { display: flex; gap: 6px; align-items: flex-start; margin-top: 5px; padding: 5px 8px; border-radius: 5px; background: color-mix(in srgb, var(--frost-warning) 7%, transparent); color: color-mix(in srgb, var(--frost-warning) 82%, var(--frost-text)); font-size: calc(var(--font-size-ui) - 2.5px); }
  .image-placeholder { width: min(390px, 100%); min-height: 76px; display: grid; grid-template-columns: 32px minmax(0,1fr); align-items: center; gap: 9px; padding: 10px; border: 1px dashed var(--frost-border); border-radius: 7px; background: color-mix(in srgb, var(--frost-surface) 45%, var(--frost-bg)); }
  .placeholder-icon { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 6px; background: var(--frost-surface); color: var(--frost-muted); font-size: 17px; }
  .placeholder-copy { min-width: 0; display: flex; flex-direction: column; }
  .placeholder-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .placeholder-copy strong { color: var(--frost-text); font-size: calc(var(--font-size-ui) - 1.5px); }
  .placeholder-copy small { color: var(--frost-faint); font-size: calc(var(--font-size-ui) - 2.5px); overflow-wrap: anywhere; }
  .image-failed { border-style: solid; border-color: color-mix(in srgb, var(--frost-error) 34%, var(--frost-border)); }
  .image-failed .placeholder-icon { color: var(--frost-error); }
</style>
