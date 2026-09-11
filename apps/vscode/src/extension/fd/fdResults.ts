import { basename, dirname } from "node:path";

import type { WorkspaceFileCandidateView } from "../../shared/model/workspaceFileModel.js";

export interface FdEntry {
  path: string;
  isDirectory: boolean;
}

export function parseFdOutput(output: string): FdEntry[] {
  return output
    .split("\0")
    .filter(Boolean)
    .map((rawPath) => {
      const isDirectory = /[\\/]$/.test(rawPath);
      const path = rawPath.replace(/[\\/]$/, "").replaceAll("\\", "/").replace(/^\.\//, "");
      return { path, isDirectory };
    })
    .filter((entry) => entry.path && !entry.path.startsWith("../"));
}

export function rankFileCandidate(
  path: string,
  query: string,
  boosts: ReadonlySet<string> = new Set(),
  isDirectory = false,
): WorkspaceFileCandidateView | undefined {
  const normalizedPath = path.replaceAll("\\", "/");
  const name = basename(normalizedPath);
  const directory = dirname(normalizedPath) === "." ? "" : dirname(normalizedPath).replaceAll("\\", "/");
  const needle = query.trim().toLowerCase();
  const haystack = normalizedPath.toLowerCase();
  const fileName = name.toLowerCase();
  let score = 0;

  if (!needle) score = 10;
  else if (fileName === needle) score = 1_000;
  else if (fileName.startsWith(needle)) score = 850 - Math.min(fileName.length - needle.length, 80);
  else if (pathSegmentStartsWith(haystack, needle)) score = 700;
  else if (fileName.includes(needle)) score = 620 - fileName.indexOf(needle);
  else if (haystack.includes(needle)) score = 480 - Math.min(haystack.indexOf(needle), 120);
  else {
    const fuzzy = fuzzyScore(haystack, needle);
    if (fuzzy === undefined) return undefined;
    score = fuzzy;
  }

  if (boosts.has(normalizedPath)) score += 180;
  score -= Math.min(normalizedPath.length / 8, 60);
  return { path: normalizedPath, name, directory, score, isDirectory };
}

function pathSegmentStartsWith(path: string, query: string): boolean {
  return path.split("/").some((segment) => segment.startsWith(query));
}

function fuzzyScore(value: string, query: string): number | undefined {
  if (!query) return 1;
  let queryIndex = 0;
  let score = 260;
  let previous = -2;
  for (let index = 0; index < value.length && queryIndex < query.length; index++) {
    if (value[index] !== query[queryIndex]) continue;
    score += index === previous + 1 ? 18 : 4;
    if (index === 0 || value[index - 1] === "/" || value[index - 1] === "-" || value[index - 1] === "_") score += 12;
    previous = index;
    queryIndex++;
  }
  return queryIndex === query.length ? score : undefined;
}
