import { describe, expect, it } from "vitest";

import {
  normalizeSourceRange,
  pendingAnnotationHasChanges,
  segmentAnnotationSource,
  sortAnnotations,
  type ResponseAnnotation,
} from "../../src/webview/features/annotation-review/annotationReviewModel.js";

describe("response annotation ranges", () => {
  it("normalizes either selection direction and excludes boundary whitespace", () => {
    expect(normalizeSourceRange("  selected text \n", 16, 0)).toEqual({ start: 2, end: 15 });
    expect(normalizeSourceRange(" \n\t", 0, 3)).toBeNull();
  });

  it("segments overlapping highlights without changing source text", () => {
    const segments = segmentAnnotationSource("abcdefgh", [
      { id: "outer", start: 1, end: 6 },
      { id: "inner", start: 3, end: 8 },
    ]);

    expect(segments).toEqual([
      { start: 0, end: 1, text: "a", annotationIds: [] },
      { start: 1, end: 3, text: "bc", annotationIds: ["outer"] },
      { start: 3, end: 6, text: "def", annotationIds: ["outer", "inner"] },
      { start: 6, end: 8, text: "gh", annotationIds: ["inner"] },
    ]);
    expect(segments.map(({ text }) => text).join("")).toBe("abcdefgh");
  });

  it("distinguishes an unchanged edit from note text that would be discarded", () => {
    const annotation = { id: "note", start: 0, end: 4, comment: "saved", createdOrder: 0 };
    const review = {
      source: "text",
      annotations: [annotation],
      pending: { mode: "edit" as const, annotationId: "note", start: 0, end: 4, comment: "saved" },
      activeAnnotationId: "note",
      nextCreatedOrder: 1,
    };

    expect(pendingAnnotationHasChanges(review)).toBe(false);
    expect(pendingAnnotationHasChanges({ ...review, pending: { ...review.pending, comment: "" } })).toBe(true);
  });

  it("uses creation order only to break equal source ranges", () => {
    const annotations: ResponseAnnotation[] = [
      { id: "later", start: 3, end: 5, comment: "", createdOrder: 2 },
      { id: "second", start: 1, end: 3, comment: "", createdOrder: 1 },
      { id: "first", start: 1, end: 3, comment: "", createdOrder: 0 },
    ];

    expect(sortAnnotations(annotations).map(({ id }) => id)).toEqual(["first", "second", "later"]);
    expect(annotations.map(({ id }) => id)).toEqual(["later", "second", "first"]);
  });
});
