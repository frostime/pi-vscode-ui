import { isAbsolute, resolve } from "node:path";

import * as vscode from "vscode";

export interface ReferencedLocation {
  path: string;
  line?: number | undefined;
  column?: number | undefined;
  endLine?: number | undefined;
}

export async function openReferencedLocation(
  reference: ReferencedLocation,
  basePath?: string,
): Promise<void> {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const fsPath = isAbsolute(reference.path)
    ? reference.path
    : resolve(basePath ?? workspacePath ?? "", reference.path);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath));
  const editor = await vscode.window.showTextDocument(document, { preview: true });
  if (reference.line === undefined) return;

  const start = document.validatePosition(
    new vscode.Position(reference.line - 1, (reference.column ?? 1) - 1),
  );
  const end = reference.endLine === undefined
    ? start
    : document.lineAt(
      document.validatePosition(new vscode.Position(reference.endLine - 1, 0)).line,
    ).range.end;
  editor.selection = new vscode.Selection(start, end);
  editor.revealRange(
    new vscode.Range(start, end),
    vscode.TextEditorRevealType.InCenterIfOutsideViewport,
  );
}
