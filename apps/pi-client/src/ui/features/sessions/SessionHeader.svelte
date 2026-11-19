<script lang="ts">
  import { onMount } from "svelte";
  import type { SessionSummaryView, SessionViewModel } from "$shared/model/sessionViewModel";

  import { postToHost } from "../../bridge/hostBridge";
  import { clientCapabilities } from "../../state/clientCapabilities.svelte";
  import { showToast } from "../../state/sessionViewStore.svelte";
  import { draftForHost } from "../composer/composerDraftSync";
  import { isQueuedPromptRecoveryPending } from "../composer/queuedPromptRecoveryStore.svelte";
  import IconButton from "../../primitives/IconButton.svelte";
  import StatusDot from "./StatusDot.svelte";
  import SessionList, { STOP_PI_PROCESS_TITLE } from "./SessionList.svelte";
  import { sessionStatusLabel } from "./sessionStatusLabel";

  let { sessions, active }: { sessions: SessionSummaryView[]; active: SessionViewModel } = $props();
  let editing = $state(false);
  let titleDraft = $state("");
  let menuOpen = $state(false);
  let launcherOpen = $state(false);
  let sessionListOpen = $state(false);
  let extensionsMenuOpen = $state(false);
  let hidden = $state(false);
  let titleInput = $state<HTMLInputElement | null>(null);
  let root = $state<HTMLElement | null>(null);

  const needsAttention = $derived(sessions.some((session) => session.requiresUserInput));
  const backgroundRuns = $derived(sessions.filter((session) => session.id !== active.id && session.status === "running").length);
  const editorTabs = $derived($clientCapabilities.sessionEditorTabs);
  const processChanging = $derived(active.status === "queued" || active.status === "starting" || active.status === "stopping");

  $effect(() => {
    if (editing) requestAnimationFrame(() => titleInput?.focus());
  });

  onMount(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (root?.contains(event.target as Node)) return;
      closeMenus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
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
    // Enter or Escape removes the input, whose blur must not commit a second time.
    if (!editing) return;
    const name = titleDraft.trim();
    if (name && name !== active.title) postToHost({ type: "renameSession", sessionId: active.id, name });
    editing = false;
  }

  function createSession(): void {
    closeMenus();
    postToHost({ type: "createSession" });
  }

  function createTemporarySession(): void {
    closeMenus();
    postToHost({ type: "createSession", ephemeral: true });
  }

  function createSessionWithArguments(): void {
    closeMenus();
    postToHost({ type: "createSessionWithArguments" });
  }

  function createSessionPanel(ephemeral = false): void {
    closeMenus();
    postToHost(ephemeral ? { type: "createSessionPanel", ephemeral: true } : { type: "createSessionPanel" });
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

  function stopSession(sessionId: string): void {
    closeMenus();
    postToHost({ type: "stopSession", sessionId });
  }

  function restartSession(sessionId: string): void {
    closeMenus();
    postToHost({ type: "restartSession", sessionId });
  }

  function deleteSession(sessionId: string): void {
    closeMenus();
    postToHost({ type: "deleteSession", sessionId });
  }

  function openSessionPanel(sessionId?: string): void {
    const targetId = sessionId ?? active.id;
    // Do not hand a possibly stale Webview draft to a new panel before its recovery result merges.
    if (isQueuedPromptRecoveryPending(targetId)) {
      closeMenus();
      showToast("info", "Wait for the pending message recovery to finish before opening this Session in an editor tab.");
      return;
    }
    closeMenus();
    postToHost({ type: "openSessionPanel", sessionId: targetId, draft: draftForHost(targetId) });
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
            maxlength="160"
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
          ondblclick={beginRename}
        >
          <StatusDot status={active.status} />
          <span class="session-title">{active.title}</span>
          {#if active.isEphemeral}<span class="ephemeral-badge">Temporary</span>{/if}
          <span class="session-inline-status">
            {#if active.workingDirectoryLabel}
              <span class="session-cwd-pill" title={active.cwd}>{active.workingDirectoryLabel}</span>
            {/if}
            <span>· {sessionStatusLabel(active)}</span>
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
          onstop={stopSession}
          onrestart={restartSession}
          onexternalize={editorTabs ? openSessionPanel : undefined}
          oncreate={createSession}
          onresume={resumeSession}
        />
      {/if}
    </div>

    <div class="session-actions">
      {#if !editing}
        <IconButton icon="edit" label="Rename session" onclick={beginRename} />
      {/if}
      <div class="session-menu-wrap">
        <IconButton icon="add" label="New or resume session" active={launcherOpen} onclick={() => { launcherOpen = !launcherOpen; menuOpen = false; sessionListOpen = false; }} />
        {#if launcherOpen}
          <div class="session-menu session-launcher-menu">
            <!-- Each way to start has a crossed-eye button beside it for the temporary variant, which is never saved. -->
            <div class="launcher-create-row">
              <button type="button" class="launcher-create" onclick={createSession}>
                <span class="codicon codicon-add"></span><span><strong>New session</strong><small>Start a clean Pi conversation</small></span>
              </button>
              <button type="button" class="launcher-temporary" aria-label="New temporary session" title="New temporary session · never saved" onclick={createTemporarySession}>
                <span class="codicon codicon-eye-closed" aria-hidden="true"></span>
              </button>
            </div>
            {#if editorTabs}
              <div class="launcher-create-row">
                <button type="button" class="launcher-create" onclick={() => createSessionPanel()}>
                  <span class="codicon codicon-layout"></span><span><strong>New session in editor tab</strong><small>Start it directly in its own tab</small></span>
                </button>
                <button type="button" class="launcher-temporary" aria-label="New temporary session in editor tab" title="New temporary session in editor tab · never saved" onclick={() => createSessionPanel(true)}>
                  <span class="codicon codicon-eye-closed" aria-hidden="true"></span>
                </button>
              </div>
            {/if}
            <button type="button" onclick={createSessionWithArguments}>
              <span class="codicon codicon-terminal"></span><span><strong>New session with arguments…</strong><small>Pass extra Pi CLI flags for this launch</small></span>
            </button>
            <button type="button" onclick={resumeSession}>
              <span class="codicon codicon-history"></span><span><strong>Resume session</strong><small>Open an existing Pi conversation</small></span>
            </button>
          </div>
        {/if}
      </div>
      <div class="session-menu-wrap">
        <IconButton icon="ellipsis" label="Session actions" active={menuOpen} onclick={() => { menuOpen = !menuOpen; launcherOpen = false; sessionListOpen = false; }} />
        {#if menuOpen}
          <div class="session-menu">
            {#if editorTabs}
              <button type="button" onclick={() => openSessionPanel()}><span class="codicon codicon-layout"></span> Open in editor tab</button>
            {/if}
            <button type="button" onclick={beginRename}><span class="codicon codicon-edit"></span> Rename</button>
            {#if active.historyStatus === "deferred" || active.historyStatus === "failed"}
              <button type="button" onclick={() => { closeMenus(); postToHost({ type: "loadHistory", sessionId: active.id }); }}><span class="codicon codicon-history"></span> Load conversation history</button>
            {/if}
            <button type="button" disabled={active.isEphemeral} title={active.isEphemeral ? "Temporary sessions cannot be restarted" : "Restart this session's Pi process from its saved history."} onclick={() => restartSession(active.id)}><span class="codicon codicon-debug-restart"></span> Restart Pi process</button>
            {#if active.status !== "stopped" && active.status !== "failed"}
              <button type="button" disabled={active.isEphemeral || processChanging} title={active.isEphemeral ? "A temporary session cannot start again once its Pi process stops" : STOP_PI_PROCESS_TITLE} onclick={() => stopSession(active.id)}><span class="codicon codicon-debug-stop"></span> Stop Pi process</button>
            {/if}
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
            {#if $clientCapabilities.exportDiagnostics}
              <button type="button" onclick={() => { closeMenus(); postToHost({ type: "exportDiagnostics" }); }}><span class="codicon codicon-save"></span> Export diagnostics</button>
            {/if}
            <div class="menu-separator"></div>
            <button class="danger" type="button" onclick={() => closeSession(active.id)}><span class="codicon codicon-close"></span> Close session</button>
            {#if !active.isEphemeral}
              <button class="danger" type="button" title="Delete the session and its Pi session file" onclick={() => deleteSession(active.id)}><span class="codicon codicon-trash"></span> Delete session</button>
            {/if}
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
  .ephemeral-badge { flex: 0 0 auto; padding: 1px 4px; border: 1px solid var(--frost-border); border-radius: 4px; color: var(--frost-muted); font-size: calc(var(--font-size-ui) - 4px); line-height: 1.2; }
  .launcher-create-row { display: flex; align-items: stretch; }
  .launcher-create-row > button { width: auto; }
  .launcher-create { flex: 1 1 auto; }
  .launcher-temporary { flex: 0 0 auto; justify-content: center; padding: 7px 9px; color: var(--frost-muted); }
  .launcher-temporary:hover, .launcher-temporary:focus-visible { color: var(--frost-text); }
</style>
