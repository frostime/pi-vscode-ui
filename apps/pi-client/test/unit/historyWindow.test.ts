import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RpcSessionEntry } from "@frostime/pi-rpc";
import { afterEach, describe, expect, it } from "vitest";

import { findPreviewCursor, findPreviewStart } from "../../src/core/sessions/historyWindow.js";
import { SessionEntryPathError, SessionEntryState } from "../../src/core/sessions/SessionEntryState.js";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function sessionFile(lines: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "frostpi-history-window-"));
  dirs.push(dir);
  const file = join(dir, "session.jsonl");
  await writeFile(file, lines.map((line) => `${line}\n`).join(""));
  return file;
}

function line(id: string, padding = 0): string {
  return JSON.stringify({ type: "message", id, parentId: null, message: { role: "user", content: "x".repeat(padding) } });
}

const HEADER = JSON.stringify({ type: "session", version: 3, id: "header" });

function entry(id: string, parentId: string | null, kind: "user" | "assistant" | "compaction" = "assistant"): RpcSessionEntry {
  return kind === "compaction"
    ? { type: "compaction", id, parentId, timestamp: "", summary: "", firstKeptEntryId: id, tokensBefore: 1 }
    : { type: "message", id, parentId, timestamp: "", message: { role: kind, content: id } };
}

describe("findPreviewCursor", () => {
  it("returns the entry just before the part of the file that fits the budget", async () => {
    const file = await sessionFile([HEADER, line("a", 80), line("b", 80), line("c", 80), line("d", 80)]);
    // Room for the last two lines with their newlines, and the empty piece after the last.
    const budget = 2 * (line("c", 80).length + 1) + 1;
    expect(await findPreviewCursor(file, budget)).toBe("b");
    expect(await findPreviewCursor(file, budget - 1)).toBe("c");
  });

  it("excludes the oldest entry inside the budget when the line before it is no entry", async () => {
    const budget = 2 * (line("c", 80).length + 1) + 1;
    const file = await sessionFile([HEADER, "not json", line("c", 80), line("d", 80)]);
    expect(await findPreviewCursor(file, budget)).toBe("c");
    // The session header is not an entry either.
    expect(await findPreviewCursor(await sessionFile([HEADER, line("c", 80), line("d", 80)]), budget)).toBe("c");
  });

  it("finds nothing when the whole file fits or no entry lies within the budget", async () => {
    expect(await findPreviewCursor(await sessionFile([HEADER, line("a")]), 10_000)).toBeNull();
    expect(await findPreviewCursor(await sessionFile([HEADER, line("a"), line("huge", 500)]), 250)).toBeNull();
  });
});

describe("findPreviewStart", () => {
  it("starts at the latest prompt of the current branch, found from Pi's leaf", () => {
    const entries = [entry("u1", null, "user"), entry("a1", "u1"), entry("u2", "a1", "user"), entry("a2", "u2"), entry("t", "a2")];
    expect(findPreviewStart(entries, "t")).toBe("u2");
    expect(findPreviewStart(entries, "u2")).toBe("u2");
  });

  it("ignores a newer compaction and prompt on an abandoned branch", () => {
    // A → B ┬→ C → D → compaction K     abandoned
    //       └→ X → Y                    current, leaf Y; append order A B C D K X Y
    const suffix = [entry("C", "B", "user"), entry("D", "C"), entry("K", "D", "compaction"), entry("X", "B", "user"), entry("Y", "X")];
    expect(findPreviewStart(suffix, "Y")).toBe("X");
    // Without a prompt of its own after B, the current branch has no start in the suffix.
    const noPrompt = [entry("C", "B", "user"), entry("D", "C"), entry("K", "D", "compaction"), entry("X", "B"), entry("Y", "X")];
    expect(findPreviewStart(noPrompt, "Y")).toBeNull();
  });

  it("finds nothing for an empty branch or a leaf outside the entries", () => {
    expect(findPreviewStart([], null)).toBeNull();
    expect(findPreviewStart([entry("u", null, "user")], "elsewhere")).toBeNull();
  });
});

describe("a recent preview's active path", () => {
  it("starts at the preview's start and requires every entry from there to the leaf", () => {
    const state = new SessionEntryState();
    const entries = [entry("a", "outside"), entry("u", "a", "user"), entry("r", "u")];
    expect(state.replace(entries, "r", { startId: "u" }).activePath.map((item) => item.id)).toEqual(["u", "r"]);

    expect(() => state.replace([entry("u", "outside", "user"), entry("r", "gap")], "r", { startId: "u" })).toThrow(SessionEntryPathError);
    // A leaf on another branch does not pass through the start.
    expect(() => state.replace([entry("x", null, "user"), entry("u", null, "user")], "x", { startId: "u" })).toThrow("no longer passes through u");
  });
});
