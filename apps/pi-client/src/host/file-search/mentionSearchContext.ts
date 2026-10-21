import { isAbsolute, relative } from "node:path";

import type { SessionViewModel } from "../../shared/model/sessionViewModel.js";
import type { ClientHost } from "../clientHost.js";
import type { WorkspaceFileExcludeRule } from "./fdArgs.js";

type ConfiguredExclude = boolean | { when?: string };

/**
 * `files.exclude` / `search.exclude` shapes resolved through the host configuration hook.
 * VS Code supplies its real settings via `getConfiguration("files"|"search", cwd)`;
 * Desktop passes equivalent project exclude rules (or none).
 */
export function workspaceFileExcludeRules(
  host: ClientHost,
  cwd: string,
  respectSearchExclude: boolean,
): WorkspaceFileExcludeRule[] {
  const files = host.configuration
    .getConfiguration("files", cwd)
    .get<Record<string, ConfiguredExclude>>("exclude", {});
  const rules = Object.entries(files)
    .filter(([, value]) => value === true || (typeof value === "object" && value !== null))
    .map(([pattern, value]) => ({
      pattern,
      ...(typeof value === "object" && value.when ? { when: value.when } : {}),
    }));
  if (!respectSearchExclude) return rules;

  const search = host.configuration
    .getConfiguration("search", cwd)
    .get<Record<string, ConfiguredExclude>>("exclude", {});
  for (const [pattern, value] of Object.entries(search)) {
    if (value === true || (typeof value === "object" && value !== null)) rules.push({ pattern });
  }
  return rules;
}

/** Completion ranking boosts: session context plus host-provided open editor paths. */
export function workspaceFileBoosts(
  host: ClientHost,
  session: SessionViewModel,
): Set<string> {
  const boosts = new Set<string>();
  const add = (path: string | undefined): void => {
    if (!path) return;
    const relativePath = (isAbsolute(path) ? relative(session.cwd, path) : path).replaceAll("\\", "/");
    if (relativePath && !relativePath.startsWith("../")) boosts.add(relativePath);
  };
  for (const path of host.editor.fileBoostPaths?.() ?? []) add(path);
  for (const item of session.conversationItems) {
    if (item.type !== "turn") continue;
    for (const turnItem of item.items) {
      if (turnItem.type === "tool" && turnItem.tool.state === "bound") add(turnItem.tool.recognized?.location?.path);
    }
  }
  return boosts;
}
