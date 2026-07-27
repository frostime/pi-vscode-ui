<script lang="ts">
  import type { AgentTurnView, SessionNoticeView } from "$shared/model/agentTurnModel";
  import type { CompactionView, CustomMessageView } from "$shared/model/conversationModel";
  import type { SessionViewModel } from "$shared/model/sessionViewModel";
  import { onDestroy, onMount } from "svelte";

  import NewUpdatesButton from "../scrolling/NewUpdatesButton.svelte";
  import { INITIAL_SCROLL_FOLLOW_STATE, reduceScrollFollow } from "../scrolling/scrollFollowState";
  import AgentTurn from "./AgentTurn.svelte";
  import CompactionBlock from "./CompactionBlock.svelte";
  import CustomBlock from "./CustomBlock.svelte";
  import SessionNotice from "./SessionNotice.svelte";

  let { session }: { session: SessionViewModel } = $props();
  let scroller: HTMLDivElement;
  let content: HTMLDivElement;
  let followState = $state({ ...INITIAL_SCROLL_FOLLOW_STATE });
  let lastUpdatedAt = 0;
  let lastTurnCount = 0;
  let programmaticScroll = false;
  let resizeObserver: ResizeObserver | null = null;

  type TimelineItem =
    | { kind: "turn"; timestamp: number; value: AgentTurnView }
    | { kind: "notice"; timestamp: number; value: SessionNoticeView }
    | { kind: "compaction"; timestamp: number; value: CompactionView }
    | { kind: "custom"; timestamp: number; value: CustomMessageView };

  const timeline = $derived.by<TimelineItem[]>(() => [
    ...session.turns.map((value) => ({ kind: "turn" as const, timestamp: value.startedAt, value })),
    ...session.notices.map((value) => ({ kind: "notice" as const, timestamp: value.timestamp, value })),
    ...session.compactions.map((value) => ({ kind: "compaction" as const, timestamp: value.timestamp, value })),
    ...session.customMessages.map((value) => ({ kind: "custom" as const, timestamp: value.timestamp, value })),
  ].sort((left, right) => left.timestamp - right.timestamp));

  onMount(() => {
    resizeObserver = new ResizeObserver(() => {
      if (followState.mode === "following") scrollToBottom(false);
    });
    resizeObserver.observe(content);
    requestAnimationFrame(() => scrollToBottom(false));
  });

  onDestroy(() => resizeObserver?.disconnect());

  $effect(() => {
    const updatedAt = session.updatedAt;
    const turnCount = session.turns.length;
    if (!scroller || updatedAt === lastUpdatedAt) return;
    const isNewTurn = turnCount > lastTurnCount;
    lastUpdatedAt = updatedAt;
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
  <div class="conversation" bind:this={scroller} onscroll={handleScroll}>
    <div class="conversation-inner" bind:this={content}>
      {#if timeline.length === 0}
        <div class="conversation-empty">
          <div class="empty-orbit"><span>π</span></div>
          <h2>What are you working on?</h2>
          <p>Ask Pi to inspect code, make changes, run commands, or explain the current project.</p>
        </div>
      {:else}
        {#each timeline as item (`${item.kind}-${item.value.id}`)}
          {#if item.kind === "turn"}
            <AgentTurn turn={item.value} {session} />
          {:else if item.kind === "compaction"}
            <CompactionBlock compaction={item.value} />
          {:else if item.kind === "custom"}
            <CustomBlock message={item.value} />
          {:else}
            <SessionNotice notice={item.value} />
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
      {#if session.queuedFollowUps.length}
        <div class="queued-follow-ups" aria-label="Queued follow-ups">
          {#each session.queuedFollowUps as item (item.id)}
            <article class="message message-user message-queued">
              <div class="user-bubble queued-bubble">
                {#if item.text}<div class="queued-text">{item.text}</div>{/if}
                {#if item.images.length}
                  <div class="queued-images">{item.images.length} image{item.images.length === 1 ? "" : "s"}</div>
                {/if}
                <div class="queued-badge">
                  <span class="thinking-pulse" aria-hidden="true"></span>
                  <span>Queued</span>
                </div>
              </div>
            </article>
          {/each}
        </div>
      {/if}
      <div class="conversation-tail" aria-hidden="true"></div>
    </div>
  </div>
  {#if followState.mode === "paused"}<NewUpdatesButton count={followState.unseenUpdates} onclick={resumeFollowing} />{/if}
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
.conversation-empty :global(h2) { margin: 15px 0 4px; color: var(--frost-text); font-size: 17px; font-weight: 600; }
.conversation-empty :global(p) { max-width: 360px; margin: 0; font-size: 12px; }
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
.queued-follow-ups { display: grid; gap: 8px; margin: 4px 0 10px; }
.message-queued { opacity: 0.88; }
.queued-bubble {
  position: relative;
  border-style: dashed;
  background: color-mix(in srgb, var(--frost-surface) 70%, transparent);
  box-shadow: none;
}
.queued-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.45; }
.queued-images { margin-top: 4px; color: var(--frost-muted); font-size: 10.5px; }
.queued-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
  color: var(--frost-muted);
  font-size: 10px;
  font-weight: 500;
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
  font-size: 11px;
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
  .conversation-empty :global(h2) { max-width: 100%; font-size: 16px; }
  .conversation-empty :global(p) { max-width: min(330px, 100%); }
}
</style>
