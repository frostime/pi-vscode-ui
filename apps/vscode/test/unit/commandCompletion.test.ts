import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { commandCompletion } from "../../src/webview/features/composer/commandCompletion.js";

const commands = [
  { name: "review", source: "extension" },
  { name: "resume", source: "frostpi" },
];

function context(document: string): CompletionContext {
  const state = EditorState.create({ doc: document });
  return new CompletionContext(state, state.doc.length, true);
}

describe("slash command completion", () => {
  it("retains command identity when the query is refined", () => {
    const source = commandCompletion(commands);
    const initial = source(context("/")) as CompletionResult;
    const refined = source(context("/rev")) as CompletionResult;

    expect(refined.options[0]).toBe(initial.options[0]);
    expect(refined.options[0]?.label).toBe("/review");
  });

  it("only completes a leading slash command", () => {
    const source = commandCompletion(commands);

    expect(source(context("Please /rev"))).toBeNull();
    expect(source(context("  /rev"))).not.toBeNull();
  });
});
