<script lang="ts">
  import type { RpcModel, StreamingBehavior } from "@frostime/pi-rpc";
  import type { SessionViewModel } from "$shared/model/sessionViewModel";

  import { postToHost } from "../../bridge/vscodeBridge";
  import { clearDraft, composerDrafts, getDraft, setDraft, updateDraft, type DraftImage, type SessionDraft } from "../../features/composer/composerDraftStore.svelte";
  import { promptSubmissionResult } from "../../features/composer/promptSubmissionStore.svelte";
  import { composerStreamingBehaviors, setComposerStreamingBehavior } from "../../features/composer/composerStreamingBehaviorStore.svelte";
  import { composerFocusTick, showToast } from "../../state/sessionViewStore.svelte";
  import { createId } from "../../utils/createId";
  import { composerEditorPrefill } from "./editorCommand";
  import { withFrostPiCommands } from "./frostPiCommands";
  import ModelPicker from "../models/ModelPicker.svelte";
  import ThinkingLevelPicker from "../models/ThinkingLevelPicker.svelte";

  import AttachmentStrip from "./AttachmentStrip.svelte";
  import PromptEditor from "./PromptEditor.svelte";
  import StreamingSendButton from "./StreamingSendButton.svelte";

  let { session }: { session: SessionViewModel } = $props();
  let editor: PromptEditor;
  let pendingRequestId = $state<string | null>(null);
  let pendingSubmittedDraft = $state<SessionDraft | null>(null);
  let expanded = $state(false);
  let expandedSessionId: string | null = null;

  const draft = $derived($composerDrafts[session.id] ?? { text: "", images: [] });
  const commands = $derived(withFrostPiCommands(session.commands));
  const streamingBehavior = $derived($composerStreamingBehaviors[session.id] ?? session.composerStreamingBehavior);
  const unavailable = $derived(
    session.status === "queued" || session.status === "starting" || session.status === "stopping" || session.status === "failed"
    || session.historyStatus === "queued" || session.historyStatus === "loading" || session.isCompacting || session.isForking || session.isNavigatingTree,
  );
  const canSend = $derived((draft.text.trim().length > 0 || draft.images.length > 0) && !unavailable && !pendingRequestId);
  const supportsImages = $derived(modelSupportsImages(session.model));

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
    const result = $promptSubmissionResult;
    if (!result || result.requestId !== pendingRequestId) return;
    const submitted = pendingSubmittedDraft;
    pendingRequestId = null;
    pendingSubmittedDraft = null;
    // Success: leave whatever is in the composer (including set_editor_text from extension commands).
    // Failure: restore the submitted snapshot only if the composer is still empty.
    if (result.ok || !submitted) return;
    const current = getDraft(session.id);
    if (current.text.length > 0 || current.images.length > 0) return;
    setDraft(session.id, submitted);
  });

  function setText(text: string): void {
    updateDraft(session.id, (current) => ({ ...current, text }));
  }

  function setExpanded(next: boolean): void {
    expanded = next;
    requestAnimationFrame(() => editor?.focus());
  }

  function submit(requestedStreamingBehavior: StreamingBehavior = streamingBehavior): void {
    if (!canSend) return;
    if (draft.images.length === 0 && draft.text.trim() === "/resume") {
      clearDraft(session.id);
      postToHost({ type: "resumeSession" });
      return;
    }
    const editorPrefill = composerEditorPrefill(draft.text);
    if (editorPrefill !== null) {
      setText(editorPrefill);
      postToHost({ type: "openComposerEditor", sessionId: session.id, text: editorPrefill });
      return;
    }
    const requestId = createId("prompt");
    pendingRequestId = requestId;
    pendingSubmittedDraft = {
      text: draft.text,
      images: draft.images.map((image) => ({ ...image })),
    };
    const text = draft.text;
    const images = draft.images.map(({ id, name, mimeType, data, size }) => ({ id, name, mimeType, data, size }));
    // Clear on send. Do not clear again on promptResult(ok): extension commands may fill the draft first.
    clearDraft(session.id);
    postToHost({
      type: "sendPrompt",
      requestId,
      sessionId: session.id,
      text,
      images,
      streamingBehavior: requestedStreamingBehavior,
    });
  }

  async function handlePastedImages(files: File[]): Promise<void> {
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
    updateDraft(session.id, (current) => {
      const images = [...current.images, ...accepted].slice(0, session.attachmentLimits.maxImages);
      if (current.images.length + accepted.length > session.attachmentLimits.maxImages) {
        showToast("warning", `A prompt can include at most ${session.attachmentLimits.maxImages} images.`);
      }
      return { ...current, images };
    });
  }
</script>

<div class="composer-shell" class:composer-expanded={expanded}>
  <AttachmentStrip images={draft.images} onremove={(id) => updateDraft(session.id, (current) => ({ ...current, images: current.images.filter((image) => image.id !== id) }))} />
  {#if draft.images.length && session.model && !supportsImages}
    <div class="composer-warning"><span class="codicon codicon-warning"></span> The selected model may not accept images.</div>
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
