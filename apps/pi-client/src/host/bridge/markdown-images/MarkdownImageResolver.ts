import { readFile, stat } from "node:fs/promises";
import { posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";

import type { MarkdownImageLoadResult } from "../../../shared/bridge/hostToWebview.js";
import { detectRasterImageMimeType } from "./detectRasterImageMimeType.js";

const URI_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const WINDOWS_DRIVE_PATH = /^[a-z]:[\\/]/i;
const SVG_PREFIX = /^\uFEFF?\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!DOCTYPE\s+svg(?:\s+[^<>]*)?>\s*)?(?:(?:<!--[\s\S]*?-->)\s*)*<svg(?:\s|>)/i;

export async function resolveLocalMarkdownImage(
  source: string,
  sessionCwd: string,
  maxBytes: number,
  platform: NodeJS.Platform = process.platform,
): Promise<MarkdownImageLoadResult> {
  const filePath = localFilePath(source, sessionCwd, platform);
  if (!filePath) return { ok: false, reason: "invalidSource" };

  try {
    const file = await stat(filePath);
    if (!file.isFile()) return { ok: false, reason: "notAFile" };
    if (file.size > maxBytes) return { ok: false, reason: "tooLarge" };
    if (file.size <= 0) return { ok: false, reason: "unsupportedType" };

    const data = await readFile(filePath);
    if (data.length > maxBytes) return { ok: false, reason: "tooLarge" };
    return classifyMarkdownImageBytes(data);
  } catch (error) {
    return { ok: false, reason: nodeErrorCode(error) === "ENOENT" ? "notFound" : "readFailed" };
  }
}

/** Identifies supported image content from its bytes, never from a name or a declared type. */
export function classifyMarkdownImageBytes(data: Buffer): MarkdownImageLoadResult {
  if (data.length <= 0) return { ok: false, reason: "unsupportedType" };

  const rasterMimeType = detectRasterImageMimeType(data);
  if (rasterMimeType) {
    return { ok: true, mimeType: rasterMimeType, data: data.toString("base64") };
  }

  if (SVG_PREFIX.test(data.toString("utf8"))) {
    return { ok: true, mimeType: "image/svg+xml", data: data.toString("base64") };
  }
  return { ok: false, reason: "unsupportedType" };
}

function localFilePath(source: string, sessionCwd: string, platform: NodeJS.Platform): string | null {
  if (!source || source.includes("\0")) return null;
  const windows = platform === "win32";
  const paths = windows ? win32 : posix;
  try {
    let filePath: string;
    if (/^file:/i.test(source)) {
      // `file://server/share/…` is a UNC path on Windows, judged below like any other
      // path; everywhere else a host is invalid and the conversion throws.
      filePath = fileURLToPath(source, { windows });
    } else {
      if (URI_SCHEME.test(source) && !WINDOWS_DRIVE_PATH.test(source)) return null;
      let decoded = source;
      try {
        decoded = decodeURI(source);
      } catch {
        // A literal '%' is legal in a filesystem path even though it is not a
        // complete URI escape sequence.
      }
      filePath = paths.isAbsolute(decoded) ? decoded : paths.resolve(sessionCwd, decoded);
    }
    if (windows && leavesSessionForWindowsNetwork(filePath, sessionCwd)) return null;
    return filePath;
  } catch {
    return null;
  }
}

/**
 * Message content loads local images without a prompt, so it must not be able to make
 * Windows open a connection (and offer the user's credentials) to a server it names.
 * UNC paths (`\\server\share`, `//server/share`) are therefore refused before any
 * filesystem call, except on the share that holds the Session's own working directory.
 * Device-namespace paths (`\\?\…`, `\\.\…`) are always refused: they can name a share
 * indirectly (`\\?\UNC\server\…`) and their parsed root does not identify the server.
 */
function leavesSessionForWindowsNetwork(filePath: string, sessionCwd: string): boolean {
  const root = windowsRoot(filePath);
  if (!/^[\\/]{2}/.test(root)) return false;
  if (/^[\\/]{2}[?.][\\/]/.test(root)) return true;
  return root !== windowsRoot(sessionCwd);
}

function windowsRoot(value: string): string {
  return win32.parse(win32.resolve(value)).root.toLowerCase();
}

function nodeErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}
