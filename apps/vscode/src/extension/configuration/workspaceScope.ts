import * as vscode from "vscode";

import { sameCanonicalPath } from "../_shared/canonicalPath.js";

/** Returns the original workspace URI when the path belongs to an open root.
 * This preserves remote and virtual URI schemes instead of rebuilding a file URI.
 */
export function workspaceUriForPath(path: string): vscode.Uri {
  const root = vscode.workspace.workspaceFolders?.find((folder) => sameCanonicalPath(folder.uri.fsPath, path));
  return root?.uri ?? vscode.Uri.file(path);
}
