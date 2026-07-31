import { describe, expect, it } from "vitest";

import { formatFileMention } from "../../src/extension/composer/mentions/formatFileMention.js";

describe("formatFileMention", () => {
  it("wraps paths and line ranges in a Markdown code span", () => {
    expect(formatFileMention("src/app.ts")).toBe("`src/app.ts`");
    expect(formatFileMention("src/app.ts", { start: 10, end: 20 })).toBe("`src/app.ts:10-20`");
    expect(formatFileMention("docs/my file.md")).toBe("`docs/my file.md`");
    expect(formatFileMention("docs/my file.md", { start: 3, end: 3 })).toBe("`docs/my file.md:3-3`");
  });
});
