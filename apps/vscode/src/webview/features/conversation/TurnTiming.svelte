<script lang="ts">
  import { onMount } from "svelte";

  import { formatTurnDuration } from "./collapseTurnTrace";

  let { startedAt }: { startedAt: number } = $props();
  let now = $state(Date.now());

  const elapsedLabel = $derived(formatTurnDuration(startedAt, now) ?? "<1s");
  const startedLabel = $derived(formatStartTime(startedAt));

  onMount(() => {
    const update = (): void => {
      now = Date.now();
    };

    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  });

  function formatStartTime(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(timestamp);
  }
</script>

<div class="turn-timing">
  <span class="codicon codicon-history turn-timing-icon" aria-hidden="true"></span>
  <span class="turn-timing-status" role="status" aria-live="polite">Agent turn running</span>
  <span class="turn-timing-separator" aria-hidden="true">·</span>
  <span class="turn-timing-duration" role="timer" aria-label={`Elapsed ${elapsedLabel}`}>{elapsedLabel}</span>
  <time class="turn-timing-start" datetime={new Date(startedAt).toISOString()}>started {startedLabel}</time>
</div>

<style>
  .turn-timing {
    min-width: 0;
    min-height: 26px;
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 1px 5px;
    padding: 2px 6px;
    border-left: 2px solid color-mix(in srgb, var(--frost-link) 65%, transparent);
    color: var(--frost-muted);
    font-size: 10.5px;
  }

  .turn-timing-icon {
    flex: none;
    color: var(--frost-link);
    font-size: 12px;
  }

  .turn-timing-status {
    flex: none;
    color: var(--frost-text);
    font-weight: 600;
  }

  .turn-timing-separator { color: var(--frost-faint); }

  .turn-timing-duration {
    flex: none;
    color: var(--frost-text);
    font-family: var(--font-mono);
    font-weight: 600;
  }

  .turn-timing-start {
    min-width: 0;
    margin-left: auto;
    overflow: hidden;
    color: var(--frost-faint);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 330px) {
    .turn-timing {
      gap: 4px;
      padding-left: 4px;
      padding-right: 4px;
    }

    .turn-timing-status { max-width: 9.5em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .turn-timing-start { font-size: 9.5px; }
  }
</style>
