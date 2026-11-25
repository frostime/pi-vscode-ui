<script lang="ts" module>
  import type { MarkdownSegment } from "./markdown/parseMessageBlocks";

  function segmentKey(segment: MarkdownSegment, index: number): string {
    // Content-stable keys keep completed mermaid mounts alive across streaming updates.
    return `${index}:${segment.type}:${segment.text.length}:${simpleHash(segment.text)}`;
  }

  function simpleHash(value: string): string {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
</script>

<script lang="ts">
  import MarkdownHtml from "./markdown/MarkdownHtml.svelte";
  import MermaidBlock from "./markdown/MermaidBlock.svelte";
  import { parseMessageBlocks } from "./markdown/parseMessageBlocks";

  let { content, promptReferences = false }: { content: string; promptReferences?: boolean } = $props();

  const segments = $derived(parseMessageBlocks(content));
</script>

<div class="message-content">
  {#each segments as segment, index (segmentKey(segment, index))}
    {#if segment.type === "markdown"}
      <MarkdownHtml content={segment.text} {promptReferences} />
    {:else}
      <MermaidBlock source={segment.text} />
    {/if}
  {/each}
</div>
