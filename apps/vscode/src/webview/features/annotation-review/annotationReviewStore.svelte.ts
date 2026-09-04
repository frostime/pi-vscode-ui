import { writable } from "svelte/store";

import { createId } from "../../utils/createId";
import {
  normalizeSourceRange,
  type AnnotationReviewDraft,
} from "./annotationReviewModel";

export const annotationReviewDrafts = writable<Record<string, AnnotationReviewDraft>>({});

export function beginAnnotationReview(sessionId: string, source: string): void {
  if (!source) return;
  annotationReviewDrafts.update((drafts) => ({
    ...drafts,
    [sessionId]: {
      source,
      annotations: [],
      pending: null,
      activeAnnotationId: null,
      nextCreatedOrder: 0,
    },
  }));
}

export function beginPendingAnnotation(sessionId: string, start: number, end: number): boolean {
  let started = false;
  updateReview(sessionId, (review) => {
    const range = normalizeSourceRange(review.source, start, end);
    if (!range) return review;
    started = true;
    return {
      ...review,
      pending: { mode: "create", ...range, comment: "" },
      activeAnnotationId: null,
    };
  });
  return started;
}

export function beginAnnotationEdit(sessionId: string, annotationId: string): boolean {
  let started = false;
  updateReview(sessionId, (review) => {
    const annotation = review.annotations.find(({ id }) => id === annotationId);
    if (!annotation) return review;
    started = true;
    return {
      ...review,
      pending: {
        mode: "edit",
        annotationId,
        start: annotation.start,
        end: annotation.end,
        comment: annotation.comment,
      },
      activeAnnotationId: annotationId,
    };
  });
  return started;
}

export function setPendingAnnotationComment(sessionId: string, comment: string): void {
  updateReview(sessionId, (review) => review.pending
    ? { ...review, pending: { ...review.pending, comment } }
    : review);
}

export function savePendingAnnotation(sessionId: string): boolean {
  let saved = false;
  updateReview(sessionId, (review) => {
    const pending = review.pending;
    const comment = pending?.comment.trim() ?? "";
    if (!pending || !comment) return review;

    if (pending.mode === "edit") {
      saved = true;
      return {
        ...review,
        annotations: review.annotations.map((annotation) =>
          annotation.id === pending.annotationId ? { ...annotation, comment } : annotation),
        pending: null,
        activeAnnotationId: pending.annotationId,
      };
    }

    const id = createId("annotation");
    saved = true;
    return {
      ...review,
      annotations: [
        ...review.annotations,
        { id, start: pending.start, end: pending.end, comment, createdOrder: review.nextCreatedOrder },
      ],
      pending: null,
      activeAnnotationId: id,
      nextCreatedOrder: review.nextCreatedOrder + 1,
    };
  });
  return saved;
}

export function cancelPendingAnnotation(sessionId: string): void {
  updateReview(sessionId, (review) => ({ ...review, pending: null }));
}

export function activateAnnotation(sessionId: string, annotationId: string | null): void {
  updateReview(sessionId, (review) => ({ ...review, activeAnnotationId: annotationId }));
}

export function deleteAnnotation(sessionId: string, annotationId: string): void {
  updateReview(sessionId, (review) => ({
    ...review,
    annotations: review.annotations.filter(({ id }) => id !== annotationId),
    pending: review.pending?.mode === "edit" && review.pending.annotationId === annotationId ? null : review.pending,
    activeAnnotationId: review.activeAnnotationId === annotationId ? null : review.activeAnnotationId,
  }));
}

export function discardAnnotationReview(sessionId: string): void {
  annotationReviewDrafts.update((drafts) => {
    if (!(sessionId in drafts)) return drafts;
    const next = { ...drafts };
    delete next[sessionId];
    return next;
  });
}

export function pruneAnnotationReviews(sessionIds: readonly string[]): void {
  annotationReviewDrafts.update((drafts) => {
    const staleIds = Object.keys(drafts).filter((sessionId) => !sessionIds.includes(sessionId));
    if (staleIds.length === 0) return drafts;
    const next = { ...drafts };
    for (const sessionId of staleIds) delete next[sessionId];
    return next;
  });
}

function updateReview(
  sessionId: string,
  update: (review: AnnotationReviewDraft) => AnnotationReviewDraft,
): void {
  annotationReviewDrafts.update((drafts) => {
    const review = drafts[sessionId];
    if (!review) return drafts;
    const updated = update(review);
    return updated === review ? drafts : { ...drafts, [sessionId]: updated };
  });
}
