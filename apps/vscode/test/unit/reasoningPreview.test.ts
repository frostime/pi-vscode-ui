import { describe, expect, it } from "vitest";

import { reasoningPreview } from "$ui/features/conversation/reasoningPreview";

describe("reasoning preview", () => {
  it("shows the newest line while thinking and the first line afterwards, as plain text", () => {
    const text = "**Locating the parser**\n\nI should read `src/parser.ts` first.\n- then run the tests";
    expect(reasoningPreview(text, true)).toBe("then run the tests");
    expect(reasoningPreview(text, false)).toBe("Locating the parser");
    expect(reasoningPreview("  \n\n", false)).toBe("");
  });

  it("keeps a long line to one row, from the end while thinking", () => {
    const line = `start ${"word ".repeat(60)}end`;
    expect(reasoningPreview(line, false)).toMatch(/^start .*…$/);
    expect(reasoningPreview(line, true)).toMatch(/^….* end$/);
    expect(reasoningPreview(line, true).length).toBeLessThanOrEqual(160);
  });
});
