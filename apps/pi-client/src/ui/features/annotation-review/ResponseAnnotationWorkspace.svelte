<script lang="ts">
  import { onDestroy, tick } from "svelte";

  import AnnotationNoteEditor from "./AnnotationNoteEditor.svelte";
  import {
    compactAnnotationQuote,
    pendingAnnotationHasChanges,
    segmentAnnotationSource,
    sortAnnotations,
    type AnnotationRange,
    type AnnotationReviewDraft,
  } from "./annotationReviewModel";
  import { formatAnnotationPrompt } from "./annotationPrompt";
  import {
    activateAnnotation,
    beginAnnotationEdit,
    beginPendingAnnotation,
    cancelPendingAnnotation,
    deleteAnnotation,
    discardAnnotationReview,
    savePendingAnnotation,
    setPendingAnnotationComment,
  } from "./annotationReviewStore.svelte";
  import { readSourceSelection } from "./annotationSelection";

  const PENDING_RANGE_ID = "pending-annotation-range";

  let {
    sessionId,
    review,
    oninsert,
  }: {
    sessionId: string;
    review: AnnotationReviewDraft;
    oninsert: (prompt: string) => void | Promise<void>;
  } = $props();

  let sourceRoot = $state<HTMLElement>();
  let noteEditor = $state<AnnotationNoteEditor>();
  let confirmationDialog = $state<HTMLDialogElement>();
  let confirmButton = $state<HTMLButtonElement>();
  let confirmation = $state<"discard-review" | "cancel-note" | null>(null);
  let confirmationReturnFocus: HTMLElement | null = null;
  let notice = $state("");
  let noticeTimer: number | null = null;

  const annotations = $derived(sortAnnotations(review.annotations));
  const pendingQuote = $derived(review.pending
    ? review.source.slice(review.pending.start, review.pending.end)
    : "");
  const sourceSegments = $derived(segmentAnnotationSource(review.source, displayRanges(review)));
  const hasReviewWork = $derived(
    review.annotations.length > 0 || Boolean(review.pending?.comment.trim()),
  );
  const pendingHasChanges = $derived(pendingAnnotationHasChanges(review));
  const canInsert = $derived(review.annotations.length > 0 && review.pending === null);

  $effect(() => {
    if (!confirmation || !confirmationDialog) return;
    const dialog = confirmationDialog;
    dialog.showModal();
    requestAnimationFrame(() => confirmButton?.focus());
    return () => {
      if (dialog.open) dialog.close();
    };
  });

  onDestroy(() => {
    if (noticeTimer) window.clearTimeout(noticeTimer);
  });

  $effect(() => {
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented || confirmation) return;
      event.preventDefault();
      if (review.pending) {
        requestCancelPending();
      } else {
        requestDiscardReview();
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  });

  function preventSourceMutation(event: Event): void {
    event.preventDefault();
  }

  function captureKeyboardSelection(event: KeyboardEvent): void {
    const selectsAll = event.key.toLowerCase() === "a" && (event.ctrlKey || event.metaKey);
    if (event.key === "Shift" || selectsAll) captureSelection();
  }

  function captureSelection(): void {
    if (review.pending) {
      if (!window.getSelection()?.isCollapsed) notify("Save or cancel the current note before selecting another passage.");
      return;
    }
    if (!sourceRoot) return;
    const range = readSourceSelection(sourceRoot, review.source);
    if (!range || !beginPendingAnnotation(sessionId, range.start, range.end)) return;
    window.getSelection()?.removeAllRanges();
  }

  function requestEdit(annotationId: string): void {
    if (review.pending) {
      notify("Save or cancel the current note before editing another annotation.");
      return;
    }
    beginAnnotationEdit(sessionId, annotationId);
  }

  function savePending(): void {
    if (savePendingAnnotation(sessionId)) {
      window.getSelection()?.removeAllRanges();
      return;
    }
    notify("Write a note before saving.");
    noteEditor?.focus();
  }

  function requestCancelPending(): void {
    if (!review.pending) return;
    if (pendingHasChanges) {
      openConfirmation("cancel-note");
      return;
    }
    cancelPendingAnnotation(sessionId);
  }

  function requestDiscardReview(): void {
    if (hasReviewWork) {
      openConfirmation("discard-review");
      return;
    }
    discardAnnotationReview(sessionId);
  }

  function openConfirmation(action: "discard-review" | "cancel-note"): void {
    confirmationReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirmation = action;
  }

  async function closeConfirmation(): Promise<void> {
    const returnFocus = confirmationReturnFocus;
    confirmation = null;
    confirmationReturnFocus = null;
    await tick();
    returnFocus?.focus();
  }

  async function confirmDestructiveAction(): Promise<void> {
    const action = confirmation;
    confirmation = null;
    confirmationReturnFocus = null;
    if (action === "cancel-note") {
      cancelPendingAnnotation(sessionId);
      await tick();
      sourceRoot?.focus();
    }
    if (action === "discard-review") discardAnnotationReview(sessionId);
  }

  function insertIntoComposer(): void {
    if (!canInsert) return;
    const prompt = formatAnnotationPrompt(review.source, review.annotations);
    if (prompt) void oninsert(prompt);
  }

  async function activateFromList(annotationId: string): Promise<void> {
    activateAnnotation(sessionId, annotationId);
    await tick();
    findSourceMark(annotationId)?.scrollIntoView({ block: "center" });
  }

  async function activateFromSource(annotationIds: readonly string[]): Promise<void> {
    if (review.pending) return;
    const annotationId = annotationIds.find((id) => id !== PENDING_RANGE_ID);
    if (!annotationId) return;
    activateAnnotation(sessionId, annotationId);
    await tick();
    document.getElementById(noteCardId(annotationId))?.scrollIntoView({ block: "nearest" });
  }

  function editorAnchorRect(): DOMRect | null {
    const pending = review.pending;
    if (!pending) return null;
    const annotationId = pending.mode === "create" ? PENDING_RANGE_ID : pending.annotationId;
    return findSourceMark(annotationId)?.getBoundingClientRect() ?? sourceRoot?.getBoundingClientRect() ?? null;
  }

  function findSourceMark(annotationId: string): HTMLElement | null {
    if (!sourceRoot) return null;
    return [...sourceRoot.querySelectorAll<HTMLElement>("[data-annotation-ids]")]
      .find((element) => element.dataset.annotationIds?.split(" ").includes(annotationId)) ?? null;
  }

  function notify(message: string): void {
    if (noticeTimer) window.clearTimeout(noticeTimer);
    notice = message;
    noticeTimer = window.setTimeout(() => notice = "", 2600);
  }

  function noteCardId(annotationId: string): string {
    return `annotation-note-${annotationId}`;
  }

  function displayRanges(current: AnnotationReviewDraft): AnnotationRange[] {
    if (current.pending?.mode !== "create") return current.annotations;
    return [
      ...current.annotations,
      { id: PENDING_RANGE_ID, start: current.pending.start, end: current.pending.end },
    ];
  }
</script>

<section class="annotation-workspace" aria-label="Response annotation workspace">
  <header class="workspace-header">
    <button class="icon-button" type="button" aria-label="Close annotation review" title="Back to conversation" onclick={requestDiscardReview}>
      <span class="codicon codicon-arrow-left" aria-hidden="true"></span>
    </button>
    <div class="workspace-heading">
      <strong>Annotate response</strong>
      <span>{annotations.length} {annotations.length === 1 ? "note" : "notes"}</span>
    </div>
  </header>

  <div class="workspace-body">
    <section class="source-pane" aria-labelledby="annotation-source-heading">
      <header class="pane-heading">
        <div>
          <strong id="annotation-source-heading">Response source</strong>
          <span>Raw Markdown snapshot</span>
        </div>
        <span>Select text to annotate</span>
      </header>
      <div class="source-scroll">
        <div
          class="annotation-source"
          bind:this={sourceRoot}
          role="textbox"
          tabindex="0"
          aria-label="Raw response text. Select a passage to add an annotation."
          aria-multiline="true"
          aria-readonly="true"
          contenteditable="true"
          spellcheck="false"
          onbeforeinput={preventSourceMutation}
          oncut={preventSourceMutation}
          onpaste={preventSourceMutation}
          ondrop={preventSourceMutation}
          onpointerup={captureSelection}
          onkeyup={captureKeyboardSelection}
        >{#each sourceSegments as segment (`${segment.start}:${segment.end}:${segment.annotationIds.join(",")}`)}{#if segment.annotationIds.length}{@const savedIds = segment.annotationIds.filter((id) => id !== PENDING_RANGE_ID)}{#if savedIds.length}<span
                class="source-mark"
                class:active={savedIds.includes(review.activeAnnotationId ?? "")}
                class:overlap={savedIds.length > 1}
                class:pending={segment.annotationIds.includes(PENDING_RANGE_ID)}
                data-annotation-ids={segment.annotationIds.join(" ")}
                role="button"
                tabindex="0"
                aria-label={`Show annotation for: ${compactAnnotationQuote(segment.text, 60)}`}
                onclick={() => activateFromSource(savedIds)}
                onkeydown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void activateFromSource(savedIds);
                  }
                }}
              >{segment.text}</span>{:else}<span class="source-mark pending" data-annotation-ids={segment.annotationIds.join(" ")}>{segment.text}</span>{/if}{:else}{segment.text}{/if}{/each}</div>
      </div>
    </section>

    <aside class="notes-pane" aria-labelledby="annotation-notes-heading">
      <header class="pane-heading">
        <div>
          <strong id="annotation-notes-heading">Annotations</strong>
          <span>Source order</span>
        </div>
      </header>
      <div class="notes-list">
        {#if annotations.length === 0}
          <div class="empty-notes">
            <span class="codicon codicon-comment-discussion" aria-hidden="true"></span>
            <strong>No annotations yet</strong>
            <span>Select a passage in the response source.</span>
          </div>
        {:else}
          {#each annotations as annotation, index (annotation.id)}
            <article class:active={annotation.id === review.activeAnnotationId} class="note-card" id={noteCardId(annotation.id)}>
              <button class="note-content" type="button" onclick={() => activateFromList(annotation.id)}>
                <span class="note-number">ANNOTATION {String(index + 1).padStart(2, "0")}</span>
                <span class="note-quote">“{compactAnnotationQuote(review.source.slice(annotation.start, annotation.end))}”</span>
                <span class="note-comment">{annotation.comment}</span>
              </button>
              <div class="note-actions">
                <button type="button" disabled={Boolean(review.pending)} onclick={() => requestEdit(annotation.id)}>Edit</button>
                <button class="danger" type="button" disabled={Boolean(review.pending)} onclick={() => deleteAnnotation(sessionId, annotation.id)}>Delete</button>
              </div>
            </article>
          {/each}
        {/if}
      </div>
    </aside>
  </div>

  <footer class="workspace-footer">
    <button class="discard-button" type="button" onclick={requestDiscardReview}>Discard</button>
    <span role="status" aria-live="polite">{notice || `${annotations.length} saved ${annotations.length === 1 ? "annotation" : "annotations"}`}</span>
    <button class="primary-button" type="button" disabled={!canInsert} onclick={insertIntoComposer}>Insert into Composer</button>
  </footer>

  {#if review.pending}
    <AnnotationNoteEditor
      bind:this={noteEditor}
      mode={review.pending.mode}
      quote={pendingQuote}
      value={review.pending.comment}
      anchorRect={editorAnchorRect}
      onchange={(comment) => setPendingAnnotationComment(sessionId, comment)}
      onsave={savePending}
      oncancel={requestCancelPending}
    />
  {/if}

  {#if confirmation}
    <dialog
      class="confirmation"
      bind:this={confirmationDialog}
      aria-labelledby="annotation-confirmation-title"
      oncancel={(event) => {
        event.preventDefault();
        void closeConfirmation();
      }}
    >
      <strong id="annotation-confirmation-title">
        {confirmation === "discard-review" ? "Discard this annotation review?" : "Discard this unfinished note?"}
      </strong>
      <p>{confirmation === "discard-review"
        ? "Saved and unfinished annotations in this review will be lost."
        : "The text entered for this note will be lost."}</p>
      <footer>
        <button type="button" onclick={closeConfirmation}>Keep editing</button>
        <button class="danger-confirm" bind:this={confirmButton} type="button" onclick={confirmDestructiveAction}>Discard</button>
      </footer>
    </dialog>
  {/if}
</section>

<style>
  .annotation-workspace {
    position: relative;
    min-width: 0;
    min-height: 0;
    height: 100%;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    background: var(--frost-bg);
  }

  .workspace-header,
  .workspace-footer {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-color: var(--frost-border-soft);
    background: color-mix(in srgb, var(--frost-bg) 94%, var(--frost-surface));
  }

  .workspace-header { border-bottom: 1px solid var(--frost-border-soft); }
  .workspace-footer { border-top: 1px solid var(--frost-border-soft); }

  .workspace-heading {
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 7px;
  }

  .workspace-heading strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .workspace-heading span { flex: none; color: var(--frost-muted); font-size: 10px; }

  .primary-button,
  .discard-button,
  .note-actions button,
  .confirmation button {
    min-height: 27px;
    padding: 3px 9px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 10.5px;
  }

  .primary-button { background: var(--frost-accent); color: var(--frost-accent-text); }
  .primary-button:hover:not(:disabled) { background: var(--frost-accent-hover); }
  .primary-button:disabled,
  .note-actions button:disabled { opacity: 0.42; cursor: default; }

  .workspace-body {
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(230px, 31%);
  }

  .source-pane,
  .notes-pane {
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .source-pane { border-right: 1px solid var(--frost-border-soft); }
  .notes-pane { background: color-mix(in srgb, var(--frost-surface) 34%, transparent); }

  .pane-heading {
    min-width: 0;
    min-height: 42px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--frost-border-soft);
  }

  .pane-heading > div { min-width: 0; display: flex; flex-direction: column; }
  .pane-heading strong { font-size: 11px; }
  .pane-heading span { color: var(--frost-muted); font-size: 9.5px; white-space: nowrap; }
  .source-scroll,
  .notes-list { min-width: 0; min-height: 0; overflow: auto; scrollbar-color: var(--frost-scrollbar) transparent; }

  .annotation-source {
    width: min(100%, var(--content-max-width));
    min-height: 100%;
    margin: 0 auto;
    padding: 20px clamp(13px, 3.4vw, 34px) 44px;
    outline: none;
    color: var(--frost-text);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.7;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
  }

  .annotation-source:focus-visible { box-shadow: inset 0 0 0 1px var(--frost-focus); }

  .source-mark {
    padding: 0;
    border-bottom: 1px solid color-mix(in srgb, var(--frost-link) 68%, transparent);
    outline: none;
    background: color-mix(in srgb, var(--frost-link) 16%, transparent);
    color: inherit;
    font: inherit;
    white-space: inherit;
    user-select: text;
    cursor: pointer;
  }

  .source-mark:hover,
  .source-mark:focus-visible,
  .source-mark.active { background: color-mix(in srgb, var(--frost-link) 27%, transparent); }
  .source-mark:focus-visible { outline: 1px solid var(--frost-focus); outline-offset: 1px; }
  .source-mark.overlap { border-bottom: 2px double var(--frost-link); }
  .source-mark.pending { background: color-mix(in srgb, var(--frost-link) 22%, transparent); }

  .notes-list { padding: 9px; }

  .empty-notes {
    min-height: 150px;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 5px;
    padding: 20px;
    color: var(--frost-muted);
    text-align: center;
    font-size: 10.5px;
  }

  .empty-notes .codicon { margin-bottom: 3px; color: var(--frost-faint); font-size: 20px; }
  .empty-notes strong { color: var(--frost-text); font-size: 11px; }

  .note-card {
    min-width: 0;
    margin-bottom: 8px;
    overflow: hidden;
    border: 1px solid var(--frost-border-soft);
    border-radius: var(--radius-sm);
    background: var(--frost-surface);
  }

  .note-card.active { border-color: color-mix(in srgb, var(--frost-link) 55%, var(--frost-border)); }

  .note-content {
    min-width: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 9px 10px;
    background: transparent;
    color: var(--frost-text);
    text-align: left;
    cursor: pointer;
  }

  .note-content:hover { background: var(--frost-hover); }
  .note-number { color: var(--frost-link); font-size: 9px; font-weight: 600; letter-spacing: 0.06em; }
  .note-quote { color: var(--frost-muted); font-size: 10px; line-height: 1.45; }
  .note-comment { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; line-height: 1.5; }

  .note-actions {
    display: flex;
    justify-content: flex-end;
    gap: 3px;
    padding: 5px 7px;
    border-top: 1px solid var(--frost-border-soft);
  }

  .note-actions button { min-height: 23px; padding: 2px 6px; background: transparent; color: var(--frost-muted); }
  .note-actions button:hover:not(:disabled) { background: var(--frost-hover); color: var(--frost-text); }
  .note-actions button.danger:hover:not(:disabled) { color: var(--frost-error); }

  .workspace-footer .discard-button { background: transparent; color: var(--frost-muted); }
  .workspace-footer .discard-button:hover { background: var(--frost-hover); color: var(--frost-error); }
  .workspace-footer > span {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    color: var(--frost-muted);
    font-size: 9.5px;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .confirmation {
    position: fixed;
    z-index: 90;
    inset: 0;
    width: min(340px, calc(100% - 24px));
    margin: auto;
    padding: 13px;
    border: 1px solid var(--frost-border);
    border-radius: var(--radius-md);
    background: var(--frost-surface-raised);
    color: var(--frost-text);
    box-shadow: var(--frost-shadow);
  }

  .confirmation::backdrop { background: color-mix(in srgb, var(--frost-bg) 62%, transparent); }
  .confirmation strong { font-size: 12px; }
  .confirmation p { margin: 6px 0 13px; color: var(--frost-muted); font-size: 10.5px; line-height: 1.45; }
  .confirmation footer { display: flex; justify-content: flex-end; gap: 6px; }
  .confirmation button { background: var(--frost-secondary-bg); color: var(--frost-text); }
  .confirmation button:hover { background: var(--frost-secondary-hover); }
  .confirmation .danger-confirm { color: var(--frost-error); }

  @media (max-width: 640px) {
    .workspace-body { display: block; overflow-y: auto; }
    .source-pane,
    .notes-pane { display: block; }
    .source-pane { border-right: 0; border-bottom: 1px solid var(--frost-border-soft); }
    .source-scroll,
    .notes-list { overflow: visible; }
    .annotation-source { min-height: 240px; padding-top: 16px; padding-bottom: 28px; }
    .notes-list { min-height: 130px; }
  }

  @media (max-width: 360px) {
    .workspace-heading { flex: 1; }
    .pane-heading > span { display: none; }
    .workspace-footer > span { display: none; }
    .workspace-footer .discard-button,
    .workspace-footer .primary-button { flex: 1; }
  }
</style>
