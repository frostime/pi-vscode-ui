import { EditorSelection, EditorState, type SelectionRange, type StateCommand } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import {
  indentPromptWithTab,
  insertPromptNewline,
  outdentPromptWithShiftTab,
} from "$ui/features/composer/promptEditing.js";

describe("prompt Tab editing", () => {
  it("inserts two spaces at an unselected cursor", () => {
    const result = runCommand("hello", EditorSelection.cursor(2), indentPromptWithTab);

    expect(result.doc.toString()).toBe("he  llo");
    expect(result.selection.main.head).toBe(4);
  });

  it("indents every line touched by a selection", () => {
    const result = runCommand("one\ntwo\nthree", EditorSelection.range(1, 7), indentPromptWithTab);

    expect(result.doc.toString()).toBe("  one\n  two\nthree");
  });

  it.each(["- item", "* item"])("indents the entire Markdown list item %s", (doc) => {
    const result = runCommand(doc, EditorSelection.cursor(4), indentPromptWithTab);

    expect(result.doc.toString()).toBe(`  ${doc}`);
    expect(result.selection.main.head).toBe(6);
  });
});

describe("prompt Shift+Tab editing", () => {
  it.each([
    ["  - item", "- item"],
    [" * item", "* item"],
    ["\t* item", "* item"],
  ])("removes one indentation unit from the current line", (doc, expected) => {
    const result = runCommand(doc, EditorSelection.cursor(doc.length), outdentPromptWithShiftTab);

    expect(result.doc.toString()).toBe(expected);
    expect(result.selection.main.head).toBe(expected.length);
  });

  it("outdents every line touched by a selection", () => {
    const result = runCommand(
      "  one\n two\nthree",
      EditorSelection.range(2, 10),
      outdentPromptWithShiftTab,
    );

    expect(result.doc.toString()).toBe("one\ntwo\nthree");
  });

  it("handles Shift+Tab on an unindented line without changing the document", () => {
    const result = runCommand("plain", EditorSelection.cursor(3), outdentPromptWithShiftTab);

    expect(result.doc.toString()).toBe("plain");
    expect(result.selection.main.head).toBe(3);
  });
});

describe("prompt Enter editing", () => {
  it.each([
    ["- alpha", "- alpha\n- "],
    ["  * alpha", "  * alpha\n  * "],
  ])("continues a non-empty Markdown list item", (doc, expected) => {
    const result = runCommand(doc, EditorSelection.cursor(doc.length), insertPromptNewline);

    expect(result.doc.toString()).toBe(expected);
    expect(result.selection.main.head).toBe(expected.length);
  });

  it.each([
    ["- ", ""],
    ["  *   ", "  "],
  ])("exits an empty Markdown list item while preserving indentation", (doc, expected) => {
    const result = runCommand(doc, EditorSelection.cursor(doc.length), insertPromptNewline);

    expect(result.doc.toString()).toBe(expected);
    expect(result.selection.main.head).toBe(expected.length);
  });

  it("defers non-list lines to CodeMirror's default Enter command", () => {
    const state = EditorState.create({ doc: "  prose", selection: EditorSelection.cursor(7) });

    expect(insertPromptNewline({ state, dispatch: () => undefined })).toBe(false);
  });
});

function runCommand(doc: string, selection: SelectionRange, command: StateCommand): EditorState {
  let result = EditorState.create({ doc, selection: { anchor: selection.anchor, head: selection.head } });
  const handled = command({
    state: result,
    dispatch: (transaction) => { result = transaction.state; },
  });
  expect(handled).toBe(true);
  return result;
}
