<script lang="ts">
  import { Collapsible } from "bits-ui";
  import type { ToolActivityView } from "$shared/model/conversationModel";

  import { postToHost } from "../../bridge/vscodeBridge";

  let { activity }: { activity: ToolActivityView } = $props();
  let open = $state(false);

  // pi-084-message-streaming::shape — render explicit preparing/bound tool data;
  // keep this component instance and its `open` state across the transition.
  const tool = $derived(activity.tool);
  const icon = $derived(toolIcon(tool.name));
  const statusIcon = $derived(
    tool.status === "running"
      ? "loading codicon-modifier-spin"
      : tool.status === "error"
        ? "error"
        : tool.status === "cancelled"
          ? "warning"
          : "check",
  );
  const statusLabel = $derived(
    tool.status === "cancelled"
      ? "Final tool result was not received; execution may have been interrupted."
      : tool.status === "running"
        ? "Tool is running"
        : tool.status === "error"
          ? "Tool failed"
          : "Tool completed",
  );
  const errorSummary = $derived(tool.status === "error" ? firstLine(tool.output) : "");
</script>

<Collapsible.Root bind:open class={`activity-row tool-activity${tool.isError ? " activity-error" : ""}`}>
  <Collapsible.Trigger class="activity-trigger tool-activity-trigger">
    <span class={`codicon codicon-${icon} activity-leading`} aria-hidden="true"></span>
    <span class="tool-activity-name">{tool.name}</span>
    <span class="tool-activity-label" title={tool.label}>{tool.label}</span>
    {#if errorSummary}<span class="tool-error-summary" title={tool.output}>{errorSummary}</span>{/if}
    <span
      class={`codicon codicon-${statusIcon} activity-status${tool.status === "cancelled" ? " tool-status-cancelled" : ""}`}
      title={statusLabel}
      aria-label={statusLabel}
    ></span>
    <span class={`codicon codicon-chevron-${open ? "down" : "right"} activity-chevron`} aria-hidden="true"></span>
  </Collapsible.Trigger>
  <Collapsible.Content class="activity-content tool-activity-content">
    <div class="tool-actions">
      {#if tool.filePath}
        <button type="button" onclick={() => postToHost({ type: "openFile", path: tool.filePath!, ...(tool.line ? { line: tool.line } : {}) })}>
          <span class="codicon codicon-go-to-file"></span> Open file
        </button>
        {#if tool.name === "edit" || tool.name === "write"}
          <button type="button" onclick={() => postToHost({ type: "openDiff", path: tool.filePath! })}>
            <span class="codicon codicon-diff"></span> Open diff
          </button>
        {/if}
      {/if}
    </div>
    {#if Object.keys(tool.args).length}
      <div class="tool-section-label">Input</div>
      <div class="tool-input">
        {#each Object.entries(tool.args) as [key, value] (key)}
          {@const rendered = renderArg(value)}
          {#if rendered.kind === "block"}
            <div class="tool-section-label">{key}</div>
            <pre class="tool-json">{rendered.text}</pre>
          {:else}
            <div class="tool-input-row">
              <span class="tool-input-key">{key}:</span>
              <span class="tool-input-value">{rendered.text}</span>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
    {#if tool.output}
      <div class="tool-section-label">Output</div>
      <pre class="tool-output">{tool.output}</pre>
    {/if}
  </Collapsible.Content>
</Collapsible.Root>

<script lang="ts" module>
  function toolIcon(name: string): string {
    if (["read", "grep", "find", "ls"].includes(name)) return "search";
    if (["edit", "write"].includes(name)) return "edit";
    if (name === "bash") return "terminal";
    return "tools";
  }

  function firstLine(value: string | undefined): string {
    if (!value) return "Failed";
    const line = value.split(/\r?\n/, 1)[0]?.trim() || "Failed";
    return line.length > 72 ? `${line.slice(0, 69)}…` : line;
  }

  interface RenderedArg {
    kind: "inline" | "block";
    text: string;
  }

  function renderArg(value: unknown): RenderedArg {
    if (typeof value === "string") {
      if (value.includes("\n") || value.length > 120) {
        return { kind: "block", text: value };
      }
      return { kind: "inline", text: value };
    }
    if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") {
      return { kind: "inline", text: String(value) };
    }
    return { kind: "block", text: JSON.stringify(value, null, 2) };
  }
</script>

<style>
.tool-output::-webkit-scrollbar { width: 9px; height: 9px; }
.tool-output::-webkit-scrollbar-thumb {
  background: var(--frost-scrollbar);
  border: 2px solid transparent;
  background-clip: padding-box;
  border-radius: 99px;
}
.tool-actions { display: flex; gap: 5px; margin-bottom: 7px; }
.tool-actions:empty { display: none; }
.tool-actions :global(button) {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 7px;
  background: var(--frost-secondary-bg);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
}
.tool-actions :global(button:hover) { background: var(--frost-secondary-hover); }
.tool-section-label {
  margin: 7px 0 4px;
  color: var(--frost-muted);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .08em;
}
.tool-json {
  max-height: 240px;
  overflow: auto;
  padding: 8px;
  background: var(--frost-code-bg);
  border-radius: 5px;
  color: var(--frost-text);
  font: 11px/1.48 var(--font-mono);
  white-space: pre-wrap;
  word-break: break-word;
}
.tool-output {
  max-height: 240px;
  overflow: auto;
  padding: 8px;
  background: var(--frost-code-bg);
  border-radius: 5px;
  color: var(--frost-text);
  font: 11px/1.48 var(--font-mono);
  white-space: pre-wrap;
  word-break: break-word;
}
.tool-input { display: flex; flex-direction: column; gap: 2px; }
.tool-input-row { display: flex; gap: 6px; align-items: baseline; font: 11px/1.48 var(--font-mono); }
.tool-input-key { flex: none; color: var(--frost-muted); }
.tool-input-value { min-width: 0; color: var(--frost-text); word-break: break-word; }
.tool-activity-name {
  flex: none;
  color: color-mix(in srgb, var(--frost-text) 88%, var(--frost-muted));
  font-size: 11px;
  font-weight: 500;
}
.tool-activity-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--frost-muted);
  font: 10.5px/1.35 var(--font-mono);
}
.tool-status-cancelled { color: var(--frost-warning); }
.tool-error-summary {
  min-width: 0;
  max-width: 38%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--frost-error);
  font-size: 10px;
}
.tool-activity-content { overflow: hidden; }
.tool-actions { margin-top: 0; }
.tool-json { max-height: 280px; }
.tool-output { max-height: 280px; }

@media (max-width: 430px) {
  .tool-error-summary { display: none; }
}
</style>
