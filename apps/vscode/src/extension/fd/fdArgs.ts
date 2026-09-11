import { isAbsolute, relative, resolve } from "node:path";

export interface WorkspaceFileExcludeRule {
  pattern: string;
  when?: string;
}

export interface WorkspaceFileSearchOptions {
  excludeRules: readonly WorkspaceFileExcludeRule[];
  respectIgnoreFiles: boolean;
  followSymlinks: boolean;
}

export interface ScopedQuery {
  baseDirectory: string;
  displayPrefix: string;
  query: string;
}

const MAX_FD_RESULTS = 500;

/**
 * Scopes a query to its directory prefix when that directory exists under the
 * workspace (e.g. "src/com" searches from "src/"). The existence check is
 * injected so this stays a pure path computation.
 */
export function resolveQueryScope(
  cwd: string,
  query: string,
  isDirectory: (path: string) => boolean,
): ScopedQuery {
  const normalized = query.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  if (slash < 0 || isAbsolute(normalized)) return { baseDirectory: cwd, displayPrefix: "", query: normalized };

  const displayPrefix = normalized.slice(0, slash + 1);
  const baseDirectory = resolve(cwd, displayPrefix);
  const relativeBase = relative(cwd, baseDirectory);
  if (relativeBase.startsWith("..") || isAbsolute(relativeBase) || !isDirectory(baseDirectory)) {
    return { baseDirectory: cwd, displayPrefix: "", query: normalized };
  }
  return { baseDirectory, displayPrefix, query: normalized.slice(slash + 1) };
}

export function buildFdArguments(
  scope: ScopedQuery,
  options: WorkspaceFileSearchOptions,
  includeDirectories = true,
): string[] {
  const args = [
    "--base-directory", scope.baseDirectory,
    "--max-results", String(MAX_FD_RESULTS),
    "--type", "file",
  ];
  if (includeDirectories) args.push("--type", "directory");
  args.push(
    "--color", "never",
    "--print0",
    "--hidden",
    "--ignore-case",
    "--exclude", ".git",
    "--exclude", "node_modules",
  );
  if (!options.respectIgnoreFiles) args.push("--no-ignore");
  if (options.followSymlinks) args.push("--follow");
  for (const rule of options.excludeRules) {
    if (!rule.when) args.push("--exclude", normalizeGlob(rule.pattern));
  }
  if (scope.query) args.push("--full-path", "--", buildFdFuzzyPattern(scope.baseDirectory, scope.query));
  return args;
}

export function buildFdFuzzyPattern(baseDirectory: string, query: string): string {
  const base = [...baseDirectory.replaceAll("\\", "/")]
    .map((character) => character === "/" ? "[\\\\/]" : escapeRegex(character))
    .join("");
  const fuzzy = [...query.replaceAll("\\", "/")]
    .map((character) => character === "/" ? "[\\\\/]" : escapeRegex(character))
    .join(".*");
  return `^${base}[\\\\/].*${fuzzy}`;
}

export function normalizeGlob(pattern: string): string {
  const normalized = pattern.replaceAll("\\", "/");
  return normalized.startsWith("/") ? normalized.slice(1) : normalized;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
