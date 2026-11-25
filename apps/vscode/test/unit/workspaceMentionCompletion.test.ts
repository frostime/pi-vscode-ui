import { describe, expect, it } from "vitest";

import {
  workspaceMentionEdit,
  workspaceMentionReplaceTo,
} from "$ui/features/composer/workspaceMentionCompletion.js";

describe("workspace mention completion", () => {
  it("inserts a selected file path with an explicit reference marker", () => {
    expect(workspaceMentionEdit("src/app.ts", false)).toEqual({ text: "ref:`src/app.ts` ", cursorOffset: 17 });
  });

  it("places the cursor after a completed directory path", () => {
    expect(workspaceMentionEdit("src/features", true)).toEqual({ text: "ref:`src/features/`", cursorOffset: 19 });
    expect(workspaceMentionEdit("my docs", true)).toEqual({ text: "ref:`my docs/`", cursorOffset: 14 });
  });

  it("consumes an existing closing quote only while continuing a quoted mention", () => {
    expect(workspaceMentionReplaceTo('@"my docs/', 10, '"')).toBe(11);
    expect(workspaceMentionReplaceTo("@my", 10, '"')).toBe(10);
  });
});
