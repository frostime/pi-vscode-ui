import { describe, expect, it } from "vitest";

import { findPromptTokens } from "$ui/features/composer/promptSyntax.js";

describe("prompt syntax", () => {
  it("distinguishes known commands, unknown commands, and file mentions", () => {
    expect(findPromptTokens('  /review @src/a.ts @"docs/design notes.md"', new Set(["review"]))).toEqual([
      { from: 2, to: 9, kind: "command" },
      { from: 10, to: 19, kind: "file-mention" },
      { from: 20, to: 43, kind: "file-mention" },
    ]);
    expect(findPromptTokens("/missing", new Set())).toEqual([{ from: 0, to: 8, kind: "unknown-command" }]);
  });

  it("does not treat slash text after normal prose as a command", () => {
    expect(findPromptTokens("Please run /review", new Set(["review"]))).toEqual([]);
  });
});
