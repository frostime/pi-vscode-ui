/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { formatPromptReference } from "$shared/files/promptReferences";
import { renderMarkdownHtml } from "$ui/features/conversation/markdown/renderMarkdown";

function message(source: string, references = true): HTMLDivElement {
  const element = document.createElement("div");
  element.innerHTML = renderMarkdownHtml(source, references);
  return element;
}

describe("sent message reference tags", () => {
  it("renders the entire marker as one tag with its path and selected lines", () => {
    const path = "reference docs/Quarterly Observatory Instrument Calibration Notes.tex:2-3";
    const element = message(`before ${formatPromptReference(path)} after`);
    const tag = element.querySelector<HTMLElement>(".message-file-reference")!;
    expect(tag.title).toBe(path);
    expect(tag.querySelector(".file-reference-name")?.textContent).toBe("Quarterly Observatory Instrument Calibration Notes.tex");
    expect(tag.querySelector(".file-reference-lines")?.textContent).toBe(":2-3");
    expect(element.querySelector("p")?.textContent).toBe("before Quarterly Observatory Instrument Calibration Notes.tex:2-3 after");
    expect(element.querySelectorAll(".message-file-reference")).toHaveLength(1);
  });

  it("preserves existing managed file navigation", () => {
    const tag = message("ref:`src/main.ts:2-3`").querySelector(".message-file-reference")!;
    const link = tag.querySelector<HTMLAnchorElement>("a.file-link")!;
    expect(link.dataset.filePath).toBe("src/main.ts");
    expect(link.dataset.fileLine).toBe("2");
    expect(link.dataset.fileEndLine).toBe("3");
  });

  it("does not nest a file link inside an explicit Markdown link", () => {
    const element = message("[ref:`src/main.ts:2-3`](https://example.test/reference)");
    expect(element.querySelectorAll("a")).toHaveLength(1);
    expect(element.querySelector("a a")).toBeNull();
    expect(element.querySelector(".message-file-reference")).not.toBeNull();
  });

  it("keeps model and tool Markdown unchanged unless the caller enables prompt references", () => {
    const element = message("ref:`src/main.ts`", false);
    expect(element.querySelector(".message-file-reference")).toBeNull();
    expect(element.querySelector("p")?.textContent).toBe("ref:src/main.ts");
  });

  it.each([
    "ordinary `src/main.ts`", "prefixref:`src/main.ts`", "ref:`unfinished",
    "ref:`across\nlines.md`", "ref&#58;`src/main.ts`",
    "``ref:`src/main.ts` ``", "```text\nref:`src/main.ts`\n```",
  ])("leaves ordinary code and nonmarkers literal: %s", source => {
    expect(message(source).querySelector(".message-file-reference")).toBeNull();
  });

  it("supports repeated markers and safely displays literal filename characters", () => {
    const path = 'docs/α <img src=x>.`md';
    const element = message(`${formatPromptReference(path)} ${formatPromptReference(path)}`);
    expect(element.querySelectorAll(".message-file-reference")).toHaveLength(2);
    expect(element.querySelector<HTMLElement>(".message-file-reference")?.title).toBe(path);
    expect(element.querySelector("img")).toBeNull();
  });
});
