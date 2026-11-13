import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FULL_HISTORY_LOAD_BYTES, findHistoryWindow } from "../../src/core/sessions/historyWindow.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function sessionFile(lines: unknown[], trailing = ""): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "frostpi-history-window-"));
  directories.push(directory);
  const file = join(directory, "session.jsonl");
  await writeFile(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n" + trailing);
  return file;
}

const header = { type: "session", id: "header", version: 3 };
const user = (id: string) => ({ type: "message", id, parentId: null, message: { role: "user", content: id } });
/** About one MiB of assistant text, so a few of them pass the full-load bound. */
const bulky = (id: string) => ({ type: "message", id, parentId: null, message: { role: "assistant", content: "x".repeat(1024 * 1024) } });
const compaction = (id: string) => ({ type: "compaction", id, parentId: null, summary: "Summary", firstKeptEntryId: "u1" });

describe("history window of a large session", () => {
  it("loads a small session in full", async () => {
    expect(await findHistoryWindow(await sessionFile([header, user("u1"), user("u2")]))).toBeNull();
  });

  it("starts at the last compaction: the window holds the compaction and everything after it", async () => {
    const before = Array.from({ length: 10 }, (_, index) => bulky(`old-${index}`));
    const file = await sessionFile([header, user("u1"), ...before, compaction("c1"), bulky("a1"), user("u2"), compaction("c2"), user("u3")]);
    expect(await findHistoryWindow(file)).toEqual({ since: "u2", fromCompaction: true });
  });

  it("without a compaction, starts at the oldest prompt within the full-load bound", async () => {
    const lines: Array<{ id: string } & Record<string, unknown>> = [header];
    for (let index = 0; index < 12; index += 1) lines.push(user(`u${index}`), bulky(`a${index}`));
    const file = await sessionFile(lines, '{"type":"message","id":"half-writ');
    const window = await findHistoryWindow(file);

    expect(window?.fromCompaction).toBe(false);
    // The prompt after the cursor starts a suffix that fits; the one before it does not.
    const cursorIndex = lines.findIndex((line) => line.id === window?.since);
    const suffix = lines.slice(cursorIndex + 1);
    expect(suffix[0]).toMatchObject({ message: { role: "user" } });
    expect(suffix.map((line) => JSON.stringify(line).length + 1).reduce((sum, bytes) => sum + bytes, 0)).toBeLessThanOrEqual(FULL_HISTORY_LOAD_BYTES);
    expect(lines.slice(cursorIndex - 1).map((line) => JSON.stringify(line).length + 1).reduce((sum, bytes) => sum + bytes, 0)).toBeGreaterThan(FULL_HISTORY_LOAD_BYTES);
  });

  it("never uses the session header as a cursor", async () => {
    const file = await sessionFile([header, compaction("c1"), ...Array.from({ length: 9 }, (_, index) => bulky(`a${index}`))]);
    expect(await findHistoryWindow(file)).toBeNull();
  });
});
