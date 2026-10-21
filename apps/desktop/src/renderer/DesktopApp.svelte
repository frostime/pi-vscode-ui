<script lang="ts">
  import { onMount } from "svelte";
  import ClientApp from "@frostime/pi-client/ui";
  import StatusDot from "@frostime/pi-client/ui/features/sessions/StatusDot.svelte";
  import { postToHost } from "@frostime/pi-client/ui/bridge/hostBridge";
  import { presentationStore } from "@frostime/pi-client/ui/state/sessionViewStore.svelte";
  import { withFrostPiCommands, type LocalComposerCommands } from "@frostime/pi-client/ui/features/composer/frostPiCommands";
  import type { DesktopDialog, DesktopProjectsView } from "../shared/desktopBridge.js";

  let projects = $state<DesktopProjectsView>({ projects: [], activeProjectId: null });
  let request = $state<DesktopDialog | null>(null);
  let input = $state("");
  const visibleItems = $derived(request?.kind === "pick"
    ? request.items.filter((item) => item.separator || item.alwaysShow || `${item.label} ${item.description ?? ""} ${item.detail ?? ""}`.toLowerCase().includes(input.toLowerCase()))
    : []);

  const commands: LocalComposerCommands = {
    completions: (items) => withFrostPiCommands(items).filter((item) => item.name !== "editor"),
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
    window.frostpiDesktop.requestProjects();
    return () => { unsubscribeProjects(); unsubscribeDialog(); };
  });

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
    <p class="preview-note">Development preview. Projects and settings are kept in memory in this build.</p>
  </aside>
  <div class="client-region">
    <ClientApp localComposerCommands={commands} capabilities={{ sessionEditorTabs: false, editorMentionSpecials: false }} />
  </div>
</div>

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
              <button type="button" onclick={() => respond(item.id)}><strong>{item.label}</strong>{#if item.description}<span>{item.description}</span>{/if}{#if item.detail}<small>{item.detail}</small>{/if}</button>
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
