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
