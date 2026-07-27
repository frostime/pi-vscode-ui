<script lang="ts">
  import type { ConversationMessageView } from "$shared/model/conversationModel";
  import type { SessionViewModel } from "$shared/model/sessionViewModel";

  import BranchPointControl from "./BranchPointControl.svelte";
  import BranchSummaryBlock from "./BranchSummaryBlock.svelte";
  import ImageGallery from "./ImageGallery.svelte";
  import MarkdownContent from "./MarkdownContent.svelte";
  import { copyMessageText, rawMessageText } from "./copyMessageClient";
  import { pendingForkEntryId, requestMessageFork } from "./forkMessageClient";
  import { requestBranchHere } from "./sessionTreeClient";

  let { message, session }: { message: ConversationMessageView; session: SessionViewModel } = $props();
  const unavailable = $derived(
    session.status !== "ready" || session.isStreaming || session.isCompacting || session.isForking || session.isNavigatingTree
    || session.historyStatus !== "loaded" || session.pendingExtensionUi.length > 0 || session.queuedFollowUps.length > 0,
  );
  const pending = $derived($pendingForkEntryId === message.sourceEntryId);
  const copyText = $derived(rawMessageText(message.blocks));
  const beforeControls = $derived(session.branchControls.filter((control) => control.anchorEntryId === message.sourceEntryId && control.anchorPosition === "before"));
  const afterControls = $derived(session.branchControls.filter((control) => control.anchorEntryId === message.sourceEntryId && control.anchorPosition === "after"));
</script>

{#each beforeControls as control (control.branchPointId)}
  <BranchPointControl {control} {session} />
  {#if control.branchSummary}
    <BranchSummaryBlock summary={control.branchSummary} />
  {/if}
{/each}

<article class="message message-user" data-pi-entry-id={message.sourceEntryId}>
  <div class="user-message-stack">
    <div class="user-bubble">
      {#each message.blocks as block, index (index)}
        {#if block.type === "text"}<MarkdownContent content={block.text} />{/if}
        {#if block.type === "images"}<ImageGallery images={block.images} />{/if}
        {#if block.type === "error"}<div class="inline-error">{block.text}</div>{/if}
      {/each}
    </div>
    {#if copyText || message.sourceEntryId}
      <div class="message-actions">
        {#if copyText}
          <button type="button" aria-label="Copy user message" title="Copy raw message text" onclick={() => copyMessageText(message.blocks)}>
            <span class="codicon codicon-copy" aria-hidden="true"></span>
            <span>Copy</span>
          </button>
        {/if}
        {#if message.sourceEntryId}
          <button
            type="button"
            aria-label="Branch from this prompt in the same session"
            title={session.sessionTreeAvailable
              ? "Continue from this prompt in the same session"
              : "Session tree navigation is unavailable. Update Pi, restart the session, and check FrostPi diagnostics."}
            disabled={unavailable || !session.sessionTreeAvailable || $pendingForkEntryId !== null}
            onclick={() => requestBranchHere(session, message)}
          >
            <span class="codicon codicon-source-control" aria-hidden="true"></span>
            <span>Branch here</span>
          </button>
          <button
            type="button"
            aria-label="Fork session from this message"
            title="Create a new session from this message"
            disabled={unavailable || $pendingForkEntryId !== null}
            onclick={() => requestMessageFork(session, message)}
          >
            <span class="codicon codicon-git-branch" aria-hidden="true"></span>
            <span>{pending ? "Forking…" : "Fork"}</span>
          </button>
        {/if}
      </div>
    {/if}
  </div>
</article>

{#each afterControls as control (control.branchPointId)}
  <BranchPointControl {control} {session} />
{/each}

<style>
.user-message-stack { max-width: 100%; display: flex; flex-direction: column; align-items: flex-end; }
</style>
