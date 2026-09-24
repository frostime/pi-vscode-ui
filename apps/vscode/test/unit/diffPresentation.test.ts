import { describe, expect, it } from "vitest";

import { diffStats } from "../../src/webview/features/conversation/diffPresentation.js";

describe("diffStats", () => {
  it("counts additions and deletions separately", () => {
    const diff = "@@ -1,2 +1,2 @@\n-old\n-new 2\n+new\n+new 2\n+new 3";

    expect(diffStats(diff)).toEqual({ additions: 3, deletions: 2 });
  });

  it("counts every written line of a new file as an addition", () => {
    const diff = "--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,2 @@\n+export const a = 1;\n+export const b = 2;";

    expect(diffStats(diff)).toEqual({ additions: 2, deletions: 0 });
  });

  it("never counts file headers or hunk markers as edits", () => {
    const diff = "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@";

    expect(diffStats(diff)).toBeUndefined();
  });

  it("is undefined for a diff without edited lines", () => {
    expect(diffStats("")).toBeUndefined();
  });
});
