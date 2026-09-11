import { basename, isAbsolute, resolve } from "node:path";

import * as vscode from "vscode";

import type { WorkspaceFileSearchOptions } from "../fd/fdArgs.js";
import { WorkspaceFileSearch } from "../fd/WorkspaceFileSearch.js";

export interface ReferencedLocation {
  path: string;
  line?: number | undefined;
  column?: number | undefined;
  endLine?: number | undefined;
}

/**
 * Deliberately narrower than mention search: no session boosts, no files.exclude
 * config — a linked file should open even when hidden from the explorer.
 */
const FALLBACK_SEARCH_OPTIONS: WorkspaceFileSearchOptions = {
  excludeRules: [],
  respectIgnoreFiles: true,
  followSymlinks: false,
};

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

/**
 * One-shot fd lookup for a reference that does not exist as given. fd output is
 * workspace-relative, so an absolute reference (typically from another machine
 * or a moved file) can never match as-is; the basename still identifies the
 * file. Best-effort: any failure keeps the caller's original behavior.
 */
async function findWorkspaceFile(
  referencePath: string,
  baseDirectory?: string,
): Promise<string | undefined> {
  if (!baseDirectory) return undefined;
  const query = isAbsolute(referencePath) ? basename(referencePath) : referencePath;
  try {
    const [top] = await new WorkspaceFileSearch().search(
      baseDirectory,
      query,
      1,
      new Set(),
      FALLBACK_SEARCH_OPTIONS,
    );
    return top && !top.isDirectory ? resolve(baseDirectory, top.path) : undefined;
  } catch {
    return undefined;
  }
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function openInEditor(uri: vscode.Uri, reference: ReferencedLocation): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
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
