<script lang="ts">
  import { onMount } from "svelte";
  import type { SessionSummaryView, SessionViewModel } from "$shared/model/sessionViewModel";

  import { postToHost } from "../../bridge/vscodeBridge";
  import { draftForHost } from "../composer/composerDraftSync";
  import IconButton from "../../primitives/IconButton.svelte";
  import StatusDot from "./StatusDot.svelte";
  import SessionList from "./SessionList.svelte";

  let { sessions, active }: { sessions: SessionSummaryView[]; active: SessionViewModel } = $props();
  let editing = $state(false);
  let titleDraft = $state("");
  let menuOpen = $state(false);
  let launcherOpen = $state(false);
  let temporaryMode = $state(false);
  let sessionListOpen = $state(false);
  let extensionsMenuOpen = $state(false);
  let hidden = $state(false);
  let titleInput = $state<HTMLInputElement | null>(null);
  let root = $state<HTMLElement | null>(null);

  const needsAttention = $derived(sessions.some((session) => session.requiresUserInput));
  const backgroundRuns = $derived(sessions.filter((session) => session.id !== active.id && session.status === "running").length);

  $effect(() => {
    if (editing) requestAnimationFrame(() => titleInput?.focus());
  });

  onMount(() => {
    const closeMenus = (event: PointerEvent): void => {
      if (root?.contains(event.target as Node)) return;
      menuOpen = false;
      launcherOpen = false;
      sessionListOpen = false;
      extensionsMenuOpen = false;
    };
    document.addEventListener("pointerdown", closeMenus);
    return () => document.removeEventListener("pointerdown", closeMenus);
  });

  function closeMenus(): void {
    menuOpen = false;
    launcherOpen = false;
    sessionListOpen = false;
    extensionsMenuOpen = false;
  }

  function toggleExtensionsMenu(): void {
    extensionsMenuOpen = !extensionsMenuOpen;
  }

  function beginRename(): void {
    titleDraft = active.title;
    editing = true;
    closeMenus();
  }

  function commitRename(): void {
    const name = titleDraft.trim();
    if (name && name !== active.title) postToHost({ type: "renameSession", sessionId: active.id, name });
    editing = false;
  }

  function createSession(): void {
    const ephemeral = temporaryMode;
    temporaryMode = false;
    closeMenus();
    postToHost({ type: "createSession", ...(ephemeral ? { ephemeral: true } : {}) });
  }

  function resumeSession(): void {
    closeMenus();
    postToHost({ type: "resumeSession" });
  }

  function selectSession(sessionId: string): void {
    closeMenus();
    if (sessionId !== active.id) postToHost({ type: "activateSession", sessionId });
  }

  function closeSession(sessionId: string): void {
    closeMenus();
    postToHost({ type: "closeSession", sessionId });
  }

  function openSessionPanel(sessionId?: string): void {
    const targetId = sessionId ?? active.id;
    closeMenus();
    postToHost({ type: "openSessionPanel", sessionId: targetId, draft: draftForHost(targetId) });
  }

  function activeStatusLabel(): string {
    if (active.pendingExtensionUi.length > 0) return "action required";
    if (active.isForking) return "forking session";
    if (active.isNavigatingTree) return active.isSummarizingTree ? "summarizing branch" : "switching branch";
    if (active.isCompacting) return "compacting context";
    if (active.status === "queued") return "waiting to start";
    if (active.historyStatus === "queued") return "waiting for history";
    if (active.historyStatus === "loading") return "loading history";
    if (active.status === "running") {
      if (active.historyStatus === "deferred") return "running · history not loaded";
      if (active.historyStatus === "failed") return "running · history load failed";
      return "running";
    }
    if (active.historyStatus === "deferred") return "history not loaded";
    if (active.historyStatus === "failed") return "history load failed";
    if (active.status === "ready") return "ready";
    return active.status;
  }
</script>

<svelte:window onkeydown={(event) => {
  if (event.key !== "Escape") return;
  closeMenus();
  editing = false;
}} />

<div class="session-header-slot">
{#if hidden}
  <button
    class="session-header-restore"
    class:attention={needsAttention}
    type="button"
    aria-label="Show session bar"
    title={needsAttention ? "Show session bar — a session needs input" : "Show session bar"}
    onclick={() => hidden = false}
  >
    <span class="codicon codicon-comment-discussion" aria-hidden="true"></span>
    {#if needsAttention}<span class="session-header-badge"></span>{:else if backgroundRuns > 0}<span class="session-header-count">{backgroundRuns}</span>{/if}
  </button>
{:else}
  <header class="session-header" bind:this={root}>
    <div class="session-picker-wrap">
      {#if editing}
        <div class="session-heading">
          <StatusDot status={active.status} />
          <input
            class="session-title-input"
            bind:this={titleInput}
            bind:value={titleDraft}
            aria-label="Session name"
            onkeydown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") editing = false;
            }}
            onblur={commitRename}
          />
        </div>
      {:else}
        <button
          class="session-heading"
          class:active={sessionListOpen}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={sessionListOpen}
          title={active.cwd}
          onclick={() => { sessionListOpen = !sessionListOpen; menuOpen = false; launcherOpen = false; }}
        >
          <StatusDot status={active.status} />
          <span class="session-title">{active.title}</span>
          {#if active.isEphemeral}<span class="ephemeral-badge">临时</span>{/if}
          <span class="session-inline-status">
            {#if active.workingDirectoryLabel}
              <span class="session-cwd-pill" title={active.cwd}>{active.workingDirectoryLabel}</span>
            {/if}
            <span>· {activeStatusLabel()}</span>
          </span>
          <span class="codicon codicon-chevron-down session-heading-chevron" aria-hidden="true"></span>
        </button>
      {/if}
      {#if sessionListOpen}
        <SessionList
          {sessions}
          activeId={active.id}
          onselect={selectSession}
          onclose={closeSession}
          onexternalize={openSessionPanel}
          oncreate={createSession}
          onresume={resumeSession}
        />
      {/if}
    </div>

    <div class="session-actions">
      <div class="session-menu-wrap">
        <IconButton icon="add" label="New or resume session" active={launcherOpen} onclick={() => { launcherOpen = !launcherOpen; menuOpen = false; sessionListOpen = false; }} />
        {#if launcherOpen}
          <div class="session-menu session-launcher-menu">
            <button type="button" onclick={createSession}>
              <span class="codicon codicon-add"></span><span><strong>{temporaryMode ? "New temporary session" : "New session"}</strong><small>{temporaryMode ? "Start a conversation that is never saved" : "Start a clean Pi conversation"}</small></span>
            </button>
            <button type="button" onclick={resumeSession}>
              <span class="codicon codicon-history"></span><span><strong>Resume session</strong><small>Open an existing Pi conversation</small></span>
            </button>
            <label class="temporary-mode-toggle">
              <span><strong>Temporary mode</strong><small>Do not save this conversation</small></span>
              <input type="checkbox" bind:checked={temporaryMode} />
            </label>
          </div>
        {/if}
      </div>
      <div class="session-menu-wrap">
        <IconButton icon="ellipsis" label="Session actions" active={menuOpen} onclick={() => { menuOpen = !menuOpen; launcherOpen = false; sessionListOpen = false; }} />
        {#if menuOpen}
          <div class="session-menu">
            <button type="button" onclick={() => openSessionPanel()}><span class="codicon codicon-layout"></span> Open in editor tab</button>
            <button type="button" onclick={beginRename}><span class="codicon codicon-edit"></span> Rename</button>
            {#if active.historyStatus === "deferred" || active.historyStatus === "failed"}
              <button type="button" onclick={() => { closeMenus(); postToHost({ type: "loadHistory", sessionId: active.id }); }}><span class="codicon codicon-history"></span> Load conversation history</button>
            {/if}
            <button type="button" disabled={active.isEphemeral} title={active.isEphemeral ? "Temporary sessions cannot be restarted" : undefined} onclick={() => { closeMenus(); postToHost({ type: "restartSession", sessionId: active.id }); }}><span class="codicon codicon-debug-restart"></span> Restart session</button>
            {#if active.sessionFile}
              <button
                type="button"
                title={`Copy session file: ${active.sessionFile}`}
                onclick={() => { closeMenus(); postToHost({ type: "copyText", text: active.sessionFile! }); }}
              >
                <span class="codicon codicon-copy"></span>
                <span><strong>Session file</strong><small class="session-file-path">{active.sessionFile}</small></span>
              </button>
            {/if}
            <button type="button" onclick={() => { closeMenus(); postToHost({ type: "openProxySettings" }); }}>
              <span class="codicon codicon-globe"></span>
              <span><strong>Network & proxy</strong><small>{active.networkProxy.restartRequired ? active.isEphemeral ? "Restart unavailable · temporary session is not saved" : `${active.networkProxy.pendingLabel ?? active.networkProxy.label} · restart required` : active.networkProxy.label}</small></span>
            </button>
            <div class="session-submenu-wrap">
              <button
                type="button"
                class="session-submenu-trigger"
                class:active={extensionsMenuOpen}
                aria-haspopup="true"
                aria-expanded={extensionsMenuOpen}
                onclick={toggleExtensionsMenu}
              >
                <span class="codicon codicon-extensions"></span>
                <span><strong>FrostPi extensions</strong></span>
                <span
                  class="codicon session-submenu-chevron"
                  class:codicon-chevron-right={!extensionsMenuOpen}
                  class:codicon-chevron-down={extensionsMenuOpen}
                  aria-hidden="true"
                ></span>
              </button>
              {#if extensionsMenuOpen}
                <div class="session-menu session-submenu">
                  <button type="button" onclick={() => { closeMenus(); postToHost({ type: "checkPiIntegration", sessionId: active.id }); }}>
                    <span class="codicon codicon-list-tree"></span>
                    <span><strong>Session tree adapter</strong><small>{active.sessionTreeAvailable ? "Connected" : "Unavailable"}</small></span>
                  </button>
                  <button type="button" onclick={() => { closeMenus(); postToHost({ type: "openSettings" }); }}>
                    <span class="codicon codicon-question"></span>
                    <span>
                      <strong>Question tool</strong>
                      <small>
                        {active.questionTool.restartRequired
                          ? active.isEphemeral
                            ? "Restart unavailable · temporary session is not saved"
                            : `${active.questionTool.configuredEnabled ? "Enable" : "Disable"} after restart`
                          : active.questionTool.appliedEnabled ? "Enabled for this process" : "Disabled"}
                      </small>
                    </span>
                  </button>
                </div>
              {/if}
            </div>
            <button type="button" onclick={() => { closeMenus(); postToHost({ type: "refreshCommands", sessionId: active.id }); }}><span class="codicon codicon-refresh"></span> Refresh commands</button>
            <button type="button" onclick={() => { closeMenus(); postToHost({ type: "exportDiagnostics" }); }}><span class="codicon codicon-save"></span> Export diagnostics</button>
            <div class="menu-separator"></div>
            <button class="danger" type="button" onclick={() => closeSession(active.id)}><span class="codicon codicon-close"></span> Close session</button>
          </div>
        {/if}
      </div>
      <IconButton icon="chevron-up" label="Hide session bar" onclick={() => { closeMenus(); hidden = true; }} />
    </div>
  </header>
{/if}
</div>

<style>
  .session-file-path { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .session-menu button:disabled { opacity: .5; cursor: default; }
  .ephemeral-badge { flex: 0 0 auto; padding: 1px 4px; border: 1px solid var(--frost-border); border-radius: 4px; color: var(--frost-muted); font-size: 9px; line-height: 1.2; }
  .temporary-mode-toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 9px; border-top: 1px solid var(--frost-border); cursor: pointer; }
  .temporary-mode-toggle > span { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .temporary-mode-toggle strong { font-size: 11px; font-weight: 500; }
  .temporary-mode-toggle small { color: var(--frost-muted); font-size: 9.5px; }
  .temporary-mode-toggle input { margin: 0; accent-color: var(--frost-accent); }
</style>
