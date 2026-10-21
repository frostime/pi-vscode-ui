<script lang="ts">
  import { getCachedMermaidSvg, renderMermaidSvg } from "./mermaidRenderer";

  let { source }: { source: string } = $props();

  let status = $state<"loading" | "ready" | "error">("loading");
  let svgHtml = $state("");
  let errorText = $state<string | null>(null);
  let requestId = 0;

  $effect(() => {
    const text = source;
    const cached = getCachedMermaidSvg(text);
    if (cached) {
      svgHtml = cached;
      status = "ready";
      errorText = null;
      return;
    }

    const id = ++requestId;
    // Do not write reactive fields that this effect reads before the async work;
    // only bump the local request token and status for UI.
    status = "loading";
    errorText = null;

    void renderMermaidSvg(text).then(
      (svg) => {
        if (id !== requestId) return;
        svgHtml = svg;
        status = "ready";
      },
      (error: unknown) => {
        if (id !== requestId) return;
        status = "error";
        errorText = error instanceof Error ? error.message : "Failed to render diagram";
        svgHtml = "";
      },
    );
  });
</script>

<div class="mermaid-block" class:mermaid-error={status === "error"} aria-busy={status === "loading"}>
  {#if status === "ready" && svgHtml}
    <div class="mermaid-host">{@html svgHtml}</div>
  {:else if status === "error"}
    <div class="mermaid-fallback">
      <div class="mermaid-status">{errorText}</div>
      <pre class="hljs"><code>{source}</code></pre>
    </div>
  {:else}
    <div class="mermaid-status">Rendering diagram…</div>
  {/if}
</div>

<style>
.mermaid-block {
  margin: .65em 0 .85em;
  max-width: 100%;
  border: 1px solid var(--frost-border-soft);
  border-radius: 7px;
  background: var(--frost-code-bg);
  overflow: auto;
}
.mermaid-block.mermaid-error { border-color: var(--frost-danger, var(--frost-border)); }
.mermaid-host { padding: 10px 11px; min-width: min-content; }
.mermaid-host :global(svg) { max-width: none; height: auto; }
.mermaid-status { padding: 8px 11px; color: var(--frost-muted); font-size: 11px; }
.mermaid-fallback :global(pre) { margin: 0; border: 0; border-radius: 0; background: transparent; }
</style>
