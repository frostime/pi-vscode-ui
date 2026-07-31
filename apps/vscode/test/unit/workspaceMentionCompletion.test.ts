import { describe, expect, it } from "vitest";

import {
  workspaceMentionEdit,
  workspaceMentionReplaceTo,
} from "../../src/webview/features/composer/workspaceMentionCompletion.js";

describe("workspace mention completion", () => {
  it("inserts a selected file path wrapped in backticks", () => {
    expect(workspaceMentionEdit("src/app.ts", false)).toEqual({ text: "`src/app.ts` ", cursorOffset: 13 });
  });

  it("inserts a selected directory path wrapped in backticks", () => {
    expect(workspaceMentionEdit("src/features", true)).toEqual({ text: "`src/features/`", cursorOffset: 14 });
  });

  it("keeps the cursor before the closing backtick for directories", () => {
    expect(workspaceMentionEdit("my docs", true)).toEqual({ text: "`my docs/`", cursorOffset: 9 });
  });

  it("consumes an existing closing quote only while continuing a quoted mention", () => {
    expect(workspaceMentionReplaceTo('@"my docs/', 10, '"')).toBe(11);
    expect(workspaceMentionReplaceTo("@my", 10, '"')).toBe(10);
  });
});
