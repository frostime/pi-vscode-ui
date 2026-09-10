import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { MarkdownImageLoadResult } from "../../../shared/bridge/hostToWebview.js";
import { hasSafeRasterDimensions, inspectRasterImage } from "./inspectRasterImage.js";

const URI_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const WINDOWS_DRIVE_PATH = /^[a-z]:[\\/]/i;
const SVG_PREFIX = /^\uFEFF?\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!DOCTYPE\s+svg(?:\s+[^<>]*)?>\s*)?(?:(?:<!--[\s\S]*?-->)\s*)*<svg(?:\s|>)/i;

export async function resolveLocalMarkdownImage(
  source: string,
  sessionCwd: string,
  maxBytes: number,
): Promise<MarkdownImageLoadResult> {
  const filePath = localFilePath(source, sessionCwd);
  if (!filePath) return { ok: false, reason: "invalidSource" };

  try {
    const file = await stat(filePath);
    if (!file.isFile()) return { ok: false, reason: "notAFile" };
    if (file.size > maxBytes) return { ok: false, reason: "tooLarge" };
    if (file.size <= 0) return { ok: false, reason: "unsupportedType" };

    const data = await readFile(filePath);
    if (data.length > maxBytes) return { ok: false, reason: "tooLarge" };
    if (data.length <= 0) return { ok: false, reason: "unsupportedType" };

    const raster = inspectRasterImage(data);
    if (raster) {
      if (!hasSafeRasterDimensions(raster)) return { ok: false, reason: "invalidDimensions" };
      return {
        ok: true,
        mimeType: raster.mimeType,
        data: data.toString("base64"),
        width: raster.width,
        height: raster.height,
      };
    }

    if (SVG_PREFIX.test(data.toString("utf8"))) {
      return { ok: true, mimeType: "image/svg+xml", data: data.toString("base64") };
    }
    return { ok: false, reason: "unsupportedType" };
  } catch (error) {
    return { ok: false, reason: nodeErrorCode(error) === "ENOENT" ? "notFound" : "readFailed" };
  }
}

function localFilePath(source: string, sessionCwd: string): string | null {
  if (!source || source.includes("\0")) return null;
  try {
    if (/^file:/i.test(source)) return fileURLToPath(source);
    if (URI_SCHEME.test(source) && !WINDOWS_DRIVE_PATH.test(source)) return null;
    let decoded = source;
    try {
      decoded = decodeURI(source);
    } catch {
      // A literal '%' is legal in a filesystem path even though it is not a
      // complete URI escape sequence.
    }
    return isAbsolute(decoded) ? decoded : resolve(sessionCwd, decoded);
  } catch {
    return null;
  }
}

function nodeErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}
