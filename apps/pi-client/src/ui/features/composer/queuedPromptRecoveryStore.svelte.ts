import { get, writable } from "svelte/store";

import type { RestoreQueuedPromptsResult } from "$shared/bridge/hostToWebview";
import type { ComposerDraftContent } from "$shared/model/composerDraftModel";
import { fitRecoveryImagesToDraft, type QueuedPromptRecoveryOutcome, type QueuedPromptRecoveryView } from "$shared/model/queuedPromptRecoveryModel";
import type { SessionViewModel } from "$shared/model/sessionViewModel";

import { postToHost } from "../../bridge/hostBridge";
import { createId } from "../../utils/createId";
import { getDraft } from "./composerDraftStore.svelte";

/**
 * Document-local correlation for the pending group's single Restore all action.
 * The Host owns queue recovery; this store only ties one in-flight request per
 * Session to its correlated result and keeps the last outcome near the Composer.
 */
export const queuedPromptRecoveryRequests = writable<Record<string, QueuedPromptRecoveryRequest>>({});
export const queuedPromptRecoveryFeedback = writable<Record<string, QueuedPromptRecoveryFeedback>>({});

export interface QueuedPromptRecoveryRequest {
  requestId: string;
  /** Attachment capacity when the request was made; later edits may leave less room for returned images. */
  maxImages: number;
}

export interface QueuedPromptRecoveryFeedback {
  level: "info" | "warning" | "error";
  headline: string;
  details: string[];
}

export interface QueuedPromptRecoveryAction {
  /** A recovery is in flight, locally or through the Host's projected state. */
  busy: boolean;
  canRestore: boolean;
  disabledReason: string | null;
}

export function isQueuedPromptRecoveryPending(sessionId: string): boolean {
  return get(queuedPromptRecoveryRequests)[sessionId] !== undefined;
}

/** Shared by the pending group and the request path so both judge availability the same way. */
export function queuedPromptRecoveryAction(
  session: SessionViewModel,
  draftImageCount: number,
  pending: boolean,
  submissionPending = false,
): QueuedPromptRecoveryAction {
  const view = session.queuedPromptRecovery;
  if (pending || view.state === "recovering") return { busy: true, canRestore: false, disabledReason: null };
  if (submissionPending) {
    return { busy: false, canRestore: false, disabledReason: "Wait for the pending send to finish before restoring." };
  }
  const disabledReason = view.state === "unavailable"
    ? unavailableReason(view)
    : imageLimitReason(session, draftImageCount);
  return { busy: false, canRestore: disabledReason === null, disabledReason };
}

/** Register before posting: the correlated result may arrive during the same frame. */
export function requestQueuedPromptRecovery(session: SessionViewModel, submissionPending = false): boolean {
  const draftImageCount = getDraft(session.id).images.length;
  if (!queuedPromptRecoveryAction(session, draftImageCount, isQueuedPromptRecoveryPending(session.id), submissionPending).canRestore) {
    return false;
  }
  const requestId = createId("recovery");
  const request: QueuedPromptRecoveryRequest = { requestId, maxImages: session.attachmentLimits.maxImages };
  queuedPromptRecoveryRequests.update((current) => ({ ...current, [session.id]: request }));
  queuedPromptRecoveryFeedback.update((current) => {
    const next = { ...current };
    delete next[session.id];
    return next;
  });
  postToHost({ type: "restoreQueuedPrompts", requestId, sessionId: session.id, draftImageCount });
  return true;
}

export type QueuedPromptRecoveryResultClaim =
  | { kind: "ignored" }
  | {
      kind: "accepted";
      sessionId: string;
      /** Set only when this Webview owns the draft and must prepend recovered content exactly once. */
      merge: ComposerDraftContent | null;
      focus: boolean;
    };

/**
 * Validate a Host result before anything edits a draft. Unknown, mismatched and
 * duplicate results resolve to `ignored`, so a stale reply never moves content.
 */
export function claimQueuedPromptRecoveryResult(result: RestoreQueuedPromptsResult): QueuedPromptRecoveryResultClaim {
  const request = get(queuedPromptRecoveryRequests)[result.sessionId];
  if (!request || request.requestId !== result.requestId) return { kind: "ignored" };
  queuedPromptRecoveryRequests.update((current) => {
    const next = { ...current };
    delete next[result.sessionId];
    return next;
  });
  let feedback: QueuedPromptRecoveryFeedback;
  let merge: ComposerDraftContent | null = null;
  if (!result.ok) {
    // The request may have failed before or after the runtime changed its queue.
    feedback = { level: "error", headline: "Could not confirm recovery.", details: [result.error] };
  } else if (result.draftTarget === "webview-merge") {
    // The latest draft owns its attachments; returned images that no longer fit are omitted, not sliced.
    const fitted = fitRecoveryImagesToDraft(result.outcome, getDraft(result.sessionId).images.length, request.maxImages);
    merge = hasContent(fitted.content) ? fitted.content : null;
    feedback = outcomeFeedback(fitted, merge !== null);
  } else {
    feedback = outcomeFeedback(result.outcome, true);
  }
  queuedPromptRecoveryFeedback.update((current) => ({ ...current, [result.sessionId]: feedback }));
  return { kind: "accepted", sessionId: result.sessionId, merge, focus: result.ok };
}

export function dismissQueuedPromptRecoveryFeedback(sessionId: string): void {
  queuedPromptRecoveryFeedback.update((current) => {
    const next = { ...current };
    delete next[sessionId];
    return next;
  });
}

const WARNING_DETAILS: Record<QueuedPromptRecoveryOutcome["warnings"][number], string> = {
  "delivery-uncertain": "Delivery of the returned content is uncertain.",
  "not-removed": "Removal was not confirmed for some pending messages.",
  "images-dropped": "Images could not be restored; the Composer draft does not include them.",
  "host-size-limit": "The host could not deliver the whole result; returned content may be incomplete.",
  "request-failed": "The recovery reply may be missing or incomplete; some pending input may not be accounted for here.",
};

function unavailableReason(view: QueuedPromptRecoveryView): string {
  switch (view.reason) {
    case "compacting":
      return "Wait for compaction to finish before restoring pending messages.";
    case "images-not-supported":
      return "Images in pending messages cannot be restored on this runtime.";
    case "image-limit":
      return "Restored images would exceed the Composer attachment limit.";
    case "session-unavailable":
    default:
      return "This Session is not available for restoring pending messages.";
  }
}

function imageLimitReason(session: SessionViewModel, draftImageCount: number): string | null {
  const pendingImages = [...session.queuedSteers, ...session.queuedFollowUps]
    .reduce((total, prompt) => total + prompt.images.length, 0);
  if (pendingImages + draftImageCount <= session.attachmentLimits.maxImages) return null;
  return `Pending and Composer images exceed the attachment limit of ${session.attachmentLimits.maxImages}.`;
}

function outcomeFeedback(
  outcome: QueuedPromptRecoveryOutcome | Omit<QueuedPromptRecoveryOutcome, "content">,
  contentReported: boolean,
): QueuedPromptRecoveryFeedback {
  const bestEffort = outcome.certainty === "best-effort";
  const warnings = new Set(outcome.warnings);
  const details: string[] = [];
  if (bestEffort) {
    details.push("Pi may still deliver input it already accepted; returning text does not cancel it.");
    details.push("Sending the draft again creates a new message.");
  }
  if (outcome.notRemovedCount > 0) {
    // Unknown and unattempted removals are included here; do not claim either outcome.
    details.push(`Removal was not confirmed for ${count(outcome.notRemovedCount, "pending message")}; delivery is unknown.`);
  }
  for (const warning of warnings) {
    // The best-effort sentences above already state the delivery limit.
    if (warning === "delivery-uncertain" && bestEffort) continue;
    if (warning === "not-removed" && outcome.notRemovedCount > 0) continue;
    details.push(WARNING_DETAILS[warning]);
  }
  const level = bestEffort || outcome.notRemovedCount > 0 || warnings.size > 0 ? "warning" : "info";
  if (outcome.recoveredCount === 0) {
    return { level, headline: "No pending content was returned.", details };
  }
  const recovered = count(outcome.recoveredCount, "pending message");
  if (!contentReported) {
    return {
      level,
      headline: bestEffort
        ? `Returned no usable content from ${recovered}.`
        : `Removed ${recovered}; nothing usable could be inserted into the Composer.`,
      details,
    };
  }
  if (!bestEffort && warnings.has("images-dropped")) {
    // A Host-applied summary deliberately omits content, so insertion cannot be inferred.
    return { level, headline: `Removed ${recovered}. Image recovery was incomplete. Nothing was sent.`, details };
  }
  return {
    level,
    headline: bestEffort
      ? `Returned text from ${recovered} into the Composer. Nothing was sent.`
      : `Restored ${recovered} into the Composer. Nothing was sent.`,
    details,
  };
}

function hasContent(content: ComposerDraftContent): boolean {
  return content.text.length > 0 || content.images.length > 0;
}

function count(total: number, singular: string): string {
  return `${total} ${singular}${total === 1 ? "" : "s"}`;
}
