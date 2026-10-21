<script lang="ts">
  import type { ExtensionWidgetView } from "$shared/model/extensionUiModel";
  let { widgets }: { widgets: ExtensionWidgetView[] } = $props();
</script>

{#if widgets.length}
  <div class="extension-widgets">
    {#each widgets as widget (widget.key)}
      <div class="extension-widget">
        <span class="codicon codicon-extensions"></span>
        <pre>{widget.lines.join("\n")}</pre>
      </div>
    {/each}
  </div>
{/if}

<style>
.extension-widgets { width: 100%; max-width: var(--content-max-width); margin: 0 auto 7px; display: grid; gap: 6px; }
.extension-widget {
  display: flex;
  gap: 7px;
  padding: 6px 8px;
  background: color-mix(in srgb, var(--frost-surface) 55%, transparent);
  border-left: 2px solid var(--frost-link);
  color: var(--frost-muted);
}
.extension-widget :global(pre) { white-space: pre-wrap; font: 10.5px/1.45 var(--font-mono); }
</style>
