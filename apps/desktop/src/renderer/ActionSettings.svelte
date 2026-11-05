<script lang="ts">
  import { tick, untrack } from "svelte";
  import { commandActionIssue, expandActionCommand, isActionLabelValid, type DesktopCommandAction } from "../shared/desktopActions.js";
  import type { DesktopProject } from "../shared/desktopBridge.js";

  let { actions, projects, scope = $bindable("global"), projectId = $bindable(""), busy, error = "", onchange }: {
    actions: DesktopCommandAction[];
    projects: DesktopProject[];
    scope?: "global" | "project";
    projectId?: string;
    busy: boolean;
    error?: string;
    onchange: (actions: DesktopCommandAction[]) => void;
  } = $props();

  let selectedId = $state("");
  let labelInput = $state<HTMLInputElement>();
  let commandInput = $state<HTMLTextAreaElement>();
  const project = $derived(projects.find((entry) => entry.id === projectId));
  const needsProject = $derived(scope === "project" && !project);
  const globalCount = $derived(actions.filter((action) => action.projectId === undefined).length);
  const scopedActions = $derived(actions.filter((action) => scope === "global"
    ? action.projectId === undefined : Boolean(project) && action.projectId === projectId));
  const selected = $derived(scopedActions.find((action) => action.id === selectedId) ?? scopedActions[0]);
  const previewCommand = $derived(selected ? scope === "project" && project
    ? expandActionCommand(selected.command, project.cwd) : selected.command : "");

  // Keep validation focus with the offending entry, including edits in another scope.
  $effect(() => {
    if (!error) return;
    untrack(() => {
      const invalid = actions.find((action) => commandActionIssue([action]));
      if (!invalid) return;
      scope = invalid.projectId === undefined ? "global" : "project";
      projectId = invalid.projectId ?? "";
      selectedId = invalid.id;
      void tick().then(focusEditor);
    });
  });

  function focusEditor(): void {
    if (!selected) return;
    const invalidLabel = !isActionLabelValid(selected.label);
    if (error && !invalidLabel) commandInput?.focus();
    else labelInput?.focus();
  }

  function updateAction(patch: Partial<Pick<DesktopCommandAction, "label" | "command">>): void {
    if (!selected || busy) return;
    onchange(actions.map((action) => action.id === selected.id ? { ...action, ...patch } : action));
  }

  async function addAction(): Promise<void> {
    if (needsProject || busy) return;
    const action: DesktopCommandAction = { id: crypto.randomUUID(), label: "", command: "" };
    if (scope === "project") action.projectId = projectId;
    selectedId = action.id;
    onchange([...actions, action]);
    await tick();
    labelInput?.focus();
  }

  function deleteAction(): void {
    if (!selected || busy) return;
    const index = scopedActions.findIndex((action) => action.id === selected.id);
    const next = scopedActions[index + 1] ?? scopedActions[index - 1];
    onchange(actions.filter((action) => action.id !== selected.id));
    selectedId = next?.id ?? "";
  }

  function insertCwd(): void {
    if (!commandInput || !selected || busy) return;
    const start = commandInput.selectionStart;
    const end = commandInput.selectionEnd;
    const token = "{{cwd}}";
    updateAction({ command: selected.command.slice(0, start) + token + selected.command.slice(end) });
    void tick().then(() => {
      commandInput?.focus();
      commandInput?.setSelectionRange(start + token.length, start + token.length);
    });
  }
</script>

<div class="action-settings" id="setting-desktop.actions" data-setting-key="desktop.actions" tabindex="-1" aria-label="Custom Actions" aria-describedby={error ? "actions-error" : undefined}
  onfocus={(event) => { if (event.target === event.currentTarget) focusEditor(); }}>
  <div class="scope-tabs" role="group" aria-label="Action scope">
    <button type="button" aria-pressed={scope === "global"} onclick={() => scope = "global"}>
      <span class="codicon codicon-globe" aria-hidden="true"></span>Global <span class="count">{globalCount}</span>
    </button>
    <button type="button" aria-pressed={scope === "project"} onclick={() => scope = "project"}>
      <span class="codicon codicon-folder" aria-hidden="true"></span>Project
    </button>
  </div>
  <p class="scope-description">{scope === "global"
    ? "Shared by all Projects. Each command runs in the clicked Project's directory."
    : "Edit Actions for the selected Project. This does not switch your open Project."}</p>
  {#if scope === "project"}
    <div class="project-target">
      <label for="action-project">Project</label>
      <select id="action-project" value={projectId} onchange={(event) => { projectId = event.currentTarget.value; selectedId = ""; }}>
        <option value="">Select a Project…</option>
        {#each projects as entry (entry.id)}<option value={entry.id}>{entry.name}</option>{/each}
      </select>
      {#if project}<code>{project.cwd}</code>{/if}
    </div>
  {/if}
  {#if error}<p class="field-error" id="actions-error" role="alert">{error}</p>{/if}
  {#if needsProject}
    <div class="empty-project">Select a Project to view or edit its Actions.</div>
  {:else}
    <div class="action-editor">
      <section class="action-list" aria-label="Configured Actions">
        <div class="list-heading"><span>CUSTOM ACTIONS</span>
          <button type="button" class="add-action" disabled={busy} onclick={() => void addAction()}><span class="codicon codicon-add" aria-hidden="true"></span>Add</button>
        </div>
        {#each scopedActions as action (action.id)}
          <button type="button" class="configured-action" aria-pressed={selected?.id === action.id} onclick={() => selectedId = action.id}>
            <strong>{action.label.trim() || "Unnamed Action"}</strong><code>{action.command || "Enter a shell command"}</code>
          </button>
        {/each}
        <p class="list-help">Menu order follows this list.<br />Project Actions append to global Actions.</p>
      </section>
      <div class="editor-fields">
        {#if selected}
          <div class="editor-heading"><h4>Edit Action</h4>
            <button type="button" class="delete-action" disabled={busy} aria-label="Delete this Action" title="Delete this Action" onclick={deleteAction}><span class="codicon codicon-trash" aria-hidden="true"></span></button>
          </div>
          <label for="action-label">Menu name</label>
          <input id="action-label" bind:this={labelInput} value={selected.label} disabled={busy} aria-invalid={Boolean(error)} required maxlength="80" autocomplete="off" placeholder="For example: Dev server" oninput={(event) => updateAction({ label: event.currentTarget.value })} />
          <label for="action-command">PowerShell command</label>
          <textarea id="action-command" bind:this={commandInput} value={selected.command} disabled={busy} aria-invalid={Boolean(error)} required maxlength="4096" rows="3" spellcheck="false" placeholder="pnpm dev" aria-describedby="action-command-help" oninput={(event) => updateAction({ command: event.currentTarget.value })}></textarea>
          <p class="field-help" id="action-command-help">No <code>cd</code> needed. Use <button type="button" class="insert-cwd" disabled={busy} onclick={insertCwd}>{"{{cwd}}"}</button> for a safely quoted Project path argument. Do not add quotes around it.</p>
          <div class="execution-preview">
            <div class="preview-heading"><span class="codicon codicon-terminal" aria-hidden="true"></span><strong>Launch preview</strong><span>Does not execute</span></div>
            <dl><dt>Directory</dt><dd>{scope === "global" ? "Project directory at run time" : project!.cwd}</dd><dt>Command</dt><dd>{previewCommand || "—"}</dd></dl>
            <p>New terminal window · PowerShell · Stays open after the command ends</p>
          </div>
        {:else}
          <div class="empty-editor">No Actions yet. Click Add to configure your first command.</div>
        {/if}
      </div>
    </div>
  {/if}
  <p class="settings-note"><span class="codicon codicon-folder" aria-hidden="true"></span><span>Saved in Desktop user settings, not in the repository. Commands run only when clicked. FrostPi does not track terminal state.</span></p>
</div>

<style>
  .action-settings { padding: 16px 18px 0; min-width: 0; }
  button, input, select, textarea { font: inherit; }
  button { display: inline-flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid var(--frost-border); border-radius: 4px; color: var(--frost-text); background: var(--frost-secondary-bg); cursor: pointer; }
  button:hover:not(:disabled) { background: var(--frost-secondary-hover); }
  button:disabled { cursor: default; opacity: .5; }
  p { color: var(--frost-muted); line-height: 1.6; }
  code, textarea, dd { font-family: var(--font-mono); }
  .scope-tabs { display: flex; gap: 24px; border-bottom: 1px solid var(--frost-border); }
  .scope-tabs button { border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; color: var(--frost-muted); padding: 0 2px 12px; }
  .scope-tabs button[aria-pressed="true"] { color: var(--frost-text); border-bottom-color: var(--frost-link); }
  .scope-tabs .codicon { font-size: 14px; }
  .count { padding: 1px 6px; border-radius: 8px; color: var(--frost-muted); background: var(--frost-secondary-bg); font-size: var(--font-size-detail); }
  .scope-description { font-size: var(--font-size-compact); margin: 13px 0 18px; }
  .project-target { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
  .project-target label { color: var(--frost-muted); font-size: var(--font-size-compact); }
  .project-target select { min-width: 180px; max-width: 100%; padding: 7px 9px; border: 1px solid var(--frost-input-border); border-radius: 4px; color: var(--frost-text); background: var(--frost-input-bg); }
  .project-target code { flex-basis: 100%; overflow-wrap: anywhere; color: var(--frost-muted); font-size: var(--font-size-detail); }
  .empty-project { display: grid; place-items: center; min-height: 240px; padding: 20px; border: 1px dashed var(--frost-border); border-radius: 5px; color: var(--frost-muted); text-align: center; }
  .action-editor { display: grid; grid-template-columns: 185px minmax(0, 1fr); min-height: 330px; border: 1px solid var(--frost-border); border-radius: 5px; overflow: hidden; }
  .action-list { display: flex; flex-direction: column; min-width: 0; background: var(--frost-bg); border-right: 1px solid var(--frost-border); }
  .list-heading { display: flex; justify-content: space-between; align-items: center; gap: 5px; padding: 12px 10px; }
  .list-heading > span { font-size: calc(var(--font-size-ui) - 4px); color: var(--frost-muted); letter-spacing: .4px; }
  .add-action { padding: 4px 6px; font-size: var(--font-size-detail); background: transparent; }
  .add-action .codicon { font-size: 12px; }
  .configured-action { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; width: 100%; padding: 11px 12px; border: 0; border-left: 2px solid transparent; border-radius: 0; background: transparent; text-align: left; }
  .configured-action[aria-pressed="true"] { background: color-mix(in srgb, var(--frost-active) 55%, transparent); border-left-color: var(--frost-link); }
  .configured-action strong { max-width: 100%; overflow-wrap: anywhere; font-size: var(--font-size-compact); font-weight: 500; }
  .configured-action code { width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--frost-muted); font-size: var(--font-size-detail); }
  .list-help { margin: auto 0 0; padding: 18px 12px 12px; font-size: calc(var(--font-size-ui) - 3px); }
  .editor-fields { min-width: 0; padding: 14px 18px 18px; }
  .editor-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  h4 { margin: 0; font-size: var(--font-size-compact); font-weight: 500; }
  .delete-action { padding: 4px; background: transparent; border: 0; color: var(--frost-error); }
  .editor-fields > label { display: block; color: var(--frost-muted); font-size: var(--font-size-compact); margin: 0 0 7px; }
  input, textarea { box-sizing: border-box; width: 100%; min-width: 0; padding: 8px 10px; border: 1px solid var(--frost-input-border); border-radius: 4px; color: var(--frost-text); background: var(--frost-input-bg); }
  input { margin-bottom: 15px; }
  textarea { resize: vertical; line-height: 1.6; }
  .field-help { font-size: var(--font-size-detail); margin: 7px 0 16px; }
  .insert-cwd { display: inline; padding: 0 4px; border: 0; color: var(--frost-link); font-family: var(--font-mono); }
  .execution-preview { padding: 12px; border: 1px solid var(--frost-border); border-radius: 4px; background: var(--frost-bg); }
  .preview-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; color: var(--frost-muted); font-size: var(--font-size-detail); }
  .preview-heading strong { font-weight: 500; }
  .preview-heading > span:last-child { margin-left: auto; font-size: calc(var(--font-size-ui) - 4px); }
  dl { display: grid; grid-template-columns: 62px minmax(0, 1fr); gap: 9px; font-size: var(--font-size-detail); margin: 14px 0; }
  dt { color: var(--frost-muted); }
  dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
  .execution-preview > p { padding-top: 10px; margin: 0; border-top: 1px solid var(--frost-border); font-size: calc(var(--font-size-ui) - 3px); }
  .empty-editor { display: grid; place-items: center; height: 100%; min-height: 220px; color: var(--frost-muted); font-size: var(--font-size-compact); line-height: 1.6; text-align: center; }
  .settings-note { display: flex; align-items: flex-start; gap: 7px; font-size: var(--font-size-detail); padding: 14px 0; margin: 0; }
  .settings-note .codicon { font-size: 13px; margin-top: 3px; }
  .field-error { color: var(--frost-error); font-size: var(--font-size-compact); }
  [aria-invalid="true"] { border-color: var(--frost-error); }
  :is(button, input, select, textarea, .action-settings):focus-visible { outline: 2px solid var(--frost-focus); outline-offset: 2px; }
  @media (max-width: 900px) {
    .action-editor { grid-template-columns: 145px minmax(0, 1fr); }
    .list-heading { flex-wrap: wrap; }
    .editor-fields { padding: 12px; }
  }
  @media (max-width: 540px) {
    .action-settings { padding: 14px 12px 0; }
    .action-editor { grid-template-columns: minmax(0, 1fr); }
    .action-list { border-right: 0; border-bottom: 1px solid var(--frost-border); }
    .list-heading { flex-wrap: nowrap; }
    .list-help { padding-top: 10px; }
  }
</style>
