<script lang="ts">
  import { onMount } from "svelte";

  import { formatTurnDuration } from "./collapseTurnTrace";

  let { startedAt, label }: { startedAt: number; label: string } = $props();
  let now = $state(Date.now());

  const elapsedLabel = $derived(formatTurnDuration(startedAt, now) ?? "<1s");

  onMount(() => {
    const update = (): void => {
      now = Date.now();
    };

    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  });
</script>

<span class="tool-timer" title={label} aria-label={`Tool is running, elapsed ${elapsedLabel}`} role="timer">
  {elapsedLabel}
</span>

<style>
/* Live elapsed readout for long-running tools, in place of the breathing dot. The auto
   margin right-aligns it with the card's status slot; the child style scope is required —
   the element is this component's, so the parent's rules never reach it. */
.tool-timer {
  flex: none;
  margin-left: auto;
  color: var(--frost-text);
  font: 10.5px/1 var(--font-mono);
  font-variant-numeric: tabular-nums;
}
</style>
