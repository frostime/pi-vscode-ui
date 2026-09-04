import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";

import {
  annotationReviewDrafts,
  beginAnnotationEdit,
  beginAnnotationReview,
  beginPendingAnnotation,
  discardAnnotationReview,
  pruneAnnotationReviews,
  savePendingAnnotation,
  setPendingAnnotationComment,
} from "../../src/webview/features/annotation-review/annotationReviewStore.svelte.js";

describe("response annotation review drafts", () => {
  beforeEach(() => annotationReviewDrafts.set({}));

  it("keeps frozen review work isolated by Session", () => {
    beginAnnotationReview("one", "first response");
    beginAnnotationReview("two", "second response");

    expect(beginPendingAnnotation("one", 0, 5)).toBe(true);
    setPendingAnnotationComment("one", "  revise this  ");
    expect(savePendingAnnotation("one")).toBe(true);

    const reviews = get(annotationReviewDrafts);
    expect(reviews.one).toMatchObject({
      source: "first response",
      annotations: [{ start: 0, end: 5, comment: "revise this", createdOrder: 0 }],
      pending: null,
    });
    expect(reviews.two).toMatchObject({
      source: "second response",
      annotations: [],
    });
  });

  it("edits a saved note without changing its range or creation order", () => {
    beginAnnotationReview("session", "annotated text");
    beginPendingAnnotation("session", 0, 9);
    setPendingAnnotationComment("session", "first note");
    savePendingAnnotation("session");

    const annotation = get(annotationReviewDrafts).session?.annotations[0];
    expect(annotation).toBeDefined();
    expect(beginAnnotationEdit("session", annotation?.id ?? "missing")).toBe(true);
    setPendingAnnotationComment("session", "updated note");
    savePendingAnnotation("session");

    expect(get(annotationReviewDrafts).session?.annotations).toEqual([
      { ...annotation, comment: "updated note" },
    ]);
  });

  it("prunes review work when its Session leaves the presentation", () => {
    beginAnnotationReview("removed", "old response");
    beginAnnotationReview("retained", "current response");

    pruneAnnotationReviews(["retained"]);

    expect(Object.keys(get(annotationReviewDrafts))).toEqual(["retained"]);
  });

  it("discards only the selected Session review", () => {
    beginAnnotationReview("one", "first");
    beginAnnotationReview("two", "second");

    discardAnnotationReview("one");

    const reviews = get(annotationReviewDrafts);
    expect(Object.keys(reviews)).toEqual(["two"]);
    expect(reviews.two?.source).toBe("second");
  });
});
