import { basename, isAbsolute, resolve } from "node:path";

import type { WorkspaceFileSearchOptions } from "./fdArgs.js";
import { WorkspaceFileSearch } from "./WorkspaceFileSearch.js";

/**
 * Deliberately narrower than mention search: no session boosts and no
 * files.exclude configuration — a linked file should open even when hidden
 * from the explorer.
 */
const FALLBACK_SEARCH_OPTIONS: WorkspaceFileSearchOptions = {
  excludeRules: [],
  respectIgnoreFiles: true,
  followSymlinks: false,
};

/**
 * One-shot fd lookup for a reference that does not exist as given.
 *
 * fd output is workspace-relative, so an absolute reference (typically from
 * another machine or a moved file) can never match as-is; its basename still
 * identifies the file. Best-effort: any failure counts as no match, so callers
 * keep their own missing-target behavior. A directory match never counts,
 * because the reference named a file. Both hosts share this policy so a link
 * behaves the same way in VS Code and Desktop.
 */
export async function findWorkspaceFile(
  referencePath: string,
  baseDirectory: string | undefined,
  search: Pick<WorkspaceFileSearch, "search"> = new WorkspaceFileSearch(),
): Promise<string | undefined> {
  if (!baseDirectory) return undefined;
  const query = isAbsolute(referencePath) ? basename(referencePath) : referencePath;
  try {
    const [top] = await search.search(baseDirectory, query, 1, new Set(), FALLBACK_SEARCH_OPTIONS);
    return top && !top.isDirectory ? resolve(baseDirectory, top.path) : undefined;
  } catch {
    return undefined;
  }
}
