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

export const MAX_FD_RESULTS = 500;

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

/**
 * fd runs for one query. The fuzzy run matches the query's characters in order anywhere in
 * the path. fd stops it at MAX_FD_RESULTS in traversal order, so in a large tree a short
 * query can fill that cap with weak matches and miss the files the user means. The exact
 * run, absent for an empty query, then finds names that contain the query, or paths when the
 * query holds a slash. Every exact match is also a fuzzy match, so it is needed only when
 * the fuzzy run was cut off.
 */
export function buildFdArgumentPasses(
  scope: ScopedQuery,
  options: WorkspaceFileSearchOptions,
  includeDirectories = true,
): { fuzzy: string[]; exact?: string[] } {
  const base = baseFdArguments(scope, options, includeDirectories);
  if (!scope.query) return { fuzzy: base };
  return {
    fuzzy: [...base, "--full-path", "--", buildFdFuzzyPattern(scope.baseDirectory, scope.query)],
    exact: /[\\/]/.test(scope.query)
      ? [...base, "--full-path", "--", buildFdSubstringPattern(scope.baseDirectory, scope.query)]
      : [...base, "--", escapeRegex(scope.query)],
  };
}

function baseFdArguments(
  scope: ScopedQuery,
  options: WorkspaceFileSearchOptions,
  includeDirectories: boolean,
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
  return args;
}

/** Full-path pattern for a path below `baseDirectory` that contains `query` as written. */
export function buildFdSubstringPattern(baseDirectory: string, query: string): string {
  return `^${pathPattern(baseDirectory)}[\\\\/].*${[...query.replaceAll("\\", "/")].map(characterPattern).join("")}`;
}

/** Full-path pattern for a path below `baseDirectory` that contains `query`'s characters in order. */
export function buildFdFuzzyPattern(baseDirectory: string, query: string): string {
  return `^${pathPattern(baseDirectory)}[\\\\/].*${[...query.replaceAll("\\", "/")].map(characterPattern).join(".*")}`;
}

function pathPattern(path: string): string {
  return [...path.replaceAll("\\", "/")].map(characterPattern).join("");
}

function characterPattern(character: string): string {
  return character === "/" ? "[\\\\/]" : escapeRegex(character);
}

export function normalizeGlob(pattern: string): string {
  const normalized = pattern.replaceAll("\\", "/");
  return normalized.startsWith("/") ? normalized.slice(1) : normalized;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
