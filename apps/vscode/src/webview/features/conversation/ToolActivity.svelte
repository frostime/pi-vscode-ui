<script lang="ts">
  import { Collapsible, Tabs } from "bits-ui";
  import type { ToolActivityView } from "$shared/model/conversationModel";

  import { postToHost } from "../../bridge/vscodeBridge";
  import { presentDiff } from "./diffPresentation";
  import { isToolSectionId, planToolSections, sectionToShow, type ToolSectionId } from "./toolSectionPlan";

  let { activity }: { activity: ToolActivityView } = $props();
  let open = $state(false);
  /** Section the reader picked; unset until the first expansion latches the plan default. */
  let chosenSection = $state<ToolSectionId | null>(null);

  const tool = $derived(activity.tool);
  const plan = $derived(planToolSections(tool));
  const activeSection = $derived(sectionToShow(plan, chosenSection));

  const name = $derived(tool.state === "preparing" ? "Preparing tool call" : tool.name);
  const label = $derived(tool.state === "preparing" ? "Generating arguments…" : tool.label);
  const icon = $derived(tool.state === "preparing" ? "tools" : toolIcon(tool.name));
  const statusIcon = $derived(
    tool.status === "error"
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
  const errorSummary = $derived(tool.status === "error" && tool.state === "bound" ? firstLine(tool.output) : "");
  /** On a successful edit/write the change size takes the completion slot from the check icon. */
  const stats = $derived(tool.state === "bound" && tool.status === "complete" ? changeStats(tool) : undefined);

  /**
   * Fixes the section this card shows the first time the reader expands it. Tools stream in:
   * arguments first, then the diff and the result, so an unfixed default would follow whichever
   * section arrived last and move the reader away from what they opened.
   */
  function latchSection(): void {
    chosenSection ??= plan.defaultSectionId;
  }

  function selectSection(value: string): void {
    if (isToolSectionId(value)) chosenSection = value;
  }
</script>

<Collapsible.Root bind:open class={`activity-row${tool.isError ? " activity-error" : ""}`}>
  <Collapsible.Trigger class="activity-trigger" onclick={latchSection}>
    <span class={`codicon codicon-${icon} activity-leading`} aria-hidden="true"></span>
    <span class="tool-activity-name">{name}</span>
    <span class="tool-activity-label" title={label}>{label}</span>
    {#if errorSummary && tool.state === "bound"}<span class="tool-error-summary" title={tool.output}>{errorSummary}</span>{/if}
    {#if tool.status === "running"}
      <span class="status-dot running-dot activity-status" title={statusLabel} aria-label={statusLabel}></span>
    {:else if tool.state === "bound" && stats}
      <span class="tool-diffstat" aria-label={statLabel(tool, stats)}>
        {#each statParts(tool, stats) as part (part.cls)}<span class={part.cls}>{part.sign}{part.n}</span>{/each}
      </span>
    {:else}
      <span
        class={`codicon codicon-${statusIcon} activity-status${tool.status === "cancelled" ? " tool-status-cancelled" : ""}`}
        title={statusLabel}
        aria-label={statusLabel}
      ></span>
    {/if}
    <span class={`codicon codicon-chevron-${open ? "down" : "right"} activity-chevron`} aria-hidden="true"></span>
  </Collapsible.Trigger>
  <Collapsible.Content class="activity-content tool-activity-content">
    <div class="tool-body">
      {#if plan.sections.length > 1}
        {@const initialSection = plan.sections[0]!.id}
        <Tabs.Root value={activeSection ?? initialSection} onValueChange={selectSection}>
          <div class="tool-body-bar">
            <span class="tool-tabs">
              <Tabs.List>
                {#each plan.sections as section (section.id)}
                  <Tabs.Trigger value={section.id}>{section.label}</Tabs.Trigger>
                {/each}
              </Tabs.List>
            </span>
            {@render fileAction()}
          </div>
          {#each plan.sections as section (section.id)}
            <Tabs.Content value={section.id}>{@render sectionBody(section.id)}</Tabs.Content>
          {/each}
        </Tabs.Root>
      {:else}
        {@const onlySection = plan.sections.length === 1 ? plan.sections[0]! : null}
        {#if onlySection || plan.openFile}
          <div class="tool-body-bar">
            {#if onlySection}<span class="tool-tab-static">{onlySection.label}</span>{/if}
            {@render fileAction()}
          </div>
        {/if}
        {@render sectionBody(activeSection)}
      {/if}
    </div>
  </Collapsible.Content>
</Collapsible.Root>

{#snippet fileAction()}
  {#if plan.openFile}
    {@const target = plan.openFile}
    <button
      type="button"
      class="tool-action"
      onclick={() => postToHost({ type: "openFile", path: target.path, ...(target.line ? { line: target.line } : {}) })}
    >
      <span class="codicon codicon-go-to-file" aria-hidden="true"></span>
      <span class="tool-action-label">Open file</span>
    </button>
  {/if}
{/snippet}

{#snippet sectionBody(sectionId: ToolSectionId | null)}
  {#if tool.state === "preparing"}
    {#if sectionId === "input"}<pre class="tool-json">{tool.rawArguments}</pre>{/if}
  {:else}
    {@const diff = tool.recognized?.diff}
    {#if sectionId === "changes"}
      {#if diff}
        <pre class="tool-diff" aria-label="Changes"><code class="tool-diff-content">{#each presentDiff(diff) as line, index (index)}<span
          class="tool-diff-line"
          class:added={line.kind === "addition"}
          class:removed={line.kind === "deletion"}
        >{#if line.marker}<span class="tool-diff-marker">{line.marker}</span>{/if}{line.before}{#if line.emphasis}<span class="tool-diff-emphasis">{line.emphasis}</span>{/if}{line.after}{#if !line.marker && !line.before && !line.emphasis && !line.after}<span aria-hidden="true">&nbsp;</span>{/if}</span>{/each}</code></pre>
      {/if}
    {:else if sectionId === "input"}
      <div class="tool-input">
        {#each Object.entries(tool.args) as [key, value] (key)}
          {@const rendered = renderArg(value)}
          {#if rendered.kind === "block"}
            <div class="tool-arg-key">{key}</div>
            <pre class="tool-json">{rendered.text}</pre>
          {:else}
            <div class="tool-input-row">
              <span class="tool-input-key">{key}:</span>
              <span class="tool-input-value">{rendered.text}</span>
            </div>
          {/if}
        {/each}
      </div>
    {:else if sectionId === "output" && tool.output}
      <pre class="tool-output">{tool.output}</pre>
    {/if}
  {/if}
{/snippet}

<script lang="ts" module>
  import type { BoundToolCallView } from "$shared/model/toolCallModel";

  import { diffStats, type DiffStats } from "./diffPresentation";

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

  /** Any tool whose result carries a diff is summarized from that diff; Pi only emits one
   * for `edit` today, but the rule is by data, not by tool name. A `write` reports the
   * number of lines it wrote instead. */
  function changeStats(tool: BoundToolCallView): DiffStats | undefined {
    const diff = tool.recognized?.diff;
    // A real but editless diff still reads as +0 −0 instead of pretending nothing happened.
    if (diff) return diffStats(diff) ?? { additions: 0, deletions: 0 };
    if (tool.name === "write") {
      const { content } = tool.args;
      return typeof content === "string" ? { additions: writtenLineCount(content), deletions: 0 } : undefined;
    }
    return undefined;
  }

  /** Line count of a written file: "a\nb\n" and "a\nb" are both two lines. */
  function writtenLineCount(content: string): number {
    const pieces = content.split(/\r\n|\r|\n/);
    return pieces.length - (pieces.at(-1) === "" ? 1 : 0);
  }

  function statLabel(tool: BoundToolCallView, stats: DiffStats): string {
    if (tool.name === "write") return `${stats.additions} lines written`;
    return `${stats.additions} lines added, ${stats.deletions} lines removed`;
  }

  /** A diff-based stat renders both signs even at zero, so a no-op change still reads as
   * +0 −0; a written-line count only ever reports additions, so it never shows a deletion. */
  function statParts(tool: BoundToolCallView, stats: DiffStats): { cls: string; sign: string; n: number }[] {
    const parts = [{ cls: "tool-diffstat-add", sign: "+", n: stats.additions }];
    if (tool.name !== "write") parts.push({ cls: "tool-diffstat-del", sign: "\u2212", n: stats.deletions });
    return parts;
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
/* Quieter variant of the shared status dot: smaller, dimmed green, no halo.
   The deep-dim floor of the breathe gives the pulse enough contrast to read. */
.running-dot {
  width: 6px;
  height: 6px;
  background: color-mix(in srgb, var(--frost-success) 55%, var(--frost-bg));
  box-shadow: none;
  animation: running-breathe 2s ease-in-out infinite;
}
@keyframes running-breathe { 0%, 100% { opacity: .25; } 50% { opacity: .95; } }

.tool-output::-webkit-scrollbar,
.tool-diff::-webkit-scrollbar { width: 9px; height: 9px; }
.tool-output::-webkit-scrollbar-thumb,
.tool-diff::-webkit-scrollbar-thumb {
  background: var(--frost-scrollbar);
  border: 2px solid transparent;
  background-clip: padding-box;
  border-radius: 99px;
}
/* Section switcher and file action share one row so the body costs the height of its
   largest section instead of the height of every section stacked. */
.tool-body { min-width: 0; }
.tool-body-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-bottom: 7px; }
.tool-tabs { display: flex; min-width: 0; }
.tool-tabs :global([role="tablist"]) { display: flex; gap: 1px; min-width: 0; }
.tool-tabs :global(button) {
  padding: 2px 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--frost-muted);
  font: 11px var(--font-ui);
  cursor: pointer;
}
.tool-tabs :global(button:hover) { color: var(--frost-text); background: var(--frost-hover); }
.tool-tabs :global(button[data-state="active"]) {
  background: color-mix(in srgb, var(--frost-surface) 90%, transparent);
  color: var(--frost-text);
}
.tool-tabs :global(button:focus-visible) { outline: 1px solid var(--frost-focus); outline-offset: 1px; }
/* The lone section of a single-section card keeps the switcher row's geometry, so cards
   still line up with each other without offering a choice that does not exist. */
.tool-tab-static { padding: 2px 8px; color: var(--frost-muted); font: 11px var(--font-ui); }
.tool-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
  padding: 2px 7px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--frost-muted);
  font: 11px var(--font-ui);
  cursor: pointer;
}
.tool-action:hover { color: var(--frost-text); background: var(--frost-hover); }
.tool-action:focus-visible { outline: 1px solid var(--frost-focus); outline-offset: 1px; }
.tool-json {
  max-height: 280px;
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
  max-height: 280px;
  overflow: auto;
  padding: 8px;
  background: var(--frost-code-bg);
  border-radius: 5px;
  color: var(--frost-text);
  font: 11px/1.48 var(--font-mono);
  white-space: pre-wrap;
  word-break: break-word;
}
.tool-diff {
  max-height: 320px;
  overflow: auto;
  padding: 8px 0;
  background: var(--frost-code-bg);
  border-radius: 5px;
  color: var(--frost-text);
  font: 11px/1.48 var(--font-mono);
  white-space: pre;
}
.tool-diff-content {
  display: block;
  width: max-content;
  min-width: 100%;
  font: inherit;
}
.tool-diff-line { display: block; box-sizing: border-box; padding: 0 8px; color: var(--frost-muted); }
.tool-diff-marker { display: inline-block; width: 1ch; text-align: center; }
.tool-diff-line.added {
  color: var(--vscode-diffEditor-insertedTextForeground, var(--frost-text));
  background: var(--vscode-diffEditor-insertedLineBackground, color-mix(in srgb, var(--frost-success) 14%, transparent));
}
.tool-diff-line.removed {
  color: var(--vscode-diffEditor-removedTextForeground, var(--frost-text));
  background: var(--vscode-diffEditor-removedLineBackground, color-mix(in srgb, var(--frost-error) 14%, transparent));
}
.tool-diff-line.added .tool-diff-emphasis {
  background: var(--vscode-diffEditor-insertedTextBackground, color-mix(in srgb, var(--frost-success) 32%, transparent));
}
.tool-diff-line.removed .tool-diff-emphasis {
  background: var(--vscode-diffEditor-removedTextBackground, color-mix(in srgb, var(--frost-error) 32%, transparent));
}
.tool-input { display: flex; flex-direction: column; gap: 2px; }
.tool-input-row { display: flex; gap: 6px; align-items: baseline; font: 11px/1.48 var(--font-mono); }
.tool-input-key { flex: none; color: var(--frost-muted); }
.tool-input-value { min-width: 0; color: var(--frost-text); word-break: break-word; }
/* Argument names sit inside a section rather than beside it, so they are labelled quietly
   instead of reusing a section heading's weight. */
.tool-arg-key { margin: 6px 0 3px; color: var(--frost-muted); font-size: 10px; }
.tool-arg-key:first-child { margin-top: 0; }
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
/* The diffstat takes the completion slot from the check icon on a successful edit/write, so
   the row still reads "how it ended" at a glance; it reuses the Changes body's success/error
   hues and stays small enough to leave the label room at the narrowest panel width. */
.tool-diffstat {
  flex: none;
  margin-left: auto;
  display: inline-flex;
  gap: 4px;
  font: 10.5px/1 var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.tool-diffstat-add { color: var(--frost-success); }
.tool-diffstat-del { color: var(--frost-error); }
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

@media (max-width: 430px) {
  .tool-error-summary { display: none; }
}
</style>
