import type { ComposerDraftContent } from "./composerDraftModel.js";

export interface QueuedPromptRecoveryView {
  state: "unavailable" | "ready" | "recovering";
  reason?: "session-unavailable" | "compacting" | "images-not-supported" | "image-limit";
}

export const UNAVAILABLE_QUEUED_PROMPT_RECOVERY: QueuedPromptRecoveryView = {
  state: "unavailable",
  reason: "session-unavailable",
};

export type QueuedPromptRecoveryWarning =
  | "delivery-uncertain"
  | "not-removed"
  | "images-dropped"
  | "host-size-limit"
  | "request-failed";

export interface QueuedPromptRecoveryOutcome {
  /** Confirmation of removal, not a promise that every attachment was returned. */
  certainty: "best-effort" | "confirmed";
  content: ComposerDraftContent;
  recoveredCount: number;
  /** Not confirmed removed, including unattempted/unknown results; does not imply delivery. */
  notRemovedCount: number;
  warnings: QueuedPromptRecoveryWarning[];
}

/** Preserve existing attachments if a returned image group no longer fits; report the omission. */
export function fitRecoveryImagesToDraft(
  outcome: QueuedPromptRecoveryOutcome,
  draftImageCount: number,
  maxImages: number,
): QueuedPromptRecoveryOutcome {
  if (!outcome.content.images.length || outcome.content.images.length + draftImageCount <= maxImages) return outcome;
  return {
    ...outcome,
    content: { ...outcome.content, images: [] },
    warnings: [...new Set<QueuedPromptRecoveryWarning>([...outcome.warnings, "images-dropped"])],
  };
}
