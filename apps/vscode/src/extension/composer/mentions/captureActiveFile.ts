import * as vscode from "vscode";

import { formatFileMention } from "./formatFileMention.js";

export function captureActiveFileReference(): string | undefined {
  const document = vscode.window.activeTextEditor?.document;
  if (!document || document.uri.scheme !== "file") return undefined;
  return formatFileMention(vscode.workspace.asRelativePath(document.uri, false));
}
