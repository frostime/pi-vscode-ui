<script lang="ts">
  import type { ExtensionWidgetView } from "$shared/model/extensionUiModel";
  let { widgets }: { widgets: ExtensionWidgetView[] } = $props();
</script>

{#if widgets.length}
  <div class="extension-widgets">
    {#each widgets as widget (widget.key)}
      {#if widget.scheduledTasks}
        <details class="schedule-widget">
          <summary>Scheduled tasks ({widget.scheduledTasks.length})</summary>
          <ul>
            {#each widget.scheduledTasks as task (task.id)}
              <li>
                <strong>{task.name}</strong> · {task.state}
                <div>{task.timing}{task.nextRun ? ` · Next: ${task.nextRun}` : ""}</div>
                <code>{task.id}</code>
              </li>
            {/each}
          </ul>
        </details>
      {:else}
      <div class="extension-widget" class:subagents={widget.key === "subagent-async"}>
        <span class="codicon codicon-extensions"></span>
        <pre>{widget.lines.join("\n")}</pre>
      </div>
      {/if}
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
.extension-widget :global(pre) { white-space: pre-wrap; font: calc(var(--font-size-ui) - 2.5px)/1.45 var(--font-mono); }
.subagents pre { min-width: 0; max-height: 20vh; overflow: auto; overflow-wrap: anywhere; }
.schedule-widget { padding: 6px 8px; color: var(--frost-text); border-left: 2px solid var(--frost-link); }
.schedule-widget summary { cursor: pointer; font-weight: 600; }
.schedule-widget ul { list-style: none; margin: 6px 0 0; padding: 0; max-height: 22vh; overflow: auto; }
.schedule-widget li { padding: 4px 0; overflow-wrap: anywhere; }
.schedule-widget li div, .schedule-widget code { color: var(--frost-muted); }
</style>
