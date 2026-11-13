<script lang="ts">
  import type { SessionViewModel } from "$shared/model/sessionViewModel";

  import { postToHost } from "../../bridge/hostBridge";
  import IconButton from "../../primitives/IconButton.svelte";
  import StatusDot from "./StatusDot.svelte";
  import { sessionStatusLabel } from "./sessionStatusLabel";

  /**
   * A Session Tab's own bar. It manages only the pinned Session, renaming it at any
   * time, a running turn included, and opens a sibling tab. Everything else about the
   * session collection stays in the sidebar.
   */
  let { session }: { session: SessionViewModel } = $props();
  let editing = $state(false);
  let titleDraft = $state("");
  let titleInput = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (!editing) return;
    requestAnimationFrame(() => {
      titleInput?.focus();
      titleInput?.select();
    });
  });

  function beginRename(): void {
    titleDraft = session.title;
    editing = true;
  }

  function commitRename(): void {
    // Enter commits and removes the input; its blur must not commit a second time.
    if (!editing) return;
    editing = false;
    const name = titleDraft.trim();
    if (name && name !== session.title) postToHost({ type: "renameSession", sessionId: session.id, name });
  }

  function onTitleKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      editing = false;
    }
  }
</script>

<header class="session-header panel-session-header">
  {#if editing}
    <div class="session-heading">
      <StatusDot status={session.status} />
      <input
        class="session-title-input"
        bind:this={titleInput}
        bind:value={titleDraft}
        maxlength="160"
        aria-label="Session name"
        onkeydown={onTitleKeydown}
        onblur={commitRename}
      />
    </div>
  {:else}
    <button
      class="session-heading"
      type="button"
      aria-label={`Rename session ${session.title}`}
      title={`Rename session · ${session.cwd}`}
      onclick={beginRename}
    >
      <StatusDot status={session.status} />
      <span class="session-title">{session.title}</span>
      {#if session.isEphemeral}<span class="ephemeral-badge">临时</span>{/if}
      <span class="session-inline-status">
        {#if session.workingDirectoryLabel}
          <span class="session-cwd-pill" title={session.cwd}>{session.workingDirectoryLabel}</span>
        {/if}
        <span>· {sessionStatusLabel(session)}</span>
      </span>
      <span class="codicon codicon-edit session-heading-chevron" aria-hidden="true"></span>
    </button>
  {/if}
  <div class="session-actions">
    <IconButton icon="add" label="New session in editor tab" onclick={() => postToHost({ type: "createSessionPanel" })} />
  </div>
</header>

<style>
  .panel-session-header { min-height: 32px; padding-top: 1px; padding-bottom: 1px; }
  .panel-session-header .session-heading-chevron { opacity: 0; }
  .panel-session-header .session-heading:hover .session-heading-chevron,
  .panel-session-header .session-heading:focus-visible .session-heading-chevron { opacity: 1; }
  .ephemeral-badge { flex: 0 0 auto; padding: 1px 4px; border: 1px solid var(--frost-border); border-radius: 4px; color: var(--frost-muted); font-size: calc(var(--font-size-ui) - 4px); line-height: 1.2; }
</style>
