<script lang="ts">
  import type { RpcModel, StreamingBehavior } from "@frostime/pi-rpc";
  import type { SessionViewModel } from "$shared/model/sessionViewModel";

  import { postToHost } from "../../bridge/hostBridge";
  import { composerDrafts, getDraft, type DraftImage, type SessionDraft } from "../../features/composer/composerDraftStore.svelte";
  import { clearDraft, clearDraftForSubmission, setDraft, setDraftText, updateDraft } from "./composerDraftSync";
  import { promptSubmissionResult } from "../../features/composer/promptSubmissionStore.svelte";
  import {
    dismissQueuedPromptRecoveryFeedback,
    queuedPromptRecoveryFeedback,
    queuedPromptRecoveryRequests,
  } from "./queuedPromptRecoveryStore.svelte";
  import { composerStreamingBehaviors, setComposerStreamingBehavior } from "../../features/composer/composerStreamingBehaviorStore.svelte";
  import { composerFocusTick, showToast } from "../../state/sessionViewStore.svelte";
  import { createId } from "../../utils/createId";
  import type { LocalComposerCommands } from "./frostPiCommands";
  import ModelPicker from "../models/ModelPicker.svelte";
  import ThinkingLevelPicker from "../models/ThinkingLevelPicker.svelte";

  import AttachmentStrip from "./AttachmentStrip.svelte";
  import PromptEditor from "./PromptEditor.svelte";
  import StreamingSendButton from "./StreamingSendButton.svelte";

  let {
    session,
    localCommands,
    restoreFailedSubmissionLocally,
    draftAuthority,
    onpendingsubmissionchange,
  }: {
    session: SessionViewModel;
    localCommands: LocalComposerCommands;
    restoreFailedSubmissionLocally: boolean;
    draftAuthority: "webview" | "host";
    /** Tracks the accepted-but-unanswered submission whose draft was already cleared. */
    onpendingsubmissionchange?: ((pending: boolean) => void) | undefined;
  } = $props();
  let editor: PromptEditor;
  let pendingRequestId = $state<string | null>(null);
  let pendingRequestSessionId = $state<string | null>(null);
  let pendingSubmittedDraft = $state<SessionDraft | null>(null);
  let pendingClearedRevision: number | null = null;
  let expanded = $state(false);
  let expandedSessionId: string | null = null;

  const draft = $derived($composerDrafts[session.id] ?? { revision: 0, text: "", images: [] });
  const commands = $derived(localCommands.completions(session.commands));
  const streamingBehavior = $derived($composerStreamingBehaviors[session.id] ?? session.composerStreamingBehavior);
  const unavailable = $derived(
    session.status === "queued" || session.status === "starting" || session.status === "stopping" || session.status === "failed"
    || session.historyStatus === "queued" || session.historyStatus === "loading" || session.isCompacting || session.isForking || session.isNavigatingTree,
  );
  // Recovery blocks sending and new attachments, never text editing.
  const recoveryBusy = $derived(
    $queuedPromptRecoveryRequests[session.id] !== undefined || session.queuedPromptRecovery.state === "recovering",
  );
  const recoveryFeedback = $derived($queuedPromptRecoveryFeedback[session.id] ?? null);
  const canSend = $derived((draft.text.trim().length > 0 || draft.images.length > 0) && !unavailable && !pendingRequestId && !recoveryBusy);
  const supportsImages = $derived(modelSupportsImages(session.model));

  export function focusAtEnd(): void {
    requestAnimationFrame(() => editor?.focusAtEnd());
  }

  $effect(() => {
    const currentSessionId = session.id;
    if (expandedSessionId === null) {
      expandedSessionId = currentSessionId;
      return;
    }
    if (currentSessionId === expandedSessionId) return;
    expandedSessionId = currentSessionId;
    expanded = false;
  });

  $effect(() => {
    $composerFocusTick;
    requestAnimationFrame(() => editor?.focus());
  });

  $effect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  $effect(() => {
    // Only the Session that owns the unresolved submission is blocked from recovery.
    onpendingsubmissionchange?.(pendingRequestId !== null && pendingRequestSessionId === session.id);
  });

  $effect(() => {
    const result = $promptSubmissionResult;
    if (!result || result.requestId !== pendingRequestId) return;
    const submitted = pendingSubmittedDraft;
    const clearedRevision = pendingClearedRevision;
    pendingRequestId = null;
    pendingRequestSessionId = null;
    pendingSubmittedDraft = null;
    pendingClearedRevision = null;
    if (result.ok || !restoreFailedSubmissionLocally || !submitted || clearedRevision === null) return;
    const current = getDraft(session.id);
    if (current.revision !== clearedRevision || current.text || current.images.length) return;
    setDraft(session.id, "webview", submitted);
  });

  function setText(text: string): void {
    setDraftText(session.id, draftAuthority, text);
  }

  function setExpanded(next: boolean): void {
    expanded = next;
    requestAnimationFrame(() => editor?.focus());
  }

  function submit(requestedStreamingBehavior: StreamingBehavior = streamingBehavior): void {
    if (!canSend) return;
    const localCommand = localCommands.handle({ sessionId: session.id, text: draft.text, hasImages: draft.images.length > 0 });
    if (localCommand) {
      if (localCommand.draft === "clear") clearDraft(session.id, draftAuthority);
      else if (localCommand.draft !== "keep") setText(localCommand.draft.text);
      localCommand.execute();
      return;
    }
    const requestId = createId("prompt");
    pendingRequestId = requestId;
    pendingRequestSessionId = session.id;
    pendingSubmittedDraft = {
      revision: draft.revision,
      text: draft.text,
      images: draft.images.map((image) => ({ ...image })),
    };
    const text = draft.text;
    const images = draft.images.map(({ id, name, mimeType, data, size }) => ({ id, name, mimeType, data, size }));
    // Clear on send. Do not clear again on promptResult(ok): extension commands may fill the draft first.
    pendingClearedRevision = clearDraftForSubmission(session.id);
    postToHost({
      type: "sendPrompt",
      requestId,
      sessionId: session.id,
      text,
      images,
      draftRevision: draft.revision,
      streamingBehavior: requestedStreamingBehavior,
    });
  }

  async function handlePastedImages(files: File[]): Promise<void> {
    if (recoveryBusy) {
      showToast("info", "Wait for pending message recovery to finish before adding images.");
      return;
    }
    const accepted: DraftImage[] = [];
    for (const file of files) {
      if (!isSupportedMime(file.type)) {
        showToast("warning", `Unsupported image type: ${file.type}`);
        continue;
      }
      if (file.size > session.attachmentLimits.maxImageBytes) {
        showToast("warning", `${file.name || "Pasted image"} is larger than ${formatBytes(session.attachmentLimits.maxImageBytes)}.`);
        continue;
      }
      const dataUrl = await readDataUrl(file);
      accepted.push({
        id: createId("image"),
        name: file.name || `pasted-image-${Date.now()}.${extensionForMime(file.type)}`,
        mimeType: file.type as DraftImage["mimeType"],
        data: dataUrl.slice(dataUrl.indexOf(",") + 1),
        dataUrl,
        size: file.size,
      });
    }
    if (!accepted.length) return;
    // Reading files is asynchronous: recovery may have started while this paste was in flight.
    if (recoveryBusy) {
      showToast("info", "Wait for pending message recovery to finish before adding images.");
      return;
    }
    updateDraft(session.id, draftAuthority, (current) => {
      const images = [...current.images, ...accepted].slice(0, session.attachmentLimits.maxImages);
      if (current.images.length + accepted.length > session.attachmentLimits.maxImages) {
        showToast("warning", `A prompt can include at most ${session.attachmentLimits.maxImages} images.`);
      }
      return { ...current, images };
    });
  }
</script>

<div class="composer-shell" class:composer-expanded={expanded}>
  <AttachmentStrip images={draft.images} onremove={(id) => updateDraft(session.id, draftAuthority, (current) => ({ ...current, images: current.images.filter((image) => image.id !== id) }))} />
  {#if draft.images.length && session.model && !supportsImages}
    <div class="composer-warning"><span class="codicon codicon-warning"></span> The selected model may not accept images.</div>
  {/if}
  {#if recoveryFeedback}
    <div class={`recovery-notice recovery-notice-${recoveryFeedback.level}`} role="status" aria-live="polite">
      <span class={`codicon codicon-${feedbackIcon(recoveryFeedback.level)}`} aria-hidden="true"></span>
      <div class="recovery-notice-body">
        <div class="recovery-notice-headline">{recoveryFeedback.headline}</div>
        {#each recoveryFeedback.details as detail (detail)}
          <div class="recovery-notice-detail">{detail}</div>
        {/each}
      </div>
      <button class="recovery-notice-dismiss" type="button" aria-label="Dismiss recovery notice" title="Dismiss" onclick={() => dismissQueuedPromptRecoveryFeedback(session.id)}>
        <span class="codicon codicon-close" aria-hidden="true"></span>
      </button>
    </div>
  {/if}
  <div class="composer-box" class:composer-running={session.isStreaming}>
    <button
      class="composer-expand-button"
      type="button"
      aria-label={expanded ? "Minimize composer" : "Expand composer"}
      aria-pressed={expanded}
      title={expanded ? "Minimize composer (Esc)" : "Expand composer"}
      onclick={() => setExpanded(!expanded)}
    >
      <span class={`codicon codicon-screen-${expanded ? "normal" : "full"}`}></span>
    </button>
    <PromptEditor
      bind:this={editor}
      sessionId={session.id}
      value={draft.text}
      {commands}
      placeholder={session.isNavigatingTree ? "Switching conversation branch…" : session.isStreaming || session.queuedSteers.length > 0 || session.queuedFollowUps.length > 0 ? "Steer or queue a message…" : "Ask Pi about this workspace…"}
      onchange={setText}
      currentStreamingBehavior={streamingBehavior}
      onsubmit={submit}
      onpasteimages={handlePastedImages}
    />
    <div class="composer-toolbar">
      <div class="composer-toolbar-left">
        <ModelPicker
          sessionId={session.id}
          model={session.model}
          models={session.availableModels}
          scopedModelIds={session.scopedModelIds}
          disabled={unavailable}
        />
        <ThinkingLevelPicker sessionId={session.id} model={session.model} level={session.thinkingLevel} disabled={unavailable} />
      </div>
      <div class="composer-toolbar-right">
        <span class="send-hint">Ctrl ↵</span>
        {#if session.isForking}
          <button class="send-button stop-button" type="button" aria-label="Cancel Fork" title="Cancel Fork and restore the original session" onclick={() => postToHost({ type: "cancelFork", sessionId: session.id })}>
            <span class="codicon codicon-debug-stop"></span>
          </button>
        {:else if session.isStreaming}
          {#if canSend}
            <StreamingSendButton
              selected={streamingBehavior}
              onselect={(behavior) => setComposerStreamingBehavior(session.id, behavior)}
              onsubmit={submit}
            />
          {/if}
          <button class="send-button stop-button" type="button" aria-label="Stop Pi" title="Stop current run" onclick={() => postToHost({ type: "abort", sessionId: session.id })}>
            <span class="codicon codicon-debug-stop"></span>
          </button>
        {:else}
          <button class="send-button" type="button" aria-label="Send to Pi" title="Send (Ctrl+Enter)" disabled={!canSend} onclick={() => submit()}>
            <span class="codicon codicon-arrow-up"></span>
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>

<script lang="ts" module>
  function feedbackIcon(level: "info" | "warning" | "error"): string {
    return level === "error" ? "error" : level === "warning" ? "warning" : "info";
  }

  function modelSupportsImages(model: RpcModel | null): boolean {
    return Boolean(model && (model.supportsImages === true || (Array.isArray(model.input) && model.input.includes("image"))));
  }

  function isSupportedMime(mime: string): boolean {
    return ["image/png", "image/jpeg", "image/webp"].includes(mime);
  }

  function formatBytes(bytes: number): string {
    const megabytes = bytes / 1024 / 1024;
    return `${Number.isInteger(megabytes) ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB`;
  }

  function extensionForMime(mime: string): string {
    return mime === "image/jpeg" ? "jpg" : mime.split("/")[1] ?? "png";
  }

  function readDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("Unable to read pasted image"));
      reader.readAsDataURL(file);
    });
  }
</script>

<style>
.recovery-notice {
  display: grid;
  grid-template-columns: 15px minmax(0, 1fr) 18px;
  gap: 6px;
  margin: 0 1px 6px;
  padding: 6px 4px 6px 8px;
  border: 1px solid var(--frost-border-soft);
  border-radius: 6px;
  background: color-mix(in srgb, var(--frost-surface) 78%, transparent);
  color: var(--frost-muted);
  font-size: calc(var(--font-size-ui) - 2.5px);
  line-height: 1.4;
}
.recovery-notice > :global(.codicon) { margin-top: 1px; color: var(--frost-link); font-size: 12px; }
.recovery-notice-warning > :global(.codicon) { color: var(--frost-warning); }
.recovery-notice-error > :global(.codicon) { color: var(--frost-error); }
.recovery-notice-body { min-width: 0; }
.recovery-notice-headline { color: var(--frost-text); font-weight: 600; overflow-wrap: anywhere; }
.recovery-notice-detail { margin-top: 2px; overflow-wrap: anywhere; }
.recovery-notice-dismiss {
  align-self: start;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--frost-muted);
  cursor: pointer;
}
.recovery-notice-dismiss:hover { background: var(--frost-hover); color: var(--frost-text); }
.recovery-notice-dismiss :global(.codicon) { font-size: 12px; }
</style>
