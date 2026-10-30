<script lang="ts">
  import { parseVscodeLabel } from "./vscodeLabel.js";

  let { label }: { label: string } = $props();
  const parts = $derived(parseVscodeLabel(label));
</script>

{#each parts as part, index (index)}{#if part.kind === "text"}{part.text}{:else}<span class={part.className} aria-hidden="true"></span>{/if}{/each}
