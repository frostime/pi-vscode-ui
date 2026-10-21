import { realpathSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Resolve a path to the spelling the platform reports: through the real
 * filesystem, so on Windows the drive letter and directory names come back
 * in their on-disk casing instead of whatever casing the caller happened to
 * pass in (e.g. VS Code Uri.fsPath, which lowercases drive letters).
 * Falls back to the lexically resolved path when the target does not exist.
 */
export async function canonicalPath(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch {
    return absolute;
  }
}

/** Compare aliases without changing their spelling. The lexical fast path avoids
 * filesystem access for ordinary matches; the synchronous fallback also works
 * at VS Code's synchronous configuration-scope boundary.
 */
export function sameCanonicalPath(left: string, right: string): boolean {
  const a = resolve(left);
  const b = resolve(right);
  if (pathKey(a) === pathKey(b)) return true;
  return pathKey(realPathOrAbsolute(a)) === pathKey(realPathOrAbsolute(b));
}

function realPathOrAbsolute(absolute: string): string {
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

function pathKey(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}
