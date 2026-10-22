import { open } from "node:fs/promises";
// The package's UMD main leaves dynamic requires in a bundled Electron entry.
import { parse, type ParseError } from "jsonc-parser/lib/esm/main.js";
import type { DesktopSettingsValues } from "../../shared/desktopSettings.js";

export const MAX_SETTINGS_BYTES = 1024 * 1024;

/** Bound the read before parsing. Filesystem errors remain identifiable by callers. */
export async function readSettingsObject(filePath: string): Promise<DesktopSettingsValues> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(MAX_SETTINGS_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_SETTINGS_BYTES) throw new Error("Settings file exceeds 1 MiB.");
    const text = buffer.subarray(0, length).toString("utf8").replace(/^\uFEFF/, "");
    const errors: ParseError[] = [];
    const values: unknown = parse(text, errors, { allowTrailingComma: true });
    if (errors.length || !values || typeof values !== "object" || Array.isArray(values)) {
      throw new Error("Settings must contain a JSONC object.");
    }
    return values as DesktopSettingsValues;
  } finally {
    await handle.close();
  }
}
