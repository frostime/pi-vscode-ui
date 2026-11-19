<script lang="ts">
  import type { QueuedPromptAction } from "$shared/bridge/webviewToHost";
  import type { QueuedPromptView } from "$shared/model/conversationModel";
  import type { SessionViewModel } from "$shared/model/sessionViewModel";
  import { onDestroy, onMount } from "svelte";

  import { postToHost } from "../../bridge/hostBridge";
  import NewUpdatesButton from "./scrolling/NewUpdatesButton.svelte";
  import { INITIAL_SCROLL_FOLLOW_STATE, reduceScrollFollow } from "./scrolling/scrollFollowState";
  import { composerDrafts } from "../composer/composerDraftStore.svelte";
  import { queuedPromptRecoveryAction, queuedPromptRecoveryRequests } from "../composer/queuedPromptRecoveryStore.svelte";
  import AgentTurn from "./AgentTurn.svelte";
  import BranchPointControl from "./BranchPointControl.svelte";
  import BranchSummaryBlock from "./BranchSummaryBlock.svelte";
  import CompactionBlock from "./CompactionBlock.svelte";
  import CustomBlock from "./CustomBlock.svelte";
  import SessionNotice from "./SessionNotice.svelte";

  let { session, onrestore, submissionPending = false }: {
    session: SessionViewModel;
    onrestore: () => void;
    /** The displayed Composer has an accepted submission whose result is still outstanding. */
    submissionPending?: boolean;
  } = $props();
  let scroller: HTMLDivElement;
  let content: HTMLDivElement;
  let editDrafts = $state<Record<string, string>>({});
  let followState = $state({ ...INITIAL_SCROLL_FOLLOW_STATE });
  let lastConversationContentRevision = 0;
  let lastTurnCount = 0;
  let programmaticScroll = false;
  let resizeObserver: ResizeObserver | null = null;

  const turnCount = $derived(session.conversationItems.filter((item) => item.type === "turn").length);
  const queuedPrompts = $derived([
    ...session.queuedSteers.map((item) => ({ item, delivery: "Steer" as const })),
    ...session.queuedFollowUps.map((item) => ({ item, delivery: "Queue" as const })),
  ]);
  const editablePrompts = $derived(session.queuedFollowUps.filter((prompt) => prompt.editable));
  const recoveryPending = $derived($queuedPromptRecoveryRequests[session.id] !== undefined);
  const recoveryAction = $derived(queuedPromptRecoveryAction(
    session,
    $composerDrafts[session.id]?.images.length ?? 0,
    recoveryPending,
    submissionPending,
  ));

  const controlsDisabled = $derived(recoveryPending || session.queuedPromptRecovery.state === "recovering"
    || session.isCompacting || session.isForking || session.isNavigatingTree);

  function updatePrompt(prompt: QueuedPromptView, action: QueuedPromptAction): void {
    postToHost({ type: "updateQueuedPrompt", sessionId: session.id, promptId: prompt.id, action });
  }

  function focusEdit(field: HTMLTextAreaElement): void { field.focus(); }

  onMount(() => {
    resizeObserver = new ResizeObserver(() => {
      if (followState.mode === "following") scrollToBottom(false);
    });
    resizeObserver.observe(content);
    requestAnimationFrame(() => scrollToBottom(false));
  });

  onDestroy(() => resizeObserver?.disconnect());

  $effect(() => {
    const contentRevision = session.conversationContentRevision;
    if (!scroller || contentRevision === lastConversationContentRevision) return;
    const isNewTurn = turnCount > lastTurnCount;
    lastConversationContentRevision = contentRevision;
    lastTurnCount = turnCount;
    if (isNewTurn) {
      followState = reduceScrollFollow(followState, { type: "contentUpdate", newTurn: true });
      requestAnimationFrame(() => scrollToBottom(false));
    } else {
      followState = reduceScrollFollow(followState, { type: "contentUpdate", newTurn: false });
      if (followState.mode === "following") requestAnimationFrame(() => scrollToBottom(false));
    }
  });

  function handleScroll(): void {
    if (!scroller) return;
    followState = reduceScrollFollow(followState, {
      type: "userScroll",
      distanceFromBottom: distanceFromBottom(),
      threshold: 64,
      programmatic: programmaticScroll,
    });
  }

  function resumeFollowing(): void {
    followState = reduceScrollFollow(followState, { type: "resume" });
    scrollToBottom(true);
  }

  function scrollToBottom(smooth: boolean): void {
    if (!scroller) return;
    programmaticScroll = true;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    window.setTimeout(() => { programmaticScroll = false; }, smooth ? 220 : 0);
  }

  function distanceFromBottom(): number {
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  }
</script>

<div class="conversation-frame">
  <!-- Some VS Code webview hosts restore Composer focus before copying when the body has
       focus, clearing the transcript selection. Let a selection drag focus this container
       without adding a Tab stop. -->
  <div class="conversation" bind:this={scroller} onscroll={handleScroll} tabindex="-1">
    <div class="conversation-inner" bind:this={content}>
      {#if session.conversationItems.length === 0}
        <div class="conversation-empty">
          <div class="empty-orbit"><span>π</span></div>
          <h2>What are you working on?</h2>
          <p>Ask Pi to inspect code, make changes, run commands, or explain the current project.</p>
        </div>
      {:else}
        {#each session.conversationItems as item (item.id)}
          {#if item.type === "turn"}
            <AgentTurn turn={item} {session} />
          {:else if item.type === "branchControl"}
            <BranchPointControl control={item} {session} />
          {:else if item.type === "compaction"}
            <CompactionBlock compaction={item} />
          {:else if item.type === "branchSummary"}
            <BranchSummaryBlock summary={item} />
          {:else if item.type === "customMessage"}
            <CustomBlock message={item} />
          {:else}
            <SessionNotice notice={item} />
          {/if}
        {/each}
      {/if}
      {#if session.isCompacting || session.isNavigatingTree}
        <div class="session-progress" role="status" aria-live="polite">
          <span class={`codicon ${session.isCompacting ? "codicon-fold" : "codicon-git-branch"}`} aria-hidden="true"></span>
          <span class="session-progress-label">
            {session.isCompacting ? "Compacting context" : session.isSummarizingTree ? "Summarizing branch" : "Switching branch"}
          </span>
          <span class="thinking-pulse" aria-hidden="true"></span>
        </div>
      {/if}
      <div class="conversation-tail" aria-hidden="true"></div>
    </div>
  </div>
  <div class="new-updates-anchor">
    {#if followState.mode === "paused"}<NewUpdatesButton count={followState.unseenUpdates} onclick={resumeFollowing} />{/if}
  </div>
  {#if queuedPrompts.length}
    <section class="queued-follow-ups" aria-label="Queued prompts">
      <div class="pending-head">
        <span class="pending-label">Pending · {queuedPrompts.length}</span>
        <button class="pending-restore" type="button" aria-busy={recoveryAction.busy}
          disabled={!recoveryAction.canRestore || editablePrompts.some((prompt) => prompt.editing)}
          title={recoveryAction.disabledReason ?? "Restore pending messages into the composer"}
          onclick={onrestore}>
          <span class="codicon codicon-history" aria-hidden="true"></span>
          {recoveryAction.busy ? "Restoring…" : "Restore all"}
        </button>
      </div>
      {#if recoveryAction.disabledReason}<p class="pending-reason">{recoveryAction.disabledReason}</p>{/if}
      <ol class="pending-list">
        {#each queuedPrompts as { item: prompt, delivery } (prompt.id)}
          {@const index = editablePrompts.indexOf(prompt)}
          <li class="pending-row">
            {#if prompt.editing}
              <form class="pending-edit" onsubmit={(event) => {
                event.preventDefault();
                updatePrompt(prompt, { kind: "edit", text: editDrafts[prompt.id] ?? prompt.text });
              }}>
                <textarea aria-label="Edit queued message" rows="2" use:focusEdit
                  value={editDrafts[prompt.id] ?? prompt.text}
                  oninput={(event) => { editDrafts[prompt.id] = event.currentTarget.value; }}
                  onkeydown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      updatePrompt(prompt, { kind: "cancelEdit" });
                    }
                  }}></textarea>
                <div class="pending-actions">
                  <button type="button" onclick={() => updatePrompt(prompt, { kind: "cancelEdit" })}>Cancel</button>
                  <button type="submit" class="queue-primary"
                    disabled={controlsDisabled || (!prompt.images.length && !(editDrafts[prompt.id] ?? prompt.text).trim())}>Save</button>
                </div>
              </form>
            {:else}
              <div class="pending-message">
                {#if !prompt.editable || index === 0}<span class="queued-badge">{prompt.editable ? "Next" : delivery}</span>{/if}
                <div class="queued-text" title={prompt.text}>{prompt.text}</div>
                {#if prompt.images.length}
                  <span class="queued-images">{prompt.images.length} image{prompt.images.length === 1 ? "" : "s"}</span>
                {/if}
              </div>
              {#if prompt.editable}
                <div class="pending-actions">
                  <button type="button" class="queue-primary" disabled={controlsDisabled}
                    aria-label={session.isStreaming ? "Steer" : "Send now"}
                    title={session.isStreaming ? "Steer the current run" : "Send this message now"}
                    onclick={() => updatePrompt(prompt, { kind: "steer" })}>
                    <span class="codicon codicon-zap" aria-hidden="true"></span>
                  </button>
                  <button type="button" aria-label="Edit queued message" title="Edit queued message" disabled={controlsDisabled}
                    onclick={() => { editDrafts[prompt.id] = prompt.text; updatePrompt(prompt, { kind: "startEdit" }); }}>
                    <span class="codicon codicon-edit" aria-hidden="true"></span>
                  </button>
                  <button type="button" aria-label="Move up" title="Move up" disabled={controlsDisabled || index === 0}
                    onclick={() => updatePrompt(prompt, { kind: "move", direction: "up" })}>
                    <span class="codicon codicon-arrow-up" aria-hidden="true"></span>
                  </button>
                  <button type="button" aria-label="Move down" title="Move down" disabled={controlsDisabled || index === editablePrompts.length - 1}
                    onclick={() => updatePrompt(prompt, { kind: "move", direction: "down" })}>
                    <span class="codicon codicon-arrow-down" aria-hidden="true"></span>
                  </button>
                  <button type="button" aria-label="Remove queued message" title="Remove queued message" disabled={controlsDisabled}
                    onclick={() => updatePrompt(prompt, { kind: "remove" })}>
                    <span class="codicon codicon-trash" aria-hidden="true"></span>
                  </button>
                </div>
              {/if}
            {/if}
          </li>
        {/each}
      </ol>
    </section>
  {/if}
</div>

<style>
.conversation-inner { width: 100%; max-width: var(--content-max-width); min-height: 100%; margin: 0 auto; padding: 18px 14px 28px; }
.conversation-tail { height: 8px; }
.conversation-empty {
  min-height: min(430px, 65vh);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: var(--frost-muted);
  padding: 30px 12px;
}
.conversation-empty :global(h2) { margin: 15px 0 4px; color: var(--frost-text); font-size: calc(var(--font-size-ui) + 4px); font-weight: 600; }
.conversation-empty :global(p) { max-width: 360px; margin: 0; font-size: var(--font-size-compact); }
.empty-orbit {
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  border: 1px solid var(--frost-border);
  border-radius: 16px;
  background: linear-gradient(145deg, color-mix(in srgb, var(--frost-surface) 80%, transparent), color-mix(in srgb, var(--frost-bg-alt) 90%, transparent));
  box-shadow: inset 0 1px rgba(255,255,255,.05), 0 10px 25px rgba(0,0,0,.12);
}
.empty-orbit :global(span) {
  font-family: Georgia, serif;
  font-size: 24px;
  color: color-mix(in srgb, var(--frost-text) 88%, var(--frost-link));
}
.conversation-inner { padding-top: 14px; padding-bottom: 34px; }
.conversation-frame { display: flex; flex-direction: column; }
.conversation-frame > .conversation { flex: 1; min-height: 0; }
.new-updates-anchor { position: relative; }
.queued-follow-ups {
  width: calc(100% - 28px);
  max-width: var(--content-max-width);
  margin: 0 auto 6px;
  padding: 3px 6px;
  border: 1px solid var(--frost-border-soft);
  border-radius: 7px;
  background: var(--frost-surface);
}
.pending-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 3px; }
.pending-label { color: var(--frost-muted); font-size: var(--font-size-detail); font-weight: 600; }
.pending-restore, .pending-actions > button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 22px;
  min-width: 20px;
  padding: 0 3px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--frost-muted);
  font: inherit;
  font-size: var(--font-size-detail);
  white-space: nowrap;
  cursor: pointer;
}
.pending-actions :global(.codicon) { font-size: 13px; }
.pending-restore:hover:not(:disabled), .pending-actions > button:hover:not(:disabled) { background: var(--frost-hover); color: var(--frost-text); }
.pending-restore:disabled, .pending-actions > button:disabled { opacity: .4; cursor: default; }
.pending-restore:focus-visible, .pending-actions > button:focus-visible, .pending-edit > textarea:focus-visible {
  outline: 1px solid var(--frost-link);
  outline-offset: -1px;
}
.pending-actions > .queue-primary { color: var(--frost-link); }
.pending-reason { margin: 0 3px 4px; color: var(--frost-muted); font-size: var(--font-size-detail); overflow-wrap: anywhere; }
.pending-list {
  display: grid;
  max-height: min(32vh, 180px);
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}
.pending-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  min-height: 28px;
  padding: 2px;
  border-top: 1px solid var(--frost-border-soft);
}
.pending-message { flex: 1; display: flex; align-items: baseline; gap: 4px; min-width: 0; }
.queued-badge { flex: none; color: var(--frost-link); font-size: var(--font-size-detail); font-weight: 600; }
.queued-text { min-width: 0; color: var(--frost-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: var(--font-size-ui); }
.queued-images { flex: none; color: var(--frost-muted); font-size: var(--font-size-detail); }
.pending-actions { flex: none; margin-left: auto; display: flex; justify-content: flex-end; gap: 1px; }
.pending-edit { width: 100%; display: grid; gap: 2px; padding: 3px 0; }
.pending-edit > textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 37px;
  resize: vertical;
  padding: 3px 5px;
  border: 1px solid var(--frost-border-soft);
  border-radius: 4px;
  background: var(--frost-bg);
  color: var(--frost-text);
  font: inherit;
}
.session-progress {
  margin: 5px 0 12px;
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  border: 1px solid var(--frost-border-soft);
  border-radius: 7px;
  background: color-mix(in srgb, var(--frost-surface) 56%, transparent);
  color: var(--frost-muted);
  font-size: var(--font-size-detail);
}
.session-progress > :global(.codicon) { color: var(--frost-link); font-size: 13px; }
.session-progress-label { color: var(--frost-text); font-weight: 600; }
.session-progress :global(.thinking-pulse) { margin-left: 1px; }

@media (max-width: 330px) {
  .conversation-inner { padding-left: 8px; padding-right: 8px; }
}

@media (max-width: 560px) {
  .conversation-inner { padding-left: 11px; padding-right: 11px; }
  .conversation-empty { min-height: min(380px, 58vh); padding-left: 8px; padding-right: 8px; }
  .conversation-empty :global(h2) { max-width: 100%; font-size: calc(var(--font-size-ui) + 3px); }
  .conversation-empty :global(p) { max-width: min(330px, 100%); }
}
</style>
