import type { ProviderUsageDescriptor, ProviderUsageResult } from "@frostime/provider-usage/types";
import type { ChatTypographyView } from "../model/chatTypography.js";
import type { ComposerDraftView } from "../model/composerDraftModel.js";
import type { AgentTurnItemView, AgentTurnView, ConversationItemView } from "../model/conversationModel.js";
import type { SessionViewModel } from "../model/sessionViewModel.js";
import type { QueuedPromptRecoveryOutcome } from "../model/queuedPromptRecoveryModel.js";
import type { WebviewPresentationView } from "../model/webviewPresentationModel.js";
import type { EditorMentionSpecialView, WorkspaceFileCandidateView } from "../model/workspaceFileModel.js";

export type SessionBaseView = Omit<SessionViewModel, "conversationItems">;

export type MarkdownImageFailureReason =
  | "invalidSource"
  | "notFound"
  | "notAFile"
  | "tooLarge"
  | "unsupportedType"
  | "readFailed";

export type MarkdownImageLoadResult =
  | {
      ok: true;
      mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/avif" | "image/bmp" | "image/svg+xml";
      data: string;
    }
  | { ok: false; reason: MarkdownImageFailureReason };

export interface CollectionDelta<T> {
  mode: "replace" | "upsert";
  items: T[];
}

/** A changed turn the Webview already has: its own fields and only its changed items. */
export interface TurnPatch {
  turn: Omit<AgentTurnView, "items">;
  items: CollectionDelta<AgentTurnItemView>;
}

/**
 * Conversation items as a collection delta. In `upsert` mode a changed turn the Webview
 * already has arrives as a patch instead of in `items`, so a running turn with many steps
 * does not resend, and the Webview does not render again, the steps that did not change.
 */
export interface ConversationDelta extends CollectionDelta<ConversationItemView> {
  turnPatches?: TurnPatch[];
}

export interface PresentationDeltaView extends Omit<WebviewPresentationView, "displayedSession"> {
  displayedSession: {
    base: SessionBaseView;
    conversationItems: ConversationDelta;
  } | null;
}

export type RestoreQueuedPromptsResult = {
  type: "restoreQueuedPromptsResult";
  requestId: string;
  sessionId: string;
} & (
  | { ok: true; draftTarget: "host-applied"; outcome: Omit<QueuedPromptRecoveryOutcome, "content"> }
  | { ok: true; draftTarget: "webview-merge"; outcome: QueuedPromptRecoveryOutcome }
  | { ok: false; error: string }
);

export type HostToWebviewPayload =
  | RestoreQueuedPromptsResult
  | { type: "usageProvidersResult"; requestId: string; providers: readonly ProviderUsageDescriptor[] }
  | { type: "providerUsageResult"; requestId: string; results: readonly ProviderUsageResult[] }
  | { type: "providerUsageError"; requestId: string; message: string }
  | { type: "snapshot"; presentation: WebviewPresentationView; draft: ComposerDraftView | null }
  | { type: "setChatTypography"; typography: ChatTypographyView }
  | { type: "presentationDelta"; presentation: PresentationDeltaView }
  | { type: "draftReplacement"; sessionId: string; draft: ComposerDraftView }
  | { type: "replaceComposerText"; sessionId: string; text: string }
  | { type: "insertPromptText"; sessionId: string; text: string }
  | { type: "focusComposer" }
  | { type: "promptResult"; requestId: string; ok: boolean; error?: string }
  | { type: "markdownImageResult"; requestId: string; sessionId: string; result: MarkdownImageLoadResult }
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
