import type { ComposerDraftContent, ComposerDraftView } from "$shared/model/composerDraftModel";

import { postToHost } from "../../bridge/vscodeBridge";
import { getDraft, replaceDraftLocally, type DraftImage, type SessionDraft } from "./composerDraftStore.svelte";

export function applyHostDraft(sessionId: string, draft: ComposerDraftView): void {
  if (draft.revision < getDraft(sessionId).revision) return;
  replaceDraftLocally(sessionId, {
    revision: draft.revision,
    text: draft.text,
    images: draft.images.map((image) => ({
      ...image,
      dataUrl: `data:${image.mimeType};base64,${image.data}`,
    })),
  });
}

export function updateDraft(sessionId: string, update: (draft: SessionDraft) => Omit<SessionDraft, "revision"> | SessionDraft): SessionDraft {
  const current = getDraft(sessionId);
  const updated = update(current);
  const next = { ...updated, revision: current.revision + 1 };
  replaceAndPost(sessionId, current, next);
  return next;
}

export function setDraft(sessionId: string, draft: ComposerDraftContent | SessionDraft): SessionDraft {
  return updateDraft(sessionId, () => ({
    text: draft.text,
    images: draft.images.map((image) => localImage(image)),
  }));
}

export function clearDraft(sessionId: string): SessionDraft {
  return updateDraft(sessionId, () => ({ text: "", images: [] }));
}

export function clearDraftForSubmission(sessionId: string): void {
  const current = getDraft(sessionId);
  replaceDraftLocally(sessionId, { revision: current.revision + 1, text: "", images: [] });
}

export function insertDraftText(sessionId: string, text: string): SessionDraft {
  return updateDraft(sessionId, (draft) => {
    const separator = draft.text.trim().length ? "\n\n" : "";
    return { ...draft, text: `${draft.text}${separator}${text}` };
  });
}

export function setDraftText(sessionId: string, text: string): SessionDraft {
  return updateDraft(sessionId, (draft) => ({ ...draft, text }));
}

function replaceAndPost(sessionId: string, previous: SessionDraft, draft: SessionDraft): void {
  replaceDraftLocally(sessionId, draft);
  const previousImageIds = new Set(previous.images.map((image) => image.id));
  postToHost({
    type: "updateComposerDraft",
    sessionId,
    draft: {
      revision: draft.revision,
      text: draft.text,
      imageIds: draft.images.map((image) => image.id),
      addedImages: draft.images
        .filter((image) => !previousImageIds.has(image.id))
        .map(({ id, name, mimeType, data, size }) => ({ id, name, mimeType, data, size })),
    },
  });
}

function localImage(image: ComposerDraftContent["images"][number] | DraftImage): DraftImage {
  return "dataUrl" in image ? { ...image } : {
    ...image,
    dataUrl: `data:${image.mimeType};base64,${image.data}`,
  };
}
