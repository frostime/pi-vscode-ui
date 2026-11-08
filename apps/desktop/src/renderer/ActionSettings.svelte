<script lang="ts">
  import { tick } from "svelte";
  import type { DesktopCommandAction } from "../shared/desktopActions.js";
  import type { DesktopProject } from "../shared/desktopBridge.js";

  let { actions, projects, busy, onchange }: {
    actions: DesktopCommandAction[];
    projects: DesktopProject[];
    busy: boolean;
    onchange: (actions: DesktopCommandAction[]) => void;
  } = $props();

  interface ActionGroup {
    /** A Project id, or "global" for the list shared by every Project. */
    key: string;
    label: string;
    project?: DesktopProject;
    actions: DesktopCommandAction[];
  }

  let openId = $state("");
  let root = $state<HTMLDivElement>();

  const groups = $derived.by((): ActionGroup[] => {
    const list: ActionGroup[] = [{ key: "global", label: "Global", actions: actions.filter((action) => action.projectId === undefined) }];
    for (const project of projects) {
      const own = actions.filter((action) => action.projectId === project.id);
      if (own.length > 0) list.push({ key: project.id, label: project.name, project, actions: own });
    }
    return list;
  });
  // A Project appears as an add target only while it has no Actions, so every visible group is an existing menu section.
  const addableProjects = $derived(projects.filter((project) => !actions.some((action) => action.projectId === project.id)));

  function fieldId(action: DesktopCommandAction, field: "label" | "command"): string {
    return `action-${field}-${action.id}`;
  }

  function editorId(action: DesktopCommandAction): string {
    return `action-editor-${action.id}`;
  }

  function focusField(action: DesktopCommandAction, field: "label" | "command"): void {
    const element = root?.querySelector<HTMLElement>(`[id="${fieldId(action, field)}"]`);
    element?.focus();
    element?.scrollIntoView({ block: "nearest" });
  }

  /** Container focus comes from the settings error summary, which has no row to point at. */
  function revealFirst(): void {
    const target = groups[0]?.actions[0];
    if (!target) return;
    openId = target.id;
    void tick().then(() => focusField(target, "label"));
  }

  function update(action: DesktopCommandAction, patch: Partial<Pick<DesktopCommandAction, "label" | "command">>): void {
    if (busy) return;
    onchange(actions.map((entry) => entry.id === action.id ? { ...entry, ...patch } : entry));
  }

  async function add(projectId?: string): Promise<void> {
    if (busy) return;
    const action: DesktopCommandAction = { id: crypto.randomUUID(), label: "", command: "" };
    if (projectId) action.projectId = projectId;
    openId = action.id;
    onchange([...actions, action]);
    await tick();
    focusField(action, "label");
  }

  function remove(action: DesktopCommandAction): void {
    if (busy) return;
    const siblings = actions.filter((entry) => entry.projectId === action.projectId);
    const index = siblings.findIndex((entry) => entry.id === action.id);
    const next = siblings[index + 1] ?? siblings[index - 1];
    openId = next?.id ?? "";
    onchange(actions.filter((entry) => entry.id !== action.id));
  }

  /** Menu order is this list order, so a row moves among its own scope's entries only. */
  function move(action: DesktopCommandAction, offset: -1 | 1): void {
    if (busy) return;
    const siblings = actions.filter((entry) => entry.projectId === action.projectId);
    const target = siblings[siblings.indexOf(action) + offset];
    if (!target) return;
    const ordered = [...actions];
    const from = ordered.indexOf(action);
    const to = ordered.indexOf(target);
    ordered[from] = target;
    ordered[to] = action;
    onchange(ordered);
  }

  function insertCwd(action: DesktopCommandAction): void {
    if (busy || !root) return;
    const textarea = root.querySelector<HTMLTextAreaElement>(`[id="${fieldId(action, "command")}"]`);
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const token = "{{cwd}}";
    update(action, { command: action.command.slice(0, start) + token + action.command.slice(end) });
    void tick().then(() => {
      textarea.focus();
      textarea.setSelectionRange(start + token.length, start + token.length);
    });
  }
</script>

<div class="action-settings" id="setting-desktop.actions" data-setting-key="desktop.actions" tabindex="-1" bind:this={root}
  aria-label="Custom Actions" onfocus={(event) => { if (event.target === event.currentTarget) revealFirst(); }}>
  {#each groups as group (group.key)}
    <section class="action-group" aria-label={`${group.label} Actions`}>
      <div class="group-head">
        <span class={`codicon codicon-${group.project ? "folder" : "globe"}`} aria-hidden="true"></span>
        <span class="group-name">{group.label}</span>
        <span class="group-count">{group.actions.length}</span>
        {#if group.project}<code class="group-path" title={group.project.cwd}>{group.project.cwd}</code>{/if}
        <button type="button" class="group-add" disabled={busy} title={`Add an Action to ${group.label}`} onclick={() => void add(group.project?.id)}>
          <span class="codicon codicon-add" aria-hidden="true"></span>Add
        </button>
      </div>
      {#each group.actions as action, index (action.id)}
        <button type="button" class="action-row" aria-expanded={openId === action.id} aria-controls={openId === action.id ? editorId(action) : undefined}
          onclick={() => openId = openId === action.id ? "" : action.id}>
          <span class="action-name" class:unnamed={!action.label.trim()}>{action.label.trim() || "Unnamed Action"}</span>
          <code class="action-command-preview">{action.command.trim() || "No command"}</code>
        </button>
        {#if openId === action.id}
          <div class="action-editor" id={editorId(action)}>
            <div class="field-row">
              <label for={fieldId(action, "label")}>Name</label>
              <input id={fieldId(action, "label")} value={action.label} disabled={busy} maxlength="80" autocomplete="off"
                placeholder="For example: Dev server" oninput={(event) => update(action, { label: event.currentTarget.value })} />
            </div>
            <div class="field-row">
              <label for={fieldId(action, "command")}>Command</label>
              <textarea id={fieldId(action, "command")} value={action.command} disabled={busy} maxlength="4096" rows="2" spellcheck="false"
                placeholder="pnpm dev" oninput={(event) => update(action, { command: event.currentTarget.value })}></textarea>
            </div>
            <div class="field-row">
              <span class="field-spacer" aria-hidden="true"></span>
              <div class="editor-footer">
                <button type="button" class="insert-cwd" disabled={busy} title="Insert the Project path as one quoted argument" onclick={() => insertCwd(action)}>{"{{cwd}}"}</button>
                <span class="hint">Project path, already quoted · PowerShell, window stays open</span>
                <span class="footer-spacer"></span>
                <button type="button" class="step" disabled={busy || index === 0} title="Move up" aria-label={`Move ${action.label.trim() || "this Action"} up`} onclick={() => move(action, -1)}>
                  <span class="codicon codicon-arrow-up" aria-hidden="true"></span>
                </button>
                <button type="button" class="step" disabled={busy || index === group.actions.length - 1} title="Move down" aria-label={`Move ${action.label.trim() || "this Action"} down`} onclick={() => move(action, 1)}>
                  <span class="codicon codicon-arrow-down" aria-hidden="true"></span>
                </button>
                <button type="button" class="delete" disabled={busy} title="Delete this Action" aria-label={`Delete ${action.label.trim() || "this Action"}`} onclick={() => remove(action)}>
                  <span class="codicon codicon-trash" aria-hidden="true"></span>
                </button>
              </div>
            </div>
          </div>
        {/if}
      {:else}
        <p class="group-empty">No Actions yet.</p>
      {/each}
    </section>
  {/each}
  {#if addableProjects.length > 0}
    <div class="add-target">
      <span>Add actions for</span>
      <select aria-label="Add Actions for another Project" disabled={busy}
        onchange={(event) => { const id = event.currentTarget.value; event.currentTarget.value = ""; if (id) void add(id); }}>
        <option value="">Choose a Project…</option>
        {#each addableProjects as project (project.id)}<option value={project.id}>{project.name}</option>{/each}
      </select>
    </div>
  {/if}
</div>

<style>
  .action-settings {
    /* Bands and the open editor share one inset surface so the card reads as bands over rows. */
    --inset-bg: color-mix(in srgb, var(--frost-surface) 90%, #000);
    min-width: 0;
  }
  button, input, select, textarea { font: inherit; }
  button { color: var(--frost-text); cursor: pointer; }
  button:disabled { cursor: default; opacity: .5; }
  code { font-family: var(--font-mono); }

  .action-group + .action-group { border-top: 1px solid var(--frost-border); }
  .group-head { display: flex; align-items: center; gap: 7px; padding: 5px 10px 5px 12px; background: var(--inset-bg); border-top: 1px solid var(--frost-border); border-bottom: 1px solid var(--frost-border); }
  .action-group:first-child .group-head { border-top: 0; border-radius: 8px 8px 0 0; }
  .group-head .codicon { font-size: 14px; color: var(--frost-muted); }
  .group-name { font-size: var(--font-size-compact); font-weight: 600; }
  .group-count { min-width: 17px; padding: 0 5px; border-radius: 9px; background: var(--frost-border-soft); color: var(--frost-muted); font-size: calc(var(--font-size-ui) - 3px); text-align: center; }
  .group-path { min-width: 0; margin-left: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--frost-muted); font-size: var(--font-size-detail); }
  .group-add { margin-left: auto; flex: none; display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--frost-muted); font-size: var(--font-size-detail); }
  .group-head:hover .group-add, .group-add:focus-visible { border-color: var(--frost-border); color: var(--frost-text); }
  .group-add:hover:not(:disabled) { background: var(--frost-hover); }

  .action-row { display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 1fr); align-items: center; gap: 14px; box-sizing: border-box; width: 100%; padding: 7px 12px; border: 0; background: transparent; text-align: left; }
  .action-row:hover { background: var(--frost-hover); }
  .action-row[aria-expanded="true"] { background: color-mix(in srgb, var(--frost-active) 55%, transparent); }
  .action-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-size-compact); }
  .action-name.unnamed { color: var(--frost-muted); font-style: italic; }
  .action-command-preview { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--frost-muted); font: var(--font-size-detail)/1.6 var(--font-mono); }

  .action-editor { padding: 10px 12px 12px; background: var(--inset-bg); border-top: 1px solid var(--frost-border); box-shadow: inset 2px 0 0 var(--frost-link); }
  .field-row { display: flex; align-items: flex-start; gap: 10px; }
  .field-row + .field-row { margin-top: 8px; }
  .field-row > label, .field-spacer { flex: 0 0 64px; padding-top: 6px; color: var(--frost-muted); font-size: var(--font-size-compact); }
  .field-row input, .field-row textarea { box-sizing: border-box; flex: 1 1 auto; min-width: 0; padding: 6px 9px; border: 1px solid var(--frost-input-border); border-radius: 4px; background: var(--frost-input-bg); color: var(--frost-text); }
  .field-row input { font-size: var(--font-size-compact); }
  .field-row textarea { font: var(--font-size-detail)/1.6 var(--font-mono); resize: vertical; }
  .editor-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; flex: 1 1 auto; min-width: 0; }
  .footer-spacer { flex: 1 1 0; min-width: 0; }
  .hint { color: var(--frost-muted); font-size: var(--font-size-detail); }
  .insert-cwd { flex: none; padding: 1px 7px; border: 1px solid var(--frost-border); border-radius: 10px; background: transparent; color: var(--frost-link); font: var(--font-size-detail)/1.7 var(--font-mono); }
  .insert-cwd:hover:not(:disabled) { background: var(--frost-hover); }
  .step, .delete { flex: none; display: inline-flex; padding: 3px; border: 0; border-radius: 4px; background: transparent; color: var(--frost-muted); }
  .step:hover:not(:disabled) { background: var(--frost-hover); color: var(--frost-text); }
  .delete { color: var(--frost-error); }
  .delete:hover:not(:disabled) { background: color-mix(in srgb, var(--frost-error) 16%, transparent); }
  .step .codicon, .delete .codicon { font-size: 13px; }

  .group-empty { padding: 9px 12px; margin: 0; color: var(--frost-muted); font-size: var(--font-size-detail); }
  .add-target { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-top: 1px solid var(--frost-border); border-radius: 0 0 8px 8px; background: var(--inset-bg); color: var(--frost-muted); font-size: var(--font-size-detail); }
  .add-target select { padding: 2px 4px; border: 1px solid var(--frost-border); border-radius: 4px; background: var(--frost-input-bg); color: var(--frost-text); font-size: var(--font-size-detail); }
  :is(button, input, select, textarea):focus-visible { outline: 2px solid var(--frost-focus); outline-offset: 2px; }
  @media (max-width: 540px) {
    .action-row { grid-template-columns: minmax(0, 1fr); gap: 2px; }
    .field-row > label, .field-spacer { flex-basis: 52px; }
  }
</style>
