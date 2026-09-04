import { describe, expect, it } from "vitest";

import { formatAnnotationPrompt } from "../../src/webview/features/annotation-review/annotationPrompt.js";
import type { ResponseAnnotation } from "../../src/webview/features/annotation-review/annotationReviewModel.js";

describe("response annotation prompt", () => {
  it("emits the fixed envelope in source order and quotes every source line", () => {
    const source = "First passage\n\nSecond passage";
    const annotations: ResponseAnnotation[] = [
      { id: "second", start: 15, end: source.length, comment: "  Keep this.  ", createdOrder: 0 },
      { id: "first", start: 0, end: 14, comment: "Explain the gap.", createdOrder: 1 },
    ];

    expect(formatAnnotationPrompt(source, annotations)).toBe([
      "==== ANNOTATIONS ====",
      "--- ANNOTATION 01 ---\n\n> First passage\n> \n\nExplain the gap.",
      "--- ANNOTATION 02 ---\n\n> Second passage\n\nKeep this.",
      "==== END ANNOTATIONS ====",
    ].join("\n\n"));
  });

  it("does not create an empty annotation envelope", () => {
    expect(formatAnnotationPrompt("response", [])).toBe("");
  });
});
