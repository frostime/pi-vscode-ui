<script lang="ts">
  import type { ConversationMessageView } from "$shared/model/conversationModel";
  import type { SessionViewModel } from "$shared/model/sessionViewModel";

  import ImageGallery from "./ImageGallery.svelte";
  import MarkdownContent from "./MarkdownContent.svelte";
  import { copyMessageText, rawMessageText } from "./copyMessageClient";
  import { formatMessageTimestamp } from "./messageTimestamp";
  import { postToHost } from "../../bridge/hostBridge";
  import { pendingForkMessageId, requestMessageFork } from "./forkMessageClient";
  import { requestBranchHere } from "./sessionTreeClient";

  let { message, session }: { message: ConversationMessageView; session: SessionViewModel } = $props();
  const unavailable = $derived(
    session.status !== "ready" || session.isStreaming || session.isCompacting || session.isForking || session.isNavigatingTree
    || session.historyStatus !== "loaded" || session.pendingExtensionUi.length > 0 || session.queuedSteers.length > 0 || session.queuedFollowUps.length > 0,
  );
  /** Fork works during a reply: the Host forks in a separate Pi process and leaves the reply running. */
  const forkUnavailable = $derived(
    !["ready", "running"].includes(session.status) || session.isCompacting || session.isForking || session.isNavigatingTree
    || session.historyStatus !== "loaded",
  );
  /**
   * The message of the running turn can be forked before the conversation knows its Pi
   * entry: the Fork keeps what came before it and puts this message back in the Composer,
   * so the reply in progress is not part of it.
   */
  const forkable = $derived(message.sourceEntryId !== undefined || session.isStreaming);
  const pending = $derived($pendingForkMessageId === message.id);
  /**
   * The Fork is made in a second Pi process that is not a Session until Pi has forked,
   * so this session keeps running and the Fork has no entry of its own yet: the message
   * that started it offers Cancel Fork instead.
   */
  const cancellable = $derived(pending && !session.isForking);
  const copyText = $derived(rawMessageText(message.blocks));
  const sentAtLabel = $derived(formatMessageTimestamp(message.timestamp));
</script>

<article class="message message-user" data-pi-entry-id={message.sourceEntryId}>
  <div class="user-message-stack">
    <div class="user-bubble">
      {#each message.blocks as block, index (index)}
        {#if block.type === "text"}<MarkdownContent content={block.text} />{/if}
        {#if block.type === "images"}<ImageGallery images={block.images} />{/if}
        {#if block.type === "error"}<div class="inline-error">{block.text}</div>{/if}
      {/each}
    </div>
    {#if copyText || message.sourceEntryId || forkable}
      <div class="message-actions">
        {#if sentAtLabel}
          <time
            class="action-row-timestamp"
            datetime={new Date(message.timestamp).toISOString()}
            title={new Date(message.timestamp).toLocaleString()}
          >{sentAtLabel}</time>
        {/if}
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
            disabled={unavailable || !session.sessionTreeAvailable || $pendingForkMessageId !== null}
            onclick={() => requestBranchHere(session, message)}
          >
            <span class="codicon codicon-source-control" aria-hidden="true"></span>
            <span>Branch here</span>
          </button>
        {/if}
        {#if cancellable}
          <button
            type="button"
            aria-label="Cancel Fork"
            title="Forking in a separate Pi process. Cancel the Fork; this session keeps running."
            onclick={() => postToHost({ type: "cancelFork", sessionId: session.id })}
          >
            <span class="codicon codicon-close" aria-hidden="true"></span>
            <span>Cancel Fork</span>
          </button>
        {:else if forkable}
          <button
            type="button"
            aria-label="Fork session from this message"
            title="Create a new session from this message"
            disabled={forkUnavailable || $pendingForkMessageId !== null}
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


<style>
.user-message-stack { max-width: 100%; display: flex; flex-direction: column; align-items: flex-end; }
/* Timestamp leads the hover row; the shared chip style lives in styles/tokens.css. */
.action-row-timestamp { margin-right: 6px; }
</style>
