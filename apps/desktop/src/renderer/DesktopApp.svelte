<script lang="ts">
  import { onMount } from "svelte";
  import ClientApp from "@frostime/pi-client/ui";
  import StatusDot from "@frostime/pi-client/ui/features/sessions/StatusDot.svelte";
  import { postToHost } from "@frostime/pi-client/ui/bridge/hostBridge";
  import { presentationStore } from "@frostime/pi-client/ui/state/sessionViewStore.svelte";
  import { withFrostPiCommands, type LocalComposerCommands } from "@frostime/pi-client/ui/features/composer/frostPiCommands";
  import type { DesktopDialog, DesktopProjectsView } from "../shared/desktopBridge.js";
  import VscodeLabel from "./VscodeLabel.svelte";
  import { quickPickMatches } from "./quickPick.js";
  import SettingsPanel from "./SettingsPanel.svelte";
  import { desktopSettingDefinitions, type DesktopSettingsAction, type DesktopSettingsTarget, type DesktopSettingsView } from "../shared/desktopSettings.js";
  import { DESKTOP_CLIENT_UI_CAPABILITIES } from "../shared/desktopCapabilities.js";

  let settingsView = $state<DesktopSettingsView | null>(null);
  let settingsOpen = $state(false);
  let settingsTarget = $state<DesktopSettingsTarget>("all");
  let settingsBusy = $state(false);
  let settingsError = $state("");

  let projects = $state<DesktopProjectsView>({ projects: [], activeProjectId: null });
  let request = $state<DesktopDialog | null>(null);
  let input = $state("");
  const visibleItems = $derived.by(() => {
    const pick = request;
    return pick?.kind === "pick" ? pick.items.filter((item) => quickPickMatches(item, input, pick)) : [];
  });

  const commands: LocalComposerCommands = {
    completions: (items) => withFrostPiCommands(items),
    handle: ({ text, hasImages }) => !hasImages && text.trim() === "/resume"
      ? { draft: "clear", execute: () => postToHost({ type: "resumeSession" }) }
      : undefined,
  };

  onMount(() => {
    const unsubscribeProjects = window.frostpiDesktop.onProjects((value) => projects = value);
    const unsubscribeDialog = window.frostpiDesktop.onDialog((value) => {
      const changed = value?.id !== request?.id;
      request = value;
      if (changed) input = value?.kind === "input" ? value.value : "";
    });
    const unsubscribeSettings = window.frostpiDesktop.onSettings(applySettings);
    const unsubscribeOpenSettings = window.frostpiDesktop.onOpenSettings(showSettings);
    void window.frostpiDesktop.settings({ type: "read" }).then((view) => {
      applySettings(view);
      settingsOpen = view.firstRun || Boolean(view.error);
    }).catch(() => { settingsError = "Could not load Desktop settings."; });
    window.frostpiDesktop.requestProjects();
    return () => { unsubscribeProjects(); unsubscribeDialog(); unsubscribeSettings(); unsubscribeOpenSettings(); };
  });

  function showSettings(target: DesktopSettingsTarget = "all"): void {
    settingsTarget = target;
    settingsOpen = true;
    void settingsAction({ type: "read" });
  }

  function applySettings(view: DesktopSettingsView): void {
    settingsView = view;
    const family = view.values["editor.fontFamily"];
    const fallback = String(desktopSettingDefinitions["editor.fontFamily"]!.default);
    document.documentElement.style.setProperty("--vscode-editor-font-family", typeof family === "string" && family.trim() ? family : fallback);
  }

  async function settingsAction(action: DesktopSettingsAction): Promise<void> {
    settingsBusy = true;
    settingsError = "";
    try {
      const view = await window.frostpiDesktop.settings(action);
      // Import returns an editable preview; it must not change live typography before Save.
      if (action.type === "importVscode") settingsView = view;
      else applySettings(view);
      if (action.type === "useDefaults") settingsOpen = false;
    } catch (error) {
      settingsError = error instanceof Error ? error.message : "The settings operation failed.";
    } finally {
      settingsBusy = false;
    }
  }

  function respond(value: string | null): void {
    if (request) window.frostpiDesktop.respondDialog(request.id, value);
  }

  function openDialog(element: HTMLDialogElement): { destroy(): void } {
    element.showModal();
    queueMicrotask(() => element.querySelector<HTMLInputElement>("input")?.focus());
    return { destroy: () => element.close() };
  }
</script>

<div class="desktop-shell">
  <aside aria-label="Projects and open Pi sessions">
    <div class="project-heading"><strong>Projects</strong><button type="button" aria-label="Add Project" onclick={() => window.frostpiDesktop.addProject()}>＋</button></div>
    {#each projects.projects as project (project.id)}
      <button type="button" class:chosen={project.id === projects.activeProjectId} title={project.cwd} onclick={() => window.frostpiDesktop.selectProject(project.id)}>{project.name}</button>
    {/each}
    <h2>All open Pi</h2>
    {#each $presentationStore.sessions as session (session.id)}
      <button type="button" class="pi-row" class:chosen={session.id === $presentationStore.activeSessionId} title={session.cwd} onclick={() => postToHost({ type: "activateSession", sessionId: session.id })}>
        <StatusDot status={session.status} /><span>{session.title}</span>{#if session.requiresUserInput}<span aria-label="Needs input">!</span>{/if}
      </button>
    {/each}
    <button type="button" class="settings-button" onclick={() => showSettings()}>Settings</button>
    {#if settingsError && !settingsOpen}<p role="alert">{settingsError}</p>{/if}
    <p class="preview-note">Development preview. Settings are saved; Projects and open Pi lists are not restored after exit.</p>
  </aside>
  <div class="client-region">
    <ClientApp localComposerCommands={commands} capabilities={DESKTOP_CLIENT_UI_CAPABILITIES} />
  </div>
</div>

{#if settingsOpen && settingsView}
  <SettingsPanel view={settingsView} target={settingsTarget} busy={settingsBusy} error={settingsError} onaction={settingsAction} onclose={() => settingsOpen = false} />
{/if}

{#if request}
  <dialog use:openDialog aria-labelledby="desktop-dialog-title" oncancel={(event) => { event.preventDefault(); respond(null); }}>
    <h2 id="desktop-dialog-title">{request.title}</h2>
    {#if request.kind === "input"}<p>{request.prompt}</p>{/if}
    <form onsubmit={(event) => { event.preventDefault(); if (request?.kind === "input") respond(input); }}>
      <input aria-label={request.kind === "pick" ? "Search choices" : request.title} aria-invalid={request.kind === "input" && Boolean(request.error)} placeholder={request.placeholder} bind:value={input} />
      {#if request.kind === "input" && request.error}<p role="alert">{request.error}</p>{/if}
      {#if request.kind === "pick"}
        <div class="choices">
          {#each visibleItems as item (item.id)}
            {#if item.separator}<h3>{item.label}</h3>{:else}
              <button type="button" onclick={() => respond(item.id)}><strong><VscodeLabel label={item.label} /></strong>{#if item.description}<span><VscodeLabel label={item.description} /></span>{/if}{#if item.detail}<small><VscodeLabel label={item.detail} /></small>{/if}</button>
            {/if}
          {/each}
        </div>
      {/if}
      <footer><button type="button" onclick={() => respond(null)}>Cancel</button>{#if request.kind === "input"}<button type="submit">Continue</button>{/if}</footer>
    </form>
  </dialog>
{/if}

<style>
  .desktop-shell { height: 100%; display: grid; grid-template-columns: 180px minmax(0, 1fr); color: var(--frost-text); font: var(--font-size) var(--font-ui); background: var(--frost-bg); }
  aside { min-width: 0; padding: 10px; overflow: auto; border-right: 1px solid var(--frost-border); }
  .project-heading { display: flex; align-items: center; justify-content: space-between; }
  aside button { width: 100%; padding: 7px; border-radius: 4px; text-align: left; background: transparent; cursor: pointer; overflow: hidden; text-overflow: ellipsis; }
  .project-heading button { width: auto; }
  aside button:hover, aside button.chosen { background: var(--frost-hover); }
  h2 { margin: 15px 0 6px; font-size: 12px; }
  .pi-row { display: flex; align-items: center; gap: 7px; }
  .pi-row > span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .preview-note { margin-top: 20px; color: var(--frost-muted); font-size: 11px; }
  .client-region { min-width: 0; min-height: 0; height: 100%; }
  dialog { margin: auto; width: min(650px, calc(100vw - 30px)); max-height: 85vh; padding: 16px; border: 1px solid var(--frost-border); border-radius: 8px; color: var(--frost-text); background: var(--frost-surface-raised); font-family: var(--font-ui); }
  dialog::backdrop { background: #0008; }
  dialog h2 { margin: 0 0 12px; }
  dialog p { color: var(--frost-muted); margin-bottom: 8px; }
  dialog input { width: 100%; padding: 8px; border: 1px solid var(--frost-input-border); background: var(--frost-input-bg); }
  .choices { max-height: 55vh; overflow: auto; margin-top: 10px; }
  .choices h3 { font-size: 11px; padding: 8px 0; color: var(--frost-muted); }
  .choices button { display: grid; gap: 4px; width: 100%; text-align: left; padding: 8px; background: transparent; cursor: pointer; }
  .choices button:hover { background: var(--frost-hover); }
  .choices span, .choices small { color: var(--frost-muted); overflow-wrap: anywhere; }
  footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  footer button { padding: 7px 12px; background: var(--frost-secondary-bg); cursor: pointer; }
  @media (max-width: 600px) { .desktop-shell { grid-template-columns: minmax(0, 1fr); grid-template-rows: 100px minmax(0, 1fr); } aside { padding: 5px; border-right: 0; border-bottom: 1px solid var(--frost-border); } }
</style>
