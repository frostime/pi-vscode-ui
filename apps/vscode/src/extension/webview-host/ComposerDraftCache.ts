import * as vscode from "vscode";

import type { ComposerDraftContent, ComposerDraftView } from "../../shared/model/composerDraftModel.js";

interface FailedSubmission {
  requestId: string;
  draft: ComposerDraftContent;
  clearedRevision: number;
}

export class ComposerDraftCache implements vscode.Disposable {
  readonly #drafts = new Map<string, ComposerDraftView>();
  readonly #failedSubmissions = new Map<string, FailedSubmission>();
  readonly #changeEmitter = new vscode.EventEmitter<{ sessionId: string; draft: ComposerDraftView }>();
  readonly #ownershipChangeEmitter = new vscode.EventEmitter<string>();

  readonly onDidChange = this.#changeEmitter.event;
  readonly onDidOwnershipChange = this.#ownershipChangeEmitter.event;

  get(sessionId: string): ComposerDraftView {
    return cloneDraft(this.#drafts.get(sessionId) ?? { revision: 0, text: "", images: [] });
  }

  getIfPresent(sessionId: string): ComposerDraftView | null {
    const draft = this.#drafts.get(sessionId);
    return draft ? cloneDraft(draft) : null;
  }

  hasPendingSubmission(sessionId: string): boolean {
    return this.#failedSubmissions.has(sessionId);
  }

  beginHandoff(sessionId: string, draft: ComposerDraftView): () => void {
    if (new Set(draft.images.map((image) => image.id)).size !== draft.images.length) {
      throw new Error("Composer draft image ids must be unique.");
    }
    const previous = this.#drafts.get(sessionId);
    this.#drafts.set(sessionId, cloneDraft(draft));
    return () => {
      if (previous) this.#drafts.set(sessionId, previous);
      else this.#drafts.delete(sessionId);
    };
  }

  applyMutation(
    sessionId: string,
    mutation: {
      revision: number;
      text: string;
      imageIds: readonly string[];
      addedImages: ComposerDraftContent["images"];
    },
  ): boolean {
    const current = this.#drafts.get(sessionId);
    if (current && mutation.revision <= current.revision) return false;
    if (new Set(mutation.imageIds).size !== mutation.imageIds.length) throw new Error("Composer draft image ids must be unique.");
    const available = new Map(current?.images.map((image) => [image.id, image]) ?? []);
    for (const image of mutation.addedImages) available.set(image.id, image);
    const images = mutation.imageIds.map((id) => available.get(id));
    if (images.some((image) => !image)) throw new Error("Composer draft referenced image data that is not cached by the Host.");
    this.#set(sessionId, {
      revision: mutation.revision,
      text: mutation.text,
      images: images as ComposerDraftContent["images"],
    }, false);
    return true;
  }

  replaceText(sessionId: string, text: string): ComposerDraftView {
    const current = this.get(sessionId);
    const next = { ...current, revision: current.revision + 1, text };
    this.#set(sessionId, next);
    return next;
  }

  insertText(sessionId: string, text: string): ComposerDraftView {
    const current = this.get(sessionId);
    const separator = current.text.trim().length ? "\n\n" : "";
    return this.replaceText(sessionId, `${current.text}${separator}${text}`);
  }

  beginSubmission(sessionId: string, requestId: string, submitted: ComposerDraftView): ComposerDraftContent {
    const current = this.#drafts.get(sessionId);
    if (current && submitted.revision < current.revision) {
      throw new Error("The Composer changed before this submission reached the Host. Review the current draft and send again.");
    }
    this.#drafts.set(sessionId, cloneDraft(submitted));
    const accepted = this.get(sessionId);
    const cleared = { revision: accepted.revision + 1, text: "", images: [] };
    this.#failedSubmissions.set(sessionId, {
      requestId,
      draft: { text: accepted.text, images: accepted.images },
      clearedRevision: cleared.revision,
    });
    this.#set(sessionId, cleared, false);
    return { text: accepted.text, images: accepted.images };
  }

  resolveSubmission(sessionId: string, requestId: string, succeeded: boolean): void {
    const failed = this.#failedSubmissions.get(sessionId);
    if (!failed || failed.requestId !== requestId) return;
    this.#failedSubmissions.delete(sessionId);
    if (!succeeded) {
      const current = this.#drafts.get(sessionId);
      if (current && current.revision === failed.clearedRevision && !current.text && !current.images.length) {
        this.#set(sessionId, { revision: current.revision + 1, ...failed.draft });
      }
    }
    this.#ownershipChangeEmitter.fire(sessionId);
  }

  release(sessionId: string): void {
    this.#drafts.delete(sessionId);
    this.#failedSubmissions.delete(sessionId);
  }

  dispose(): void {
    this.#drafts.clear();
    this.#failedSubmissions.clear();
    this.#changeEmitter.dispose();
    this.#ownershipChangeEmitter.dispose();
  }

  #set(sessionId: string, draft: ComposerDraftView, notify = true): void {
    const copy = cloneDraft(draft);
    this.#drafts.set(sessionId, copy);
    if (notify) this.#changeEmitter.fire({ sessionId, draft: cloneDraft(copy) });
  }
}

function cloneDraft(draft: ComposerDraftView): ComposerDraftView {
  return { revision: draft.revision, text: draft.text, images: draft.images.map((image) => ({ ...image })) };
}
