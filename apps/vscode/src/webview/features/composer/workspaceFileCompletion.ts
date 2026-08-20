import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";

import {
  requestWorkspaceFileSuggestions,
  type WorkspaceFileSuggestionResult,
} from "./fileSuggestionClient";
import { workspaceMentionEdit, workspaceMentionReplaceTo } from "./workspaceMentionCompletion";

type SuggestionRequest = {
  promise: Promise<WorkspaceFileSuggestionResult>;
  cancel(): void;
};

type RequestSuggestions = (sessionId: string, query: string, limit: number) => SuggestionRequest;

export function workspaceFileCompletion(
  sessionId: string,
  requestSuggestions: RequestSuggestions = requestWorkspaceFileSuggestions,
): CompletionSource {
  let previousOptions = new Map<string, Completion>();

  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const match = context.matchBefore(/@(?:"[^"\n]*|[^\s@]*)/);
    if (!match) return null;
    const raw = match.text.slice(1);
    const query = raw.startsWith('"') ? raw.slice(1) : raw;
    const request = requestSuggestions(sessionId, query, 32);
    context.addEventListener("abort", request.cancel, { onDocChange: true });
    const result = await request.promise;
    if (context.aborted) return null;

    const nextOptions = new Map<string, Completion>();
    const retain = (key: string, create: () => Completion): Completion => {
      const option = previousOptions.get(key) ?? create();
      nextOptions.set(key, option);
      return option;
    };

    // CodeMirror preserves the selected row by completion object identity.
    const options: Completion[] = (result.specials ?? []).map((item) => retain(
      JSON.stringify(["special", item.id, item.label, item.detail, item.insertText]),
      () => ({
        label: item.label,
        detail: item.detail,
        apply: item.insertText,
        boost: item.id === "selection" ? 2_000 : 1_999,
      }),
    ));
    for (const item of result.items) {
      options.push(retain(
        JSON.stringify(["path", item.path, item.name, item.directory, item.isDirectory]),
        () => ({
          label: `${item.name}${item.isDirectory ? "/" : ""}`,
          detail: item.directory || "workspace root",
          type: item.isDirectory ? "folder" : "file",
          apply: (view, _completion, from, to) => {
            const edit = workspaceMentionEdit(item.path, item.isDirectory);
            const matchText = view.state.sliceDoc(from, to);
            const replaceTo = workspaceMentionReplaceTo(matchText, to, view.state.sliceDoc(to, to + 1));
            view.dispatch({
              changes: { from, to: replaceTo, insert: edit.text },
              selection: { anchor: from + edit.cursorOffset },
            });
          },
        }),
      ));
    }
    if (!options.length) {
      options.push({
        label: result.error ?? "No workspace files found",
        detail: result.error ? "file search error" : "try another path fragment",
        type: "frostpi-status",
        boost: -10_000,
        apply: () => {},
      });
    }
    previousOptions = nextOptions;
    return {
      from: match.from,
      options,
      validFor: /^@(?:"[^"\n]*|[^\s@]*)$/,
      filter: false,
    };
  };
}
