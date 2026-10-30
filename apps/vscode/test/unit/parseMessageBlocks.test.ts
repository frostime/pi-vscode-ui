import { describe, expect, it } from "vitest";

import { parseMessageBlocks } from "$ui/features/conversation/markdown/parseMessageBlocks.js";

describe("parseMessageBlocks", () => {
  it("keeps plain markdown as a single segment", () => {
    expect(parseMessageBlocks("hello **world**")).toEqual([
      { type: "markdown", text: "hello **world**" },
    ]);
  });

  it("extracts a complete mermaid fence", () => {
    const input = ["before", "```mermaid", "graph TD", "  A-->B", "```", "after"].join("\n");
    expect(parseMessageBlocks(input)).toEqual([
      { type: "markdown", text: "before" },
      { type: "mermaid", text: "graph TD\n  A-->B" },
      { type: "markdown", text: "after" },
    ]);
  });

  it("leaves incomplete mermaid fences in markdown for streaming", () => {
    const input = ["intro", "```mermaid", "graph TD", "  A-->B"].join("\n");
    expect(parseMessageBlocks(input)).toEqual([
      { type: "markdown", text: "intro\n```mermaid\ngraph TD\n  A-->B" },
    ]);
  });

  it("does not treat non-mermaid fences as diagrams", () => {
    const input = ["```ts", "const x = 1", "```"].join("\n");
    expect(parseMessageBlocks(input)).toEqual([
      { type: "markdown", text: input },
    ]);
  });

  it("supports tilde mermaid fences", () => {
    const input = ["~~~mermaid", "flowchart LR", "  A-->B", "~~~"].join("\n");
    expect(parseMessageBlocks(input)).toEqual([
      { type: "mermaid", text: "flowchart LR\n  A-->B" },
    ]);
  });
});
