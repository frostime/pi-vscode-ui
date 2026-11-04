<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type { Snippet } from "svelte";
  import { DESKTOP_SIDEBAR_WIDTH } from "../shared/desktopBridge.js";
  import { desktopThemes, type DesktopTheme } from "../shared/desktopSettings.js";
  import type {
    DesktopProjectActionView,
    DesktopProjectActivity,
    DesktopProjectsView,
    DesktopResumeView,
    DesktopSidebarLayout,
  } from "../shared/desktopBridge.js";
  import type { SessionSummaryView } from "@frostime/pi-client/shared/model/sessionViewModel";
  import ProjectActionMenu from "./ProjectActionMenu.svelte";

  const DEFAULT_WIDTH = DESKTOP_SIDEBAR_WIDTH.default;
  const MIN_WIDTH = DESKTOP_SIDEBAR_WIDTH.min;
  const MAX_WIDTH = DESKTOP_SIDEBAR_WIDTH.max;
  const KEY_STEP = 8;
  const NARROW_WIDTH = 640;
  const clampWidth = (value: number): number =>
    Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)));

  /** Which trigger opened the Project action menu; the shell owns only this state. */
  type ProjectMenuTarget = { anchor: HTMLElement; projectId: string; projectName: string };
  /** Half of the hovered row that would receive the dragged Project. */
  type DropTarget = { id: string; after: boolean };

  let {
    view,
    sessions,
    activeSessionId,
    resume,
    error = "",
    children,
    onproject,
    onadd,
    onremove,
    onmove,
    onaction,
    onsettings,
    theme,
    themeBusy,
    ontheme,
    onsidebar,
    onsession,
    onresume,
  }: {
    view: DesktopProjectsView;
    sessions: SessionSummaryView[];
    activeSessionId: string | null;
    resume: DesktopResumeView | null;
    error?: string;
    children: Snippet;
    onproject: (id: string) => void;
    onadd: () => void;
    onremove: (id: string) => void;
    onmove: (id: string, index: number) => void;
    onaction: (id: string, action: string) => void;
    onsettings: () => void;
    theme: DesktopTheme;
    themeBusy: boolean;
    ontheme: () => void;
    onsidebar: (layout: DesktopSidebarLayout) => void;
    onsession: (id: string) => void;
    onresume: (id: string) => void;
  } = $props();

  let shell = $state<HTMLElement | null>(null);
  let projectsButton = $state<HTMLButtonElement | null>(null);
  let contextButton = $state<HTMLButtonElement | null>(null);
  let drawerClose = $state<HTMLButtonElement | null>(null);
  let chooseDetails = $state<HTMLDetailsElement | null>(null);
  let width = $state(untrack(() => clampWidth(view.navigation?.sidebar.width ?? DEFAULT_WIDTH)));
  let hidden = $state(untrack(() => view.navigation?.sidebar.hidden ?? false));
  let pending = $state<DesktopSidebarLayout | null>(null);
  let dragging = $state(false);
  let narrow = $state(false);
  let drawer = $state(false);
  let tooltip = $state(false);
  let menu = $state<ProjectMenuTarget | null>(null);
  let dragId = $state<string | null>(null);
  let dropTarget = $state<DropTarget | null>(null);
  let resizeStart: { x: number; width: number } | null = null;
  let keyboardDirty = false;

  const nextTheme = $derived(theme === "dark" ? "light" : "dark");
  const themeAction = $derived(`Switch to ${desktopThemes[nextTheme].label}`);
  const activeProject = $derived(view.projects.find((project) => project.id === view.activeProjectId) ?? null);
  const activeSession = $derived(sessions.find((session) => session.id === activeSessionId));
  const differentDirectory = $derived(activeSession && activeProject && activeSession.cwd !== activeProject.cwd ? activeSession.cwd : null);
  const projectActions = $derived<DesktopProjectActionView[]>(view.actions ?? []);
  // The menu replaces the path tooltip while it is open.
  const tooltipVisible = $derived(tooltip && menu === null && activeProject !== null);
  const sidebarVisible = $derived(!narrow && !hidden);
  const sidebarAvailable = $derived(sidebarVisible || (narrow && drawer));
  const showChoose = $derived(activeProject !== null && activeSessionId === null && sessions.length > 0);
  const backgroundWaitingIds = $derived.by(() => {
    const activity = view.navigation?.activity;
    return activity
      ? view.projects.flatMap((project) => activity[project.id]?.waitingSessionIds ?? [])
          .filter((id) => id !== activeSessionId)
      : [];
  });
  const projectsLabel = $derived(narrow || hidden ? "Projects" : "Hide");
  const projectsAriaLabel = $derived(
    narrow
      ? drawer ? "Close the Projects drawer" : "Open the Projects drawer"
      : hidden ? "Show the Projects sidebar" : "Hide the Projects sidebar",
  );

  // Keep the local drag optimistic; ignore a stale host echo until the latest
  // emitted layout returns. A saved update otherwise wins.
  $effect(() => {
    const saved = view.navigation?.sidebar;
    if (!saved || dragging || keyboardDirty) return;
    if (pending) {
      if (saved.hidden === pending.hidden && clampWidth(saved.width) === pending.width) pending = null;
      return;
    }
    untrack(() => {
      const next = clampWidth(saved.width);
      if (next !== width) width = next;
      if (saved.hidden !== hidden) hidden = saved.hidden;
    });
  });

  $effect(() => {
    if (!narrow) drawer = false;
  });

  // A removed Project must not leave its action menu anchored to a gone row.
  $effect(() => {
    const open = menu;
    if (!open) return;
    if (view.projects.some((project) => project.id === open.projectId)) return;
    menu = null;
  });

  onMount(() => {
    let observer: ResizeObserver | null = null;
    if (shell) {
      const updateNarrow = () => { narrow = shell!.getBoundingClientRect().width <= NARROW_WIDTH; };
      observer = new ResizeObserver(updateNarrow);
      observer.observe(shell);
      updateNarrow();
    }
    const closeChooseOutside = (event: PointerEvent) => {
      if (!chooseDetails?.open) return;
      if (event.target instanceof Node && chooseDetails.contains(event.target)) return;
      chooseDetails.open = false;
    };
    // Capture Escape so the drawer cannot also collapse the shared Composer underneath.
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // An open Project menu owns Escape and restores focus to its trigger.
      if (menu) return;
      if (chooseDetails?.open) {
        event.preventDefault();
        event.stopImmediatePropagation();
        chooseDetails.open = false;
        chooseDetails.querySelector<HTMLElement>("summary")?.focus();
        return;
      }
      if (narrow && drawer) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeDrawer();
      }
    };
    document.addEventListener("pointerdown", closeChooseOutside, true);
    window.addEventListener("keydown", dismissOnEscape, true);
    return () => {
      observer?.disconnect();
      document.removeEventListener("pointerdown", closeChooseOutside, true);
      window.removeEventListener("keydown", dismissOnEscape, true);
    };
  });

  function activityFor(projectId: string): DesktopProjectActivity {
    const reported = view.navigation?.activity[projectId];
    if (reported) return reported;
    if (projectId !== view.activeProjectId) return { total: 0, running: 0, waitingSessionIds: [] };
    return {
      total: sessions.length,
      running: sessions.filter((session) => session.status === "running").length,
      waitingSessionIds: sessions.filter((session) => session.requiresUserInput).map((session) => session.id),
    };
  }

  function countsLabel(activity: DesktopProjectActivity): string {
    if (activity.total === 0) return "No sessions";
    const total = `${activity.total} session${activity.total === 1 ? "" : "s"}`;
    return activity.running > 0 ? `${total} · ${activity.running} running` : total;
  }

  function sessionStatusLabel(session: SessionSummaryView): string {
    return session.requiresUserInput ? "needs input" : session.status;
  }

  function sessionDotClass(session: SessionSummaryView): string {
    return `status-dot status-${session.requiresUserInput ? "queued" : session.status}`;
  }

  function focusProjects(): void {
    requestAnimationFrame(() => projectsButton?.focus());
  }

  function commitSidebar(): void {
    const layout: DesktopSidebarLayout = { hidden, width };
    pending = { ...layout };
    onsidebar({ ...layout });
  }

  function toggleSidebar(): void {
    if (narrow) {
      if (drawer) closeDrawer(); else openDrawer();
      return;
    }
    hidden = !hidden;
    commitSidebar();
  }

  function openDrawer(): void {
    drawer = true;
    requestAnimationFrame(() => drawerClose?.focus());
  }

  function closeDrawer(): void {
    if (!drawer) return;
    drawer = false;
    focusProjects();
  }

  function selectProject(id: string): void {
    if (narrow && drawer) closeDrawer();
    onproject(id);
  }

  function menuFor(id: string): boolean {
    return menu?.projectId === id;
  }

  function toggleMenu(anchor: HTMLElement, project: { id: string; name: string }): void {
    if (menu?.anchor === anchor) { menu = null; return; }
    menu = { anchor, projectId: project.id, projectName: project.name };
  }

  function runMenuAction(action: string): void {
    const target = menu;
    if (!target) return;
    menu = null;
    target.anchor.focus();
    onaction(target.projectId, action);
  }

  function runMenuRemove(): void {
    const target = menu;
    if (!target) return;
    menu = null;
    target.anchor.focus();
    onremove(target.projectId);
  }

  // `index` is the target position once the dragged Project is removed, so it is
  // computed on the list that no longer contains the source row.
  function targetIndex(ids: string[], sourceId: string, targetId: string, after: boolean): number | null {
    const remaining = ids.filter((id) => id !== sourceId);
    const target = remaining.indexOf(targetId);
    if (target < 0) return null;
    return after ? target + 1 : target;
  }

  function isLowerHalf(event: DragEvent): boolean {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2;
  }

  function dropLineFor(id: string): "above" | "below" | null {
    if (dropTarget?.id !== id) return null;
    return dropTarget.after ? "below" : "above";
  }

  function startDrag(event: DragEvent, id: string): void {
    dragId = id;
    dropTarget = null;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
    }
  }

  function dragOverRow(event: DragEvent, id: string): void {
    if (!dragId || dragId === id) { dropTarget = null; return; }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dropTarget = { id, after: isLowerHalf(event) };
  }

  function dragLeaveRow(event: DragEvent, id: string): void {
    if (dropTarget?.id !== id) return;
    const next = event.relatedTarget;
    const row = event.currentTarget;
    // Moving onto a child of the same row is not leaving it.
    if (next instanceof Node && row instanceof Node && row.contains(next)) return;
    dropTarget = null;
  }

  function clearDrag(): void {
    dragId = null;
    dropTarget = null;
  }

  function dropOnRow(event: DragEvent, id: string): void {
    const source = dragId;
    if (!source) return;
    event.preventDefault();
    const after = dropTarget?.id === id ? dropTarget.after : isLowerHalf(event);
    const index = targetIndex(view.projects.map((project) => project.id), source, id, after);
    clearDrag();
    // The host echoes the new order; the renderer never reorders locally.
    if (index !== null) onmove(source, index);
  }

  function selectSession(id: string): void {
    if (narrow && drawer) closeDrawer();
    onsession(id);
  }

  function openWaitingSession(waitingIds: string[]): void {
    const id = waitingIds[0];
    if (id) selectSession(id);
  }

  function openBackgroundWaiting(): void {
    const id = backgroundWaitingIds[0];
    if (id) selectSession(id);
  }

  function chooseSession(id: string): void {
    if (chooseDetails) chooseDetails.open = false;
    onsession(id);
  }

  function startResize(event: PointerEvent): void {
    const handle = event.currentTarget;
    if (narrow || hidden || event.button !== 0 || !(handle instanceof HTMLElement)) return;
    event.preventDefault();
    handle.focus();
    dragging = true;
    resizeStart = { x: event.clientX, width };
    handle.setPointerCapture(event.pointerId);
  }

  function moveResize(event: PointerEvent): void {
    if (!dragging || !resizeStart) return;
    width = clampWidth(resizeStart.width + event.clientX - resizeStart.x);
  }

  function finishResize(event: PointerEvent): void {
    if (!dragging) return;
    const handle = event.currentTarget;
    dragging = false;
    resizeStart = null;
    if (handle instanceof HTMLElement && handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    commitSidebar();
  }

  function resizeKeyDown(event: KeyboardEvent): void {
    if (narrow || hidden) return;
    const delta = event.key === "ArrowLeft" ? -KEY_STEP : event.key === "ArrowRight" ? KEY_STEP : 0;
    if (delta === 0 && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    keyboardDirty = true;
    width = event.key === "Home" ? MIN_WIDTH : event.key === "End" ? MAX_WIDTH : clampWidth(width + delta);
  }

  function resizeKeyUp(event: KeyboardEvent): void {
    if (!keyboardDirty || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    keyboardDirty = false;
    commitSidebar();
  }

  function resizeBlur(): void {
    if (!keyboardDirty) return;
    keyboardDirty = false;
    commitSidebar();
  }
</script>

<div
  class="desktop-shell"
  data-narrow={narrow ? "true" : "false"}
  data-hidden={hidden ? "true" : "false"}
  data-drawer={drawer ? "open" : "closed"}
  style={`--sidebar-width: ${width}px`}
  bind:this={shell}
>
  <aside id="desktop-projects" class="sidebar" aria-label="Projects" inert={!sidebarAvailable}>
    <div class="sidebar-head">
      <span class="sidebar-title">Projects</span>
      <button type="button" class="icon-button" title="Add Project" aria-label="Add Project" onclick={onadd}>
        <span class="codicon codicon-add" aria-hidden="true"></span>
      </button>
      {#if narrow}
        <button type="button" class="icon-button" title="Close Projects" aria-label="Close Projects" bind:this={drawerClose} onclick={closeDrawer}>
          <span class="codicon codicon-close" aria-hidden="true"></span>
        </button>
      {/if}
    </div>

    <div class="project-list" role={view.projects.length > 0 ? "list" : undefined}>
      {#each view.projects as project (project.id)}
        {@const activity = activityFor(project.id)}
        {@const dropLine = dropLineFor(project.id)}
        <div class="project-row" role="listitem" class:active={project.id === view.activeProjectId}
          class:dragging={dragId === project.id}
          class:drop-above={dropLine === "above"}
          class:drop-below={dropLine === "below"}
          draggable="true"
          ondragstart={(event) => startDrag(event, project.id)}
          ondragover={(event) => dragOverRow(event, project.id)}
          ondragleave={(event) => dragLeaveRow(event, project.id)}
          ondrop={(event) => dropOnRow(event, project.id)}
          ondragend={clearDrag}>
          <button type="button" class="project-select" title={project.cwd}
            aria-current={project.id === view.activeProjectId ? "true" : undefined}
            onclick={() => selectProject(project.id)}>
            <span class="codicon codicon-folder" aria-hidden="true"></span>
            <span class="project-copy">
              <span class="project-name">{project.name}</span>
              <span class="project-meta">{countsLabel(activity)}</span>
            </span>
          </button>
          <div class="project-actions">
            {#if activity.waitingSessionIds.length > 0}
              <button type="button" class="waiting-button"
                title={`${activity.waitingSessionIds.length} session${activity.waitingSessionIds.length === 1 ? "" : "s"} waiting for input`}
                aria-label={`${activity.waitingSessionIds.length} session${activity.waitingSessionIds.length === 1 ? "" : "s"} waiting for input; open the first`}
                onclick={() => openWaitingSession(activity.waitingSessionIds)}>
                <span class="codicon codicon-warning" aria-hidden="true"></span>
                <span>{activity.waitingSessionIds.length}</span>
              </button>
            {/if}
            <button type="button" class="icon-button row-action" title="Project actions"
              aria-label={`Project actions for ${project.name}`} aria-haspopup="menu" aria-expanded={menuFor(project.id)}
              onclick={(event) => toggleMenu(event.currentTarget, project)}>
              <span class="codicon codicon-ellipsis" aria-hidden="true"></span>
            </button>
          </div>
        </div>
      {:else}
        <p class="empty-projects">No Projects yet.</p>
      {/each}
    </div>

    <div class="sidebar-footer">
      {#if view.stateError}<p class="state-error" role="alert">{view.stateError}</p>{/if}
      {#if error}<p class="state-error" role="alert">{error}</p>{/if}
      {#if resume && !resume.visible}
        <button type="button" class="resume-return" onclick={() => { if (resume) onresume(resume.id); }}>
          <span class="codicon codicon-history" aria-hidden="true"></span>
          <span>Return to Resume{#if resume.phase === "failed"} · Needs attention{/if}</span>
        </button>
      {/if}
      <div class="footer-actions">
        <button type="button" class="settings-button" onclick={onsettings}>
          <span class="codicon codicon-settings-gear" aria-hidden="true"></span><span>Settings</span>
        </button>
        <button type="button" class="theme-button" title={themeAction} aria-label={themeAction} disabled={themeBusy} onclick={ontheme}>
          <span class="codicon codicon-color-mode" aria-hidden="true"></span>
        </button>
      </div>
    </div>
  </aside>

  <!-- Interactive splitter: focusable and adjustable with arrows/Home/End. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div class="resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize Projects sidebar"
    aria-controls="desktop-projects" aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH}
    aria-valuenow={width} aria-valuetext={`${width} pixels`} tabindex="0"
    onpointerdown={startResize} onpointermove={moveResize} onpointerup={finishResize}
    onpointercancel={finishResize} onkeydown={resizeKeyDown} onkeyup={resizeKeyUp} onblur={resizeBlur}
  ></div>

  <div class="workspace" inert={narrow && drawer}>
    <div class="project-bar">
      <button type="button" class="bar-button" class:restore={!sidebarAvailable}
        aria-controls="desktop-projects" aria-expanded={narrow ? drawer : !hidden}
        aria-label={projectsAriaLabel} title={projectsAriaLabel}
        bind:this={projectsButton} onclick={toggleSidebar}>
        <span class="codicon codicon-layout-sidebar-left" aria-hidden="true"></span><span>{projectsLabel}</span>
      </button>

      {#if !sidebarAvailable && backgroundWaitingIds.length > 0}
        <button type="button" class="attention-button"
          aria-label={`${backgroundWaitingIds.length} background session${backgroundWaitingIds.length === 1 ? "" : "s"} waiting for input; open the first`}
          title={`${backgroundWaitingIds.length} background session${backgroundWaitingIds.length === 1 ? "" : "s"} waiting for input`}
          onclick={openBackgroundWaiting}>
          <span class="codicon codicon-warning" aria-hidden="true"></span><span>{backgroundWaitingIds.length}</span>
          {#if !narrow}<span class="attention-label">needs input</span>{/if}
        </button>
      {/if}

      {#if showChoose}
        <details class="choose" bind:this={chooseDetails}>
          <summary class="bar-button choose-trigger" aria-label="Choose a session" title="Choose a session">
            <span class="codicon codicon-comment-discussion" aria-hidden="true"></span>
            {#if !narrow}<span>Choose session</span>{/if}
            <span class="codicon codicon-chevron-down" aria-hidden="true"></span>
          </summary>
          <div class="choose-popover" role="dialog" aria-label="Choose a session">
            <p class="choose-title">Open a session in {activeProject?.name}</p>
            {#each sessions as session (session.id)}
              <button type="button" class="choose-item" onclick={() => chooseSession(session.id)}>
                <span class={sessionDotClass(session)} aria-hidden="true"></span>
                <span class="choose-session-title">{session.title}</span>
                <span class="choose-status">{sessionStatusLabel(session)}</span>
                {#if session.requiresUserInput}<span class="codicon codicon-warning" aria-hidden="true"></span>{/if}
              </button>
            {/each}
          </div>
        </details>
      {/if}

      <button type="button" class="project-context"
        aria-haspopup="menu" aria-expanded={menu !== null && menu.anchor === contextButton}
        aria-describedby={tooltipVisible ? "project-path-tooltip" : undefined}
        disabled={!activeProject} aria-label={activeProject ? `Project ${activeProject.name}` : "No Project"}
        bind:this={contextButton}
        onmouseenter={() => tooltip = true} onmouseleave={() => tooltip = false}
        onfocus={() => tooltip = true} onblur={() => tooltip = false}
        onclick={() => { if (activeProject && contextButton) toggleMenu(contextButton, activeProject); }}>
        <span class="codicon codicon-folder context-icon" aria-hidden="true"></span>
        <span class="context-name">{activeProject?.name ?? "No Project"}</span>
        <span class="codicon codicon-chevron-down context-chevron" aria-hidden="true"></span>
      </button>
      {#if tooltipVisible && activeProject}
        <div class="project-tooltip" id="project-path-tooltip" role="tooltip">
          <span class="tip-line"><span class="tip-label">Project</span><span class="tip-path">{activeProject.cwd}</span></span>
          {#if differentDirectory}
            <span class="tip-line"><span class="tip-label">Pi</span><span class="tip-path">{differentDirectory}</span></span>
          {/if}
        </div>
      {/if}
    </div>

    <div class="client-region">{@render children()}</div>
  </div>

  {#if narrow && drawer}
    <button type="button" class="drawer-scrim" tabindex="-1" aria-label="Close Projects" onclick={closeDrawer}></button>
  {/if}

  <!-- Mounted at shell level: `position: fixed` cannot escape the transformed drawer or a scrolled row list. -->
  {#if menu}
    <!-- Keyed by anchor: switching triggers without a pointer event must remount, not reuse the old position. -->
    {#key menu.anchor}
      <ProjectActionMenu anchor={menu.anchor} projectName={menu.projectName}
        actions={projectActions} onaction={runMenuAction} onremove={runMenuRemove} onclose={() => menu = null} />
    {/key}
  {/if}
</div>

<style>
  .desktop-shell {
    position: relative; height: 100%; min-width: 0; min-height: 0;
    display: grid; grid-template-columns: var(--sidebar-width) 5px minmax(0, 1fr);
    overflow: hidden; isolation: isolate;
    color: var(--frost-text); background: var(--frost-bg);
    font-family: var(--font-ui); font-size: var(--font-size-ui);
  }
  .desktop-shell[data-hidden="true"]:not([data-narrow="true"]),
  .desktop-shell[data-narrow="true"] { grid-template-columns: minmax(0, 1fr); }
  .desktop-shell[data-hidden="true"]:not([data-narrow="true"]) .sidebar { display: none; }

  .sidebar { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--frost-bg); }
  .desktop-shell[data-narrow="true"] .sidebar {
    position: absolute; inset: 0 auto 0 0; z-index: 50;
    width: min(var(--sidebar-width), calc(100% - 32px));
    border-right: 1px solid var(--frost-border); box-shadow: 18px 0 40px rgba(0,0,0,.35);
    transform: translateX(-100%); transition: transform 160ms ease;
  }
  .desktop-shell[data-narrow="true"][data-drawer="open"] .sidebar { transform: translateX(0); }

  .sidebar-head { flex: none; display: flex; align-items: center; gap: 2px; padding: 6px 6px 4px 10px; }
  .sidebar-title {
    flex: 1; min-width: 0; color: var(--frost-faint); font-size: calc(var(--font-size-ui) - 3px); font-weight: 600;
    letter-spacing: .08em; text-transform: uppercase;
  }
  .project-list {
    flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 2px;
    padding: 2px 6px 6px; overflow-y: auto; overflow-x: hidden; scrollbar-color: var(--frost-scrollbar) transparent;
  }
  .project-row { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: stretch; border-radius: 5px; flex: none; }
  .project-row:hover { background: var(--frost-hover); }
  .project-row.active { background: var(--frost-active); }
  .project-row.active::before {
    content: ""; position: absolute; left: 0; top: 6px; bottom: 6px; width: 2px;
    border-radius: 2px; background: var(--frost-focus);
  }
  .project-row.dragging { opacity: .35; }
  .project-row.drop-above::after, .project-row.drop-below::after {
    content: ""; position: absolute; left: 4px; right: 4px; height: 2px;
    border-radius: 2px; background: var(--frost-focus); pointer-events: none;
  }
  .project-row.drop-above::after { top: -1px; }
  .project-row.drop-below::after { bottom: -1px; }
  .project-select {
    min-width: 0; display: flex; align-items: flex-start; gap: 7px; padding: 6px 4px 6px 8px;
    border-radius: 5px; background: transparent; color: var(--frost-text); text-align: left; cursor: pointer;
  }
  .project-select > .codicon { flex: none; margin-top: 1px; color: var(--frost-muted); font-size: 14px; }
  .project-row.active .project-select > .codicon { color: var(--frost-link); }
  .project-copy { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .project-name {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--frost-text); font-size: var(--font-size-compact); font-weight: 500; line-height: 1.3;
  }
  .project-row.active .project-name { font-weight: 600; }
  .project-meta {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--frost-faint); font-size: calc(var(--font-size-ui) - 3.5px); line-height: 1.3;
  }
  .project-actions { display: flex; align-items: center; padding-right: 3px; }
  .row-action { color: var(--frost-muted); opacity: 0; pointer-events: none; }
  .project-row:hover .row-action,
  .row-action:focus-visible,
  .row-action[aria-expanded="true"] { opacity: 1; pointer-events: auto; }
  .row-action[aria-expanded="true"] { color: var(--frost-text); background: var(--frost-hover); }
  .waiting-button {
    align-self: center; display: inline-flex; align-items: center; gap: 3px; min-height: 20px;
    margin: 0 4px 0 1px; padding: 0 4px; border-radius: 3px;
    color: var(--frost-warning); background: transparent; font-size: calc(var(--font-size-ui) - 3.5px); font-weight: 600; cursor: pointer;
  }
  .waiting-button:hover { background: color-mix(in srgb, var(--frost-warning) 16%, transparent); }
  .waiting-button .codicon { font-size: 12px; }
  .empty-projects { padding: 6px 8px; color: var(--frost-faint); font-size: var(--font-size-detail); }

  .sidebar-footer {
    flex: none; display: flex; flex-direction: column; gap: 4px;
    padding: 6px; border-top: 1px solid var(--frost-border-soft);
  }
  .state-error { margin: 2px 3px; color: var(--frost-error); font-size: calc(var(--font-size-ui) - 3px); line-height: 1.4; overflow-wrap: anywhere; }
  .resume-return, .settings-button {
    display: flex; align-items: center; gap: 6px; padding: 6px 7px;
    border-radius: 4px; background: transparent; text-align: left; cursor: pointer;
  }
  .resume-return { border: 1px solid var(--frost-border); color: var(--frost-link); font-size: calc(var(--font-size-ui) - 2.5px); }
  .resume-return:hover { background: var(--frost-hover); }
  .footer-actions { display: flex; align-items: center; gap: 4px; }
  .settings-button { flex: 1; color: var(--frost-muted); font-size: calc(var(--font-size-ui) - 1.5px); }
  .theme-button { display: grid; place-items: center; flex: none; width: 30px; height: 30px; border-radius: 4px; color: var(--frost-muted); background: transparent; cursor: pointer; }
  .settings-button:hover, .theme-button:hover:not(:disabled) { background: var(--frost-hover); color: var(--frost-text); }
  .theme-button:disabled { opacity: .5; cursor: default; }
  .resume-return .codicon, .settings-button .codicon { flex: none; font-size: 13px; }

  .resize-handle { position: relative; z-index: 1; min-height: 0; cursor: col-resize; touch-action: none; }
  .resize-handle::before {
    content: ""; position: absolute; top: 0; bottom: 0; left: 2px; width: 1px;
    background: var(--frost-border); transition: background 120ms ease;
  }
  .resize-handle:hover::before, .resize-handle:focus-visible::before { background: var(--frost-focus); }
  .resize-handle:focus-visible { outline: 1px solid var(--frost-focus); outline-offset: -1px; }
  .desktop-shell[data-hidden="true"] .resize-handle,
  .desktop-shell[data-narrow="true"] .resize-handle { display: none; }

  .workspace {
    position: relative; min-width: 0; min-height: 0; overflow: hidden;
    display: grid; grid-template-rows: auto minmax(0, 1fr); background: var(--frost-bg);
  }
  .project-bar {
    position: relative; z-index: 30; display: flex; align-items: center; gap: 8px;
    min-width: 0; min-height: 36px; padding: 4px 10px;
    border-bottom: 1px solid var(--frost-border-soft);
    background: color-mix(in srgb, var(--frost-bg) 94%, var(--frost-surface)); font-size: calc(var(--font-size-ui) - 1.5px);
  }
  .bar-button {
    flex: none; min-height: 24px; display: inline-flex; align-items: center; gap: 5px;
    padding: 0 6px; border-radius: 4px; color: var(--frost-muted); background: transparent;
    white-space: nowrap; cursor: pointer; font-size: calc(var(--font-size-ui) - 1.5px);
  }
  .bar-button:hover { color: var(--frost-text); background: var(--frost-hover); }
  .bar-button.restore { color: var(--frost-text); background: var(--frost-hover); box-shadow: inset 0 0 0 1px var(--frost-border); }
  .bar-button .codicon { font-size: 14px; }
  .attention-button {
    flex: none; min-height: 22px; display: inline-flex; align-items: center; gap: 4px;
    padding: 0 6px; border: 1px solid color-mix(in srgb, var(--frost-warning) 40%, transparent);
    border-radius: 99px; color: var(--frost-warning); background: color-mix(in srgb, var(--frost-warning) 12%, transparent);
    font-size: calc(var(--font-size-ui) - 3px); font-weight: 600; white-space: nowrap; cursor: pointer;
  }
  .attention-button:hover { background: color-mix(in srgb, var(--frost-warning) 20%, transparent); }
  .attention-button .codicon { font-size: 12px; }
  .attention-label { font-weight: 500; }
  .project-context {
    flex: 0 1 auto; min-width: 0; max-width: min(60%, 480px); margin-left: auto;
    display: flex; align-items: center; gap: 5px; min-height: 24px; padding: 0 5px 0 7px;
    border-radius: 4px; color: var(--frost-text); background: transparent;
    font-size: calc(var(--font-size-ui) - 1.5px); text-align: left; cursor: pointer;
  }
  .project-context:hover:not(:disabled), .project-context[aria-expanded="true"] { background: var(--frost-hover); }
  .project-context:focus-visible { outline: 1px solid var(--frost-focus); outline-offset: -1px; }
  .project-context:disabled { cursor: default; }
  .context-icon { flex: none; color: var(--frost-muted); font-size: 14px; line-height: 1; }
  .context-name {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--frost-text); font-size: calc(var(--font-size-ui) - 1.5px); font-weight: 600; line-height: max(16px, 1.3em);
  }
  .context-chevron { flex: none; color: var(--frost-faint); font-size: 12px; }
  .project-tooltip {
    position: absolute; top: calc(100% + 3px); right: 10px; z-index: 60;
    max-width: min(460px, calc(100% - 20px)); padding: 5px 8px;
    display: flex; flex-direction: column; gap: 1px;
    border: 1px solid var(--frost-border); border-radius: 5px;
    background: var(--frost-surface-raised); box-shadow: var(--frost-shadow);
    font-size: calc(var(--font-size-ui) - 3.5px); line-height: 1.45; pointer-events: none;
  }
  .tip-line { min-width: 0; display: flex; align-items: baseline; gap: 6px; }
  .tip-label { flex: none; color: var(--frost-muted); }
  .tip-path { min-width: 0; color: var(--frost-text); font-family: var(--font-mono); overflow-wrap: anywhere; }
  .choose { flex: none; }
  .choose summary { list-style: none; }
  .choose summary::-webkit-details-marker { display: none; }
  .choose-trigger { gap: 4px; padding-inline: 5px; font-size: var(--font-size-detail); }
  .choose-trigger .codicon { font-size: 13px; }
  .choose[open] .choose-trigger { color: var(--frost-text); background: var(--frost-hover); }
  .choose-popover {
    position: absolute; top: calc(100% + 4px); left: 8px; z-index: 10;
    width: min(320px, calc(100% - 16px)); max-height: min(360px, calc(100vh - 80px));
    overflow-y: auto; padding: 4px; border: 1px solid var(--frost-border); border-radius: 6px;
    background: var(--frost-surface-raised); box-shadow: var(--frost-shadow);
  }
  .choose-title { padding: 5px 7px; color: var(--frost-muted); font-size: calc(var(--font-size-ui) - 3px); }
  .choose-item {
    width: 100%; display: flex; align-items: center; gap: 6px; padding: 6px 7px;
    border-radius: 4px; background: transparent; color: var(--frost-text); text-align: left;
    font-size: calc(var(--font-size-ui) - 1.5px); cursor: pointer;
  }
  .choose-item:hover, .choose-item:focus-visible { background: var(--frost-hover); }
  .choose-session-title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .choose-status { flex: none; color: var(--frost-faint); font-size: calc(var(--font-size-ui) - 3.5px); }
  .choose-item > .codicon-warning { flex: none; color: var(--frost-warning); font-size: 12px; }

  .client-region { --frost-bg: var(--vscode-editor-background); position: relative; min-width: 0; min-height: 0; overflow: hidden; }
  .drawer-scrim {
    position: absolute; inset: 0; z-index: 40; padding: 0; border: 0;
    background: rgba(0, 0, 0, .45); cursor: pointer;
  }
  @media (max-width: 640px) {
    .project-bar { gap: 4px; padding-inline: 6px; }
    .bar-button, .choose-trigger { padding-inline: 5px; }
  }
  @media (prefers-reduced-motion: reduce) { .sidebar { transition: none; } }
</style>
