import { open } from "node:fs/promises";

/** Above this size, a session opens on its recent part instead of its whole file. */
export const FULL_HISTORY_LOAD_BYTES = 8 * 1024 * 1024;
/** How far back the last compaction may lie and still start the window. */
const COMPACTION_WINDOW_BYTES = 32 * 1024 * 1024;
const READ_CHUNK_BYTES = 1024 * 1024;

export interface HistoryWindow {
  /** `get_entries` cursor: the window holds every entry after this one. */
  since: string;
  /** The window starts at the last compaction, not at a recent prompt. */
  fromCompaction: boolean;
}

/**
 * Where a large session's history should start, read from the end of Pi's session file
 * without loading it. The window starts at the last compaction when one is recent
 * enough: everything after it is what the model still sees. Otherwise it starts at the
 * oldest user prompt within `FULL_HISTORY_LOAD_BYTES` of the end. `null` means the
 * whole file should load: it is small, or no usable start was found.
 *
 * Pi appends entries and never rewrites them, so lines read here keep their ids; a
 * line still being written at the end is skipped.
 */
export async function findHistoryWindow(sessionFile: string): Promise<HistoryWindow | null> {
  const handle = await open(sessionFile, "r");
  try {
    const { size } = await handle.stat();
    if (size <= FULL_HISTORY_LOAD_BYTES) return null;

    let position = size;
    let carry: Buffer = Buffer.alloc(0);
    let bytesFromEnd = 0;
    /** The line after the current one in the file, already read. */
    let later: SessionLine | null = null;
    let promptStart: HistoryWindow | null = null;
    let lastPromptWithinBudget = false;

    while (position > 0) {
      const length = Math.min(READ_CHUNK_BYTES, position);
      position -= length;
      const chunk = Buffer.alloc(length);
      await handle.read(chunk, 0, length, position);
      const data = Buffer.concat([chunk, carry]);
      const lines = splitLines(data);
      // The first piece may continue in the previous chunk, unless the file starts here.
      carry = position > 0 ? lines.shift() ?? Buffer.alloc(0) : Buffer.alloc(0);

      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const raw = lines[index]!;
        bytesFromEnd += raw.length + 1;
        const line = parseLine(raw);
        if (!line) continue;
        if (later) {
          if (later.compaction && bytesFromEnd <= COMPACTION_WINDOW_BYTES) return { since: line.id, fromCompaction: true };
          if (later.userPrompt && lastPromptWithinBudget) promptStart = { since: line.id, fromCompaction: false };
        }
        lastPromptWithinBudget = bytesFromEnd <= FULL_HISTORY_LOAD_BYTES;
        if (bytesFromEnd > COMPACTION_WINDOW_BYTES) return promptStart;
        later = line;
      }
    }
    return promptStart;
  } finally {
    await handle.close();
  }
}

interface SessionLine {
  id: string;
  compaction: boolean;
  userPrompt: boolean;
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

function parseLine(raw: Buffer): SessionLine | null {
  if (raw.length === 0) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    return null;
  }
  // The session header is not an entry; Pi's `get_entries` does not know its id.
  if (!isRecord(value) || typeof value.id !== "string" || value.type === "session") return null;
  const message = isRecord(value.message) ? value.message : undefined;
  return {
    id: value.id,
    compaction: value.type === "compaction",
    userPrompt: value.type === "message" && message?.role === "user",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
