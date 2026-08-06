<script lang="ts">
  import type { SessionSummaryView } from "$shared/model/sessionViewModel";

  let {
    sessions,
    activeId,
    onselect,
    onclose,
    oncreate,
    onresume,
  }: {
    sessions: SessionSummaryView[];
    activeId: string;
    onselect: (sessionId: string) => void;
    onclose: (sessionId: string) => void;
    oncreate: () => void;
    onresume: () => void;
  } = $props();

  function runtimeStatusLabel(session: SessionSummaryView): string {
    if (session.requiresUserInput) return "Action required";
    if (session.status === "queued") return "Waiting to start";
    if (session.historyStatus === "queued") return "Waiting for history";
    if (session.historyStatus === "loading") return "Loading history";
    if (session.status === "running") {
      const location = session.id === activeId ? "Running" : "Running in background";
      if (session.historyStatus === "deferred") return `${location} · history not loaded`;
      if (session.historyStatus === "failed") return `${location} · history load failed`;
      return location;
    }
    if (session.historyStatus === "deferred") return "History not loaded";
    if (session.historyStatus === "failed") return "History load failed";
    if (session.status === "ready") return "Ready";
    if (session.status === "starting") return "Starting";
    if (session.status === "stopping") return "Stopping";
    if (session.status === "failed") return "Failed";
    return "Stopped";
  }
</script>

<div class="session-list-panel" role="dialog" aria-label="FrostPi sessions">
  <div class="session-list-heading">Sessions</div>
  <div class="session-list-items" role="listbox" aria-label="Open sessions">
    {#each sessions as session (session.id)}
      <div class="session-list-item" class:active={session.id === activeId}>
        <button
          class="session-list-select"
          type="button"
          role="option"
          aria-selected={session.id === activeId}
          title={session.cwd}
          onclick={() => onselect(session.id)}
        >
          <span class="session-list-mark">{session.id === activeId ? "✓" : ""}</span>
          <span class="session-list-copy">
            <strong class="session-list-title"><span class="session-title-text">{session.title}</span>{#if session.isEphemeral}<span class="ephemeral-badge">临时</span>{/if}</strong>
            <small class:attention={session.requiresUserInput}>
              {#if session.workingDirectoryLabel}
                <span class="session-cwd-pill">{session.workingDirectoryLabel}</span>
              {/if}
              <span>{runtimeStatusLabel(session)}</span>
            </small>
          </span>
        </button>
        <button class="session-list-close" type="button" aria-label={`Close ${session.title}`} title="Close session" onclick={() => onclose(session.id)}>
          <span class="codicon codicon-close" aria-hidden="true"></span>
        </button>
      </div>
    {/each}
  </div>
  <div class="session-list-footer">
    <button type="button" onclick={oncreate}><span class="codicon codicon-add" aria-hidden="true"></span> New session</button>
    <button type="button" onclick={onresume}><span class="codicon codicon-history" aria-hidden="true"></span> Resume session</button>
  </div>
</div>

<style>
  .session-list-title { display: flex; align-items: center; gap: 5px; }
  .session-title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .ephemeral-badge { flex: 0 0 auto; padding: 1px 4px; border: 1px solid var(--frost-border); border-radius: 4px; color: var(--frost-muted); font-size: 9px; line-height: 1.2; font-weight: 400; }
</style>
