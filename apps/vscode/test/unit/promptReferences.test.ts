import { describe, expect, it } from "vitest";
import { findPromptReferences, formatPromptReference } from "$shared/files/promptReferences";

describe("explicit prompt references", () => {
  it.each(["src/app.ts", "reports/Long report with spaces.tex:23-23", "docs/café notes.md", "C:\\work\\main.ts:2-5", "folder/", "a`b.md", "`start.md", "end.md`", " spaces ", "  "])("keeps the literal reference %s", path => {
    const text = formatPromptReference(path);
    expect(text.startsWith("ref:")).toBe(true);
    expect(findPromptReferences(text)).toEqual([expect.objectContaining({ from: 0, to: text.length, path })]);
    expect(text.slice(4)).toContain(path);
  });

  it("adds exact selected line ranges and finds several references amongst prose", () => {
    const first = formatPromptReference("src/main.ts", { start: 2, end: 7 });
    const second = formatPromptReference("docs/notes.md");
    const text = `Compare ${first} with ${second}.`;
    expect(findPromptReferences(text)).toEqual([
      expect.objectContaining({ from: 8, to: 8 + first.length, path: "src/main.ts:2-7" }),
      expect.objectContaining({ from: 8 + first.length + 6, path: "docs/notes.md" }),
    ]);
  });

  it.each([
    "ordinary `src/main.ts` and `const x = 1`", "`ref:\\`path.md\\``", "prefixref:`src/a.ts`", "ref:missing", "ref:`unclosed", "ref:``",
    "``outer\nref:`src/a.ts`\nouter``", "> ```ts\n> ref:`src/a.ts`\n> ```", "```ts\nref:`src/a.ts`\n```", "~~~\nref:`src/a.ts`\n~~~", "````md\n```\nref:`src/a.ts`\n````",
  ])("leaves ordinary code and incomplete markers literal: %s", text => {
    expect(findPromptReferences(text)).toEqual([]);
  });

  it("does not let an unmatched ordinary backtick hide a later explicit reference", () => {
    expect(findPromptReferences("An unfinished `code example\nref:``a b.md``").map(value => value.path)).toEqual(["a b.md"]);
  });

  it("does not let an indented fence-like line hide a later reference", () => {
    expect(findPromptReferences("    ```\n\nref:`outside.md`").map(value => value.path)).toEqual(["outside.md"]);
  });

  it("resumes references after closing a fenced block", () => {
    expect(findPromptReferences("```\nref:`inside.md`\n```\nref:`outside.md`").map(value => value.path)).toEqual(["outside.md"]);
  });
});
