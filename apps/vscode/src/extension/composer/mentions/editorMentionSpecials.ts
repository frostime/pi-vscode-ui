import * as vscode from "vscode";

import type { EditorMentionSpecialView } from "../../../shared/model/workspaceFileModel.js";

import { captureActiveFileReference } from "./captureActiveFile.js";
import { captureActiveSelection } from "./captureSelection.js";

/** Built-in @ completion rows (Selection / CurrentFile), filtered by the typed query. */
export function listEditorMentionSpecials(query: string): EditorMentionSpecialView[] {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") return [];

  const relative = vscode.workspace.asRelativePath(editor.document.uri, false);
  const selectionInsert = captureActiveSelection();
  const fileInsert = captureActiveFileReference();
  if (!selectionInsert || !fileInsert) return [];

  const emptySelection = editor.selection.isEmpty;
  const selectionDetail = emptySelection
    ? `${relative} · current line`
    : `${relative} · selection`;

  const specials: EditorMentionSpecialView[] = [
    {
      id: "selection",
      label: "@Selection",
      detail: selectionDetail,
      insertText: `${selectionInsert} `,
    },
    {
      id: "current-file",
      label: "@CurrentFile",
      detail: relative,
      insertText: `${fileInsert} `,
    },
  ];

  const normalized = query.trim().toLowerCase().replace(/^@/, "");
  if (!normalized) return specials;
  return specials.filter((item) => {
    const haystack = `${item.label} ${item.detail} ${item.id}`.toLowerCase();
    return haystack.includes(normalized) || item.label.toLowerCase().includes(normalized);
  });
}
