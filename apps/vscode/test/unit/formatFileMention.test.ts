import { describe, expect, it } from "vitest";

import { formatFileMention } from "../../src/extension/composer/mentions/formatFileMention.js";

describe("formatFileMention", () => {
  it("marks explicit paths and line ranges without reading files", () => {
    expect(formatFileMention("src/app.ts")).toBe("ref:`src/app.ts`");
    expect(formatFileMention("src/app.ts", { start: 10, end: 20 })).toBe("ref:`src/app.ts:10-20`");
    expect(formatFileMention("docs/my file.md")).toBe("ref:`docs/my file.md`");
    expect(formatFileMention("docs/my file.md", { start: 3, end: 3 })).toBe("ref:`docs/my file.md:3-3`");
  });
});
