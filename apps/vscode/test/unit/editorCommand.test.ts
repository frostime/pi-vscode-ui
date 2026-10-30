import { describe, expect, it } from "vitest";

import { composerEditorPrefill } from "$ui/features/composer/editorCommand.js";

describe("composerEditorPrefill", () => {
  it("treats bare /editor as an empty external-editor buffer", () => {
    expect(composerEditorPrefill("/editor")).toBe("");
    expect(composerEditorPrefill("  /editor  ")).toBe("");
  });

  it("uses text after /editor as the buffer prefill", () => {
    expect(composerEditorPrefill("/editor hello")).toBe("hello");
    expect(composerEditorPrefill("/editor\n\nline one\nline two")).toBe("line one\nline two");
  });

  it("ignores non-editor prompts and longer command names", () => {
    expect(composerEditorPrefill("hello")).toBeNull();
    expect(composerEditorPrefill("/resume")).toBeNull();
    expect(composerEditorPrefill("/editors")).toBeNull();
    expect(composerEditorPrefill("/editorialize")).toBeNull();
  });
});
