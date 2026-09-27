/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import {
  diffStats,
  presentDiff,
  renderDiffHtml,
  type DiffLinePresentation,
} from "../../src/webview/features/conversation/diffPresentation.js";

function editedLines(source: string): DiffLinePresentation[] {
  return presentDiff(source).filter((line) => line.kind === "addition" || line.kind === "deletion");
}

function emphasizedText(line: DiffLinePresentation): string[] {
  return line.segments.filter((segment) => segment.emphasized).map((segment) => segment.text);
}

describe("presentDiff", () => {
  it("keeps two separate changed words apart on one line", () => {
    const [oldLine, newLine] = editedLines(
      "-// fetch user data and cache it for 10 minutes\n+// fetch user profile and cache it for 30 minutes",
    );

    expect(emphasizedText(oldLine!)).toEqual(["data", "10"]);
    expect(emphasizedText(newLine!)).toEqual(["profile", "30"]);
  });

  it("emphasizes inside deletion/addition runs of unequal size", () => {
    const presentations = editedLines(
      "-function reset(featureFlags) {\n+function reset(featureFlags, options = {}) {\n+  cache.clear();",
    );

    // The old line survives intact inside the replacement; only the insertion is new.
    expect(emphasizedText(presentations[0]!)).toEqual([]);
    expect(emphasizedText(presentations[1]!).join("")).toContain("options");
    // A wholly new line is caught by the rewrite guard: background only, no word marks.
    expect(emphasizedText(presentations[2]!)).toEqual([]);
  });

  it("falls back to whole-line highlight for a rewritten line", () => {
    const presentations = editedLines(
      "-The results show a strong correlation between cache hit rate and end-to-end latency.\n+Two confounds break this inference: warmup effects and uneven request sizes.",
    );

    for (const line of presentations) expect(emphasizedText(line)).toEqual([]);
  });

  it("never emphasizes purely new lines inside a growing run", () => {
    const presentations = editedLines(
      "-const a = 1;\n+const a = 2;\n+const b = 3;",
    );

    expect(emphasizedText(presentations[0]!)).toEqual(["1"]);
    expect(emphasizedText(presentations[1]!)).toEqual(["2"]);
    expect(emphasizedText(presentations[2]!)).toEqual([]);
  });

  it("emphasizes single changed characters in CJK prose", () => {
    const [oldLine, newLine] = editedLines("-我认为这个方案可行。\n+我认为这个草案可行。");

    expect(emphasizedText(oldLine!)).toEqual(["方"]);
    expect(emphasizedText(newLine!)).toEqual(["草"]);
  });

  it("keeps emphasis aligned after accented characters", () => {
    const [oldLine, newLine] = editedLines("-café old\n+café new");

    expect(emphasizedText(oldLine!)).toEqual(["old"]);
    expect(emphasizedText(newLine!)).toEqual(["new"]);
  });

  it("emphasizes complete emoji without breaking rendered text", () => {
    const source = "-status: 😊 ready\n+status: 😢 ready";
    const [oldLine, newLine] = editedLines(source);
    const container = document.createElement("div");
    container.innerHTML = renderDiffHtml(source);

    expect(emphasizedText(oldLine!)).toEqual(["😊"]);
    expect(emphasizedText(newLine!)).toEqual(["😢"]);
    expect(container.textContent).toBe(source);
  });

  it("leaves context, meta, and comment lines unemphasized", () => {
    const presentations = presentDiff(
      "@@ -1,2 +1,2 @@\n unchanged context\n-old\n+newer\n context again",
    );

    for (const line of presentations) {
      if (line.kind === "context" || line.kind === "meta") {
        expect(line.segments.every((segment) => !segment.emphasized)).toBe(true);
      }
    }
  });
});

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
