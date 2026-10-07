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
