import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

import { workspaceFileCompletion } from "../../src/webview/features/composer/workspaceFileCompletion.js";

const candidate = {
  path: "src/beta.ts",
  name: "beta.ts",
  directory: "src",
  score: 10,
  isDirectory: false,
};

function context(document: string): CompletionContext {
  const state = EditorState.create({ doc: document });
  return new CompletionContext(state, state.doc.length, true);
}

function requester() {
  return vi.fn(() => ({
    cancel() {},
    promise: Promise.resolve({ items: [candidate] }),
  }));
}

describe("workspace file completion", () => {
  it("retains candidate identity across refined query results", async () => {
    const source = workspaceFileCompletion("session-1", requester());
    const initial = await source(context("@")) as CompletionResult;
    const refined = await source(context("@beta")) as CompletionResult;

    expect(refined.options[0]).toBe(initial.options[0]);
  });

  it("applies a retained candidate against the current query text", async () => {
    const source = workspaceFileCompletion("session-1", requester());
    await source(context('@"beta'));
    const refined = await source(context("@b")) as CompletionResult;
    const option = refined.options[0]!;
    if (typeof option.apply !== "function") throw new Error("Expected a completion apply function");

    const state = EditorState.create({ doc: '@b" trailing' });
    let dispatched: TransactionSpec | undefined;
    const view = {
      state,
      dispatch(spec: TransactionSpec) {
        dispatched = spec;
      },
    } as unknown as EditorView;

    option.apply(view, option, 0, 2);

    expect(dispatched).toMatchObject({
      changes: { from: 0, to: 2, insert: "`src/beta.ts` " },
      selection: { anchor: 14 },
    });
  });
});
