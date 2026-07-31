import { get, writable } from "svelte/store";

export interface DraftImage {
  id: string;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  data: string;
  dataUrl: string;
  size: number;
}

export interface SessionDraft {
  text: string;
  images: DraftImage[];
}

const drafts = writable<Record<string, SessionDraft>>({});
export { drafts as composerDrafts };

export function getDraft(sessionId: string): SessionDraft {
  return get(drafts)[sessionId] ?? { text: "", images: [] };
}

export function updateDraft(sessionId: string, update: (draft: SessionDraft) => SessionDraft): void {
  drafts.update((all) => ({ ...all, [sessionId]: update(all[sessionId] ?? { text: "", images: [] }) }));
}

export function setDraft(sessionId: string, draft: SessionDraft): void {
  drafts.update((all) => ({ ...all, [sessionId]: draft }));
}

export function clearDraft(sessionId: string): void {
  drafts.update((all) => ({ ...all, [sessionId]: { text: "", images: [] } }));
}

export function insertDraftText(sessionId: string, text: string): void {
  updateDraft(sessionId, (draft) => {
    const separator = draft.text.trim().length ? "\n\n" : "";
    return { ...draft, text: `${draft.text}${separator}${text}` };
  });
}

export function setDraftText(sessionId: string, text: string): void {
  updateDraft(sessionId, (draft) => ({ ...draft, text }));
}
