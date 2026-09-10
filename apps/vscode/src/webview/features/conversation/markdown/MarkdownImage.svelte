<script lang="ts">
  import type { MarkdownImageFailureReason, MarkdownImageLoadResult } from "$shared/bridge/hostToWebview";
  import { onDestroy, onMount } from "svelte";

  import ImageLightbox from "../ImageLightbox.svelte";
  import { currentMarkdownImageByteLimit, loadLocalMarkdownImage } from "./markdownImageClient";
  import { markdownImageCaption } from "./markdownImageCaption";
  import { sanitizeMarkdownSvg } from "./sanitizeMarkdownSvg";

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
  let imageWidth = $state<number | undefined>();
  let imageHeight = $state<number | undefined>();
  let error = $state<string | null>(null);
  let svgWarning = $state(false);
  let previewOpen = $state(false);
  let ownedObjectUrl: string | null = null;
  let disposed = false;

  const remote = $derived(remoteHttpsUrl(source));
  const label = $derived(title || alt || "Markdown image");
  const caption = $derived(markdownImageCaption(title, alt));
  const sourceLabel = $derived(remote?.hostname ?? "Local image");
  const aspectRatio = $derived(imageWidth && imageHeight ? `${imageWidth} / ${imageHeight}` : undefined);

  onMount(() => {
    if (remote) return;
    if (!isLoadableLocalSource(source)) {
      fail("Unsupported image source");
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      void loadLocalOrDataImage();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void loadLocalOrDataImage();
    }, { rootMargin: "320px" });
    observer.observe(root);
    return () => observer.disconnect();
  });

  onDestroy(() => {
    disposed = true;
    if (ownedObjectUrl) URL.revokeObjectURL(ownedObjectUrl);
  });

  async function loadLocalOrDataImage(): Promise<void> {
    if (phase !== "waiting") return;
    phase = "loading";
    try {
      const dataImage = decodeDataImage(source);
      if (dataImage) {
        if (dataImage.bytes.byteLength > currentMarkdownImageByteLimit()) {
          fail("Image exceeds the configured size limit");
          return;
        }
        await displayBytes(dataImage.mimeType, dataImage.bytes);
        return;
      }
      if (/^data:/i.test(source)) {
        fail("Unsupported data image");
        return;
      }
      const result = await loadLocalMarkdownImage(source);
      if (disposed) return;
      if (!result.ok) {
        fail(failureMessage(result.reason));
        return;
      }
      imageWidth = result.width;
      imageHeight = result.height;
      await displayBytes(result.mimeType, decodeBase64(result.data));
    } catch {
      if (!disposed) fail("Unable to load image");
    }
  }

  function loadRemoteImage(): void {
    if (!remote || phase !== "waiting") return;
    phase = "loading";
    imageUrl = remote.href;
  }

  async function displayBytes(mimeType: string, bytes: Uint8Array): Promise<void> {
    let blob: Blob;
    if (mimeType === "image/svg+xml") {
      const sanitized = sanitizeMarkdownSvg(new TextDecoder().decode(bytes));
      if (!sanitized.ok) {
        fail("This SVG has no safe renderable content");
        return;
      }
      svgWarning = sanitized.removedUnsafeContent;
      blob = new Blob([sanitized.svg], { type: mimeType });
    } else if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mimeType)) {
      blob = new Blob([Uint8Array.from(bytes).buffer], { type: mimeType });
    } else {
      fail("Unsupported image type");
      return;
    }
    if (disposed) return;
    ownedObjectUrl = URL.createObjectURL(blob);
    imageUrl = ownedObjectUrl;
  }

  function imageLoaded(event: Event): void {
    const image = event.currentTarget as HTMLImageElement;
    if (!safeDecodedDimensions(image.naturalWidth, image.naturalHeight)) {
      imageUrl = null;
      fail("Image dimensions exceed the display limit");
      return;
    }
    imageWidth ??= image.naturalWidth;
    imageHeight ??= image.naturalHeight;
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

  function failureMessage(reason: MarkdownImageFailureReason): string {
    const messages: Record<MarkdownImageFailureReason, string> = {
      invalidSource: "Unsupported local image path",
      notFound: "Local image not found",
      notAFile: "Image source is not a file",
      tooLarge: "Image exceeds the configured size limit",
      unsupportedType: "Unsupported image type",
      invalidDimensions: "Image dimensions exceed the safety limit",
      readFailed: "Unable to read local image",
    };
    return messages[reason];
  }

  function remoteHttpsUrl(value: string): URL | null {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url : null;
    } catch {
      return null;
    }
  }

  function isLoadableLocalSource(value: string): boolean {
    if (/^data:/i.test(value)) return decodeDataImage(value) !== null;
    if (value.length > 32_768) return false;
    if (/^file:/i.test(value)) return true;
    return !/^[a-z][a-z\d+.-]*:/i.test(value) || /^[a-z]:[\\/]/i.test(value);
  }

  function decodeDataImage(value: string): { mimeType: string; bytes: Uint8Array } | null {
    const match = value.match(/^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,([a-z\d+/=\s]+)$/i);
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

  function safeDecodedDimensions(width: number, height: number): boolean {
    return width > 0 && height > 0 && width <= 16_384 && height <= 16_384 && width * height <= 40_000_000;
  }
</script>

<span class="markdown-image" bind:this={root}>
  {#if imageUrl}
    <span class="loaded-image" style:aspect-ratio={aspectRatio} class:image-loading={phase === "loading"}>
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
      <span class="svg-warning" role="status"><span aria-hidden="true">⚠</span> Removed unsafe SVG content</span>
    {/if}
  {:else if remote && phase === "waiting"}
    <span class="image-placeholder remote-placeholder">
      <span class="placeholder-icon codicon codicon-file-media" aria-hidden="true"></span>
      <span class="placeholder-copy"><strong>{label}</strong><small>{sourceLabel}</small></span>
      <button
        type="button"
        onclick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          loadRemoteImage();
        }}
      >Load image</button>
    </span>
  {:else if phase === "loading"}
    <span class="image-placeholder" role="status">
      <span class="placeholder-icon codicon codicon-loading codicon-modifier-spin" aria-hidden="true"></span>
      <span class="placeholder-copy"><strong>{label}</strong><small>Loading local image…</small></span>
    </span>
  {:else if phase === "failed"}
    <span class="image-placeholder image-failed" role="status">
      <span class="placeholder-icon codicon codicon-warning" aria-hidden="true"></span>
      <span class="placeholder-copy"><strong>{label}</strong><small>{error}</small></span>
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
  .loaded-image { position: relative; display: block; width: fit-content; max-width: 100%; }
  .image-trigger { display: block; width: fit-content; max-width: 100%; cursor: zoom-in; border-radius: 7px; }
  .image-trigger:focus-visible { outline: 2px solid var(--frost-focus); outline-offset: 2px; }
  img { display: block; width: auto; height: auto; max-width: 100%; max-height: min(480px, 60vh); object-fit: contain; border-radius: 7px; }
  .image-loading img { opacity: .45; }
  .loading-label { position: absolute; inset: 0; display: grid; place-items: center; color: var(--frost-muted); font-size: 11px; }
  .image-caption { align-self: stretch; padding: 5px 4px 0; color: var(--frost-faint); font-size: 11.5px; text-align: center; }
  .svg-warning { display: flex; gap: 6px; align-items: flex-start; margin-top: 5px; padding: 5px 8px; border-radius: 5px; background: color-mix(in srgb, var(--frost-warning) 7%, transparent); color: color-mix(in srgb, var(--frost-warning) 82%, var(--frost-text)); font-size: 10.5px; }
  .image-placeholder { width: min(390px, 100%); min-height: 76px; display: grid; grid-template-columns: 32px minmax(0,1fr); align-items: center; gap: 9px; padding: 10px; border: 1px dashed var(--frost-border); border-radius: 7px; background: color-mix(in srgb, var(--frost-surface) 45%, var(--frost-bg)); }
  .remote-placeholder { grid-template-columns: 32px minmax(0,1fr) auto; }
  .placeholder-icon { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 6px; background: var(--frost-surface); color: var(--frost-muted); font-size: 17px; }
  .placeholder-copy { min-width: 0; display: flex; flex-direction: column; }
  .placeholder-copy strong, .placeholder-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .placeholder-copy strong { color: var(--frost-text); font-size: 11.5px; }
  .placeholder-copy small { color: var(--frost-faint); font-size: 10.5px; }
  .image-placeholder button { padding: 4px 8px; white-space: nowrap; border: 1px solid var(--frost-border); border-radius: 5px; background: var(--frost-surface-raised); color: var(--frost-text); cursor: pointer; }
  .image-placeholder button:hover { background: var(--frost-hover); }
  .image-failed { border-style: solid; border-color: color-mix(in srgb, var(--frost-error) 34%, var(--frost-border)); }
  .image-failed .placeholder-icon { color: var(--frost-error); }
  @media (max-width: 380px) {
    .remote-placeholder { grid-template-columns: 30px minmax(0,1fr); }
    .remote-placeholder button { grid-column: 2; justify-self: start; }
  }
</style>
