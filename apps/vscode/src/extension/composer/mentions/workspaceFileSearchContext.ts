import { isAbsolute, relative } from "node:path";

import * as vscode from "vscode";

import type { SessionViewModel } from "../../../shared/model/sessionViewModel.js";
import type { WorkspaceFileExcludeRule } from "./WorkspaceFileSearch.js";

type ConfiguredExclude = boolean | { when?: string };

export function workspaceFileExcludeRules(
  scope: vscode.Uri,
  respectSearchExclude: boolean,
): WorkspaceFileExcludeRule[] {
  const files = vscode.workspace.getConfiguration("files", scope).get<Record<string, ConfiguredExclude>>("exclude", {});
  const rules = Object.entries(files)
    .filter(([, value]) => value === true || (typeof value === "object" && value !== null))
    .map(([pattern, value]) => ({
      pattern,
      ...(typeof value === "object" && value.when ? { when: value.when } : {}),
    }));
  if (!respectSearchExclude) return rules;

  const search = vscode.workspace.getConfiguration("search", scope).get<Record<string, ConfiguredExclude>>("exclude", {});
  for (const [pattern, value] of Object.entries(search)) {
    if (value === true || (typeof value === "object" && value !== null)) rules.push({ pattern });
  }
  return rules;
}

export function workspaceFileBoosts(session: SessionViewModel): Set<string> {
  const boosts = new Set<string>();
  const add = (path: string | undefined): void => {
    if (!path) return;
    const relativePath = (isAbsolute(path) ? relative(session.cwd, path) : path).replaceAll("\\", "/");
    if (relativePath && !relativePath.startsWith("../")) boosts.add(relativePath);
  };
  add(vscode.window.activeTextEditor?.document.uri.fsPath);
  for (const editor of vscode.window.visibleTextEditors) add(editor.document.uri.fsPath);
  for (const item of session.conversationItems) {
    if (item.type !== "turn") continue;
    for (const turnItem of item.items) {
      if (turnItem.type === "tool" && turnItem.tool.state === "bound") add(turnItem.tool.filePath);
    }
  }
  return boosts;
}
