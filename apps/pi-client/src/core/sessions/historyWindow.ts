import { open } from "node:fs/promises";

import type { RpcSessionEntry } from "@frostime/pi-rpc";

/** Above this size a session file is not loaded in full automatically. */
export const FULL_HISTORY_LOAD_BYTES = 8 * 1024 * 1024;
const READ_CHUNK_BYTES = 1024 * 1024;

/**
 * The `get_entries` cursor whose following entries are the last `FULL_HISTORY_LOAD_BYTES`
 * of Pi's session file, read from its end without loading it. It bounds what a recent
 * preview may ask Pi for; it says nothing about which branch is current, which only Pi's
 * leaf decides (`findPreviewStart`). `null` means the whole file fits, or no entry lies
 * within the budget.
 *
 * Pi appends entries and never rewrites them, so lines read here keep their ids; a line
 * still being written at the end is skipped.
 */
export async function findPreviewCursor(sessionFile: string, budgetBytes: number): Promise<string | null> {
  const handle = await open(sessionFile, "r");
  try {
    const { size } = await handle.stat();
    let position = size;
    let carry: Buffer = Buffer.alloc(0);
    let bytesFromEnd = 0;
    /** The oldest entry read so far that still lies inside the budget. */
    let oldestInside: string | null = null;

    while (position > 0) {
      const length = Math.min(READ_CHUNK_BYTES, position);
      position -= length;
      const chunk = Buffer.alloc(length);
      await handle.read(chunk, 0, length, position);
      const lines = splitLines(Buffer.concat([chunk, carry]));
      // The first piece may continue in the previous chunk, unless the file starts here.
      carry = position > 0 ? lines.shift() ?? Buffer.alloc(0) : Buffer.alloc(0);

      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const raw = lines[index]!;
        bytesFromEnd += raw.length + 1;
        const id = entryId(raw);
        if (bytesFromEnd <= budgetBytes) {
          if (id) oldestInside = id;
          continue;
        }
        // The first line outside the budget ends the part a preview leaves out. If it is no
        // entry Pi knows, exclude the oldest entry inside instead, to stay within budget.
        // With no entry inside the budget there is nothing to preview.
        return oldestInside === null ? null : id ?? oldestInside;
      }
    }
    return null;
  } finally {
    await handle.close();
  }
}

/**
 * Where a recent preview starts: the most recent user message on the current branch,
 * found by walking `parentId` back from Pi's leaf through the entries Pi returned after
 * the cursor. `null` when that walk leaves those entries before reaching one, so no
 * prompt of the current branch lies within the budget. Entries of other branches, and a
 * newer compaction on an abandoned one, never decide the start.
 */
export function findPreviewStart(entries: readonly RpcSessionEntry[], leafId: string | null): string | null {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  for (let id = leafId; id !== null && !seen.has(id); ) {
    seen.add(id);
    const entry = byId.get(id);
    if (!entry) return null;
    if (isUserMessage(entry)) return entry.id;
    id = entry.parentId;
  }
  return null;
}

function isUserMessage(entry: RpcSessionEntry): boolean {
  const message = (entry as { message?: unknown }).message;
  return entry.type === "message" && isRecord(message) && message.role === "user";
}

function splitLines(data: Buffer): Buffer[] {
  const lines: Buffer[] = [];
  let start = 0;
  for (let index = data.indexOf(0x0a); index >= 0; index = data.indexOf(0x0a, start)) {
    lines.push(data.subarray(start, index));
    start = index + 1;
  }
  lines.push(data.subarray(start));
  return lines;
}

function entryId(raw: Buffer): string | null {
  if (raw.length === 0) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    return null;
  }
  // The session header is not an entry; Pi's `get_entries` does not know its id.
  if (!isRecord(value) || typeof value.id !== "string" || value.type === "session") return null;
  return value.id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
