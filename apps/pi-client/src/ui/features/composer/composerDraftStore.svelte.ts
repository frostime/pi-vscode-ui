import { get, writable } from "svelte/store";

import type { ComposerDraftImageView, ComposerDraftView } from "$shared/model/composerDraftModel";

export interface DraftImage extends ComposerDraftImageView {
  dataUrl: string;
}

export interface SessionDraft extends Omit<ComposerDraftView, "images"> {
  images: DraftImage[];
}

const drafts = writable<Record<string, SessionDraft>>({});
export { drafts as composerDrafts };

export function getDraft(sessionId: string): SessionDraft {
  return get(drafts)[sessionId] ?? { revision: 0, text: "", images: [] };
}

export function replaceDraftLocally(sessionId: string, draft: SessionDraft): void {
  drafts.update((all) => ({ ...all, [sessionId]: draft }));
}
