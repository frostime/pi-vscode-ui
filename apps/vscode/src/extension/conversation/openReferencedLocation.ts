import { isAbsolute, resolve } from "node:path";

import * as vscode from "vscode";

import { findWorkspaceFile } from "@frostime/pi-client/host/file-search/fallbackFileSearch";

export interface ReferencedLocation {
  path: string;
  line?: number | undefined;
  column?: number | undefined;
  endLine?: number | undefined;
}

/**
 * Opens a referenced file and applies its 1-based line/column/endLine.
 * When the path does not exist (bare filename, stale path), jumps to the best
 * fd match in the workspace; with no match, the original VS Code open error
 * surfaces unchanged.
 */
export async function openReferencedLocation(
  reference: ReferencedLocation,
  basePath?: string,
): Promise<void> {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const fsPath = isAbsolute(reference.path)
    ? reference.path
    : resolve(basePath ?? workspacePath ?? "", reference.path);
  const uri = vscode.Uri.file(fsPath);

  if (await pathExists(uri)) return openInEditor(uri, reference);

  const match = await findWorkspaceFile(reference.path, basePath ?? workspacePath);
  if (match) return openInEditor(vscode.Uri.file(match), reference);

  // Nothing plausible matched: open the original path anyway so VS Code's
  // "nonexistent file" error is what the user sees.
  return openInEditor(uri, reference);
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

const BINARY_FILE_ERROR = /\bbinary\b/i;

async function openInEditor(uri: vscode.Uri, reference: ReferencedLocation): Promise<void> {
  let document: vscode.TextDocument;
  try {
    document = await vscode.workspace.openTextDocument(uri);
  } catch (error) {
    // Images, PDFs, and other binary content cannot open as a text document.
    // Hand them to the default viewer instead; line/column targeting is
    // text-only, so there is nothing to apply afterwards. Other failures
    // (e.g. nonexistent file) surface unchanged.
    if (!BINARY_FILE_ERROR.test(String((error as Error)?.message))) throw error;
    return vscode.commands.executeCommand("vscode.open", uri, { preview: true });
  }
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
