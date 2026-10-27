import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
// The package's UMD main leaves dynamic requires in a bundled Node entry.
import { parse, visit, type ParseError } from "jsonc-parser/lib/esm/main.js";

export const MAX_JSON_BYTES = 1024 * 1024;

/** Bound the read before parsing. Filesystem errors remain identifiable by callers. */
export async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(MAX_JSON_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_JSON_BYTES) throw new Error("JSON file exceeds 1 MiB.");
    const text = buffer.subarray(0, length).toString("utf8").replace(/^\uFEFF/, "");
    return parseJsonObject(text);
  } finally {
    await handle.close();
  }
}

/** The published parser treats __proto__ as a setter; reject it instead of losing data on reload. */
export function parseJsonObject(text: string): Record<string, unknown> {
  if (Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) throw new Error("JSON file exceeds 1 MiB.");
  let unsupportedProperty = false;
  visit(text, { onObjectProperty: (name) => { if (name === "__proto__") unsupportedProperty = true; } }, { allowTrailingComma: true });
  if (unsupportedProperty) throw new Error("The JSON object contains an unsupported property.");
  const errors: ParseError[] = [];
  const values: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("The file must contain a JSONC object.");
  }
  return values as Record<string, unknown>;
}

/** Replace only after the whole file is written. Callers own serialization and write ordering. */
export async function writeFileAtomically(filePath: string, text: string): Promise<void> {
  if (Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) throw new Error("JSON file exceeds 1 MiB.");
  const tempPath = join(dirname(filePath), `.frostpi-${randomUUID()}.tmp`);
  let created = false;
  try {
    await mkdir(dirname(filePath), { recursive: true });
    const handle = await open(tempPath, "wx", 0o600);
    created = true;
    try { await handle.writeFile(text, "utf8"); }
    finally { await handle.close(); }
    await rename(tempPath, filePath);
    created = false;
  } finally {
    if (created) await unlink(tempPath).catch(() => {});
  }
}
