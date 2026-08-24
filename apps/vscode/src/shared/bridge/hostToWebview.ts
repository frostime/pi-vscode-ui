import type { ChatTypographyView } from "../model/chatTypography.js";
import type { ComposerDraftView } from "../model/composerDraftModel.js";
import type { ConversationItemView } from "../model/conversationModel.js";
import type { SessionViewModel } from "../model/sessionViewModel.js";
import type { WebviewPresentationView } from "../model/webviewPresentationModel.js";
import type { EditorMentionSpecialView, WorkspaceFileCandidateView } from "../model/workspaceFileModel.js";

export type SessionBaseView = Omit<SessionViewModel, "conversationItems">;

export interface CollectionDelta<T> {
  mode: "replace" | "upsert";
  items: T[];
}

export interface PresentationDeltaView extends Omit<WebviewPresentationView, "displayedSession"> {
  displayedSession: {
    base: SessionBaseView;
    conversationItems: CollectionDelta<ConversationItemView>;
  } | null;
}

export type HostToWebviewPayload =
  | { type: "snapshot"; presentation: WebviewPresentationView; draft: ComposerDraftView | null }
  | { type: "setChatTypography"; typography: ChatTypographyView }
  | { type: "presentationDelta"; presentation: PresentationDeltaView }
  | { type: "draftReplacement"; sessionId: string; draft: ComposerDraftView }
  | { type: "replaceComposerText"; sessionId: string; text: string }
  | { type: "insertPromptText"; sessionId: string; text: string }
  | { type: "focusComposer" }
  | { type: "promptResult"; requestId: string; ok: boolean; error?: string }
  | {
      type: "forkResult";
      requestId: string;
      ok: boolean;
      cancelled?: boolean;
      forkSessionId?: string;
      error?: string;
    }
  | { type: "workspaceFileSuggestions"; requestId: string; items: WorkspaceFileCandidateView[]; specials?: EditorMentionSpecialView[]; error?: string }
  | { type: "toast"; level: "info" | "warning" | "error"; message: string };

export type HostToWebviewMessage = HostToWebviewPayload & { bridgeVersion: string };
