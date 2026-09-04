import type { ComposerDraftContent, ComposerDraftView } from "$shared/model/composerDraftModel";

import { postToHost } from "../../bridge/vscodeBridge";
import { getDraft, replaceDraftLocally, type DraftImage, type SessionDraft } from "./composerDraftStore.svelte";

export type DraftAuthority = "webview" | "host";

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

export function updateDraft(
  sessionId: string,
  authority: DraftAuthority,
  update: (draft: SessionDraft) => Omit<SessionDraft, "revision"> | SessionDraft,
): SessionDraft {
  const current = getDraft(sessionId);
  const updated = update(current);
  const next = { ...updated, revision: current.revision + 1 };
  replaceDraftLocally(sessionId, next);
  if (authority === "host") postDraftMutation(sessionId, current, next);
  return next;
}

export function setDraft(
  sessionId: string,
  authority: DraftAuthority,
  draft: ComposerDraftContent | SessionDraft,
): SessionDraft {
  return updateDraft(sessionId, authority, () => ({
    text: draft.text,
    images: draft.images.map((image) => localImage(image)),
  }));
}

export function clearDraft(sessionId: string, authority: DraftAuthority): SessionDraft {
  return updateDraft(sessionId, authority, () => ({ text: "", images: [] }));
}

export function clearDraftForSubmission(sessionId: string): number {
  const current = getDraft(sessionId);
  const clearedRevision = current.revision + 1;
  replaceDraftLocally(sessionId, { revision: clearedRevision, text: "", images: [] });
  return clearedRevision;
}

export function insertDraftText(sessionId: string, authority: DraftAuthority, text: string): SessionDraft {
  return updateDraft(sessionId, authority, (draft) => {
    const separator = draft.text.trim().length ? "\n\n" : "";
    return { ...draft, text: `${draft.text}${separator}${text}` };
  });
}

export function prefixDraftText(sessionId: string, authority: DraftAuthority, text: string): SessionDraft {
  return updateDraft(sessionId, authority, (draft) => ({
    ...draft,
    text: `${text}\n\n${draft.text}`,
  }));
}

export function setDraftText(sessionId: string, authority: DraftAuthority, text: string): SessionDraft {
  return updateDraft(sessionId, authority, (draft) => ({ ...draft, text }));
}

export function draftForHost(sessionId: string): ComposerDraftView {
  const { revision, text, images } = getDraft(sessionId);
  return {
    revision,
    text,
    images: images.map(({ id, name, mimeType, data, size }) => ({ id, name, mimeType, data, size })),
  };
}

function postDraftMutation(sessionId: string, previous: SessionDraft, draft: SessionDraft): void {
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
