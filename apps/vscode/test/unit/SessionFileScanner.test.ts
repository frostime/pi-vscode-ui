import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  buildRipgrepArguments,
  scanSessionFilesWithRipgrep,
  selectRipgrepExecutable,
  sessionPathKey,
} from "../../src/extension/sessions/catalog/SessionFileScanner.js";

describe("ripgrep session scanning", () => {
  it("recovers headers and the latest title by file offset", async () => {
    const process = new FakeRipgrepProcess();
    const path = resolve(tmpdir(), "renamed.jsonl");
    const scan = fakeScan(process);

    await scan.ready;
    process.finish(0, [
      matchEvent(path, 0, { type: "session", id: "session-id", cwd: resolve("workspace") }),
      matchEvent(path, 500, { type: "session_info", name: "Newer title" }),
      matchEvent(path, 100, { type: "session_info", name: "Older title" }),
      endEvent(path, 1_000),
    ]);

    const result = await scan.result;
    expect(result.complete).toBe(true);
    if (!result.complete) return;
    expect(result.sessions.get(sessionPathKey(path))).toEqual({
      cwd: resolve("workspace"),
      bytesScanned: 1_000,
      sessionId: "session-id",
      sessionInfo: { name: "Newer title" },
    });
  });

  it("preserves an empty latest name as an explicit title clear", async () => {
    const process = new FakeRipgrepProcess();
    const path = resolve(tmpdir(), "cleared.jsonl");
    const scan = fakeScan(process);

    await scan.ready;
    process.finish(0, [
      matchEvent(path, 0, { type: "session", cwd: resolve("workspace") }),
      matchEvent(path, 100, { type: "session_info", name: "Old title" }),
      matchEvent(path, 200, { type: "session_info", name: "   " }),
      endEvent(path, 500),
    ]);

    const result = await scan.result;
    expect(result.complete).toBe(true);
    if (!result.complete) return;
    expect(result.sessions.get(sessionPathKey(path))?.sessionInfo).toEqual({ name: undefined });
  });

  it("does not accept a session header beyond the bounded header window", async () => {
    const process = new FakeRipgrepProcess();
    const path = resolve(tmpdir(), "late-header.jsonl");
    const scan = fakeScan(process);

    await scan.ready;
    process.finish(0, [
      matchEvent(path, 70_000, { type: "session", cwd: resolve("workspace") }),
      matchEvent(path, 71_000, { type: "session_info", name: "Late" }),
      endEvent(path, 72_000),
    ]);

    const result = await scan.result;
    expect(result.complete).toBe(true);
    if (!result.complete) return;
    expect(result.sessions.has(sessionPathKey(path))).toBe(false);
  });

  it("discards partial output when ripgrep fails", async () => {
    const process = new FakeRipgrepProcess();
    const path = resolve(tmpdir(), "partial.jsonl");
    const scan = fakeScan(process);

    await scan.ready;
    process.finish(2, [matchEvent(path, 0, { type: "session", cwd: resolve("workspace") })]);

    await expect(scan.result).resolves.toEqual({ complete: false });
  });

  it("reassembles ripgrep events split across stdout chunks", async () => {
    const process = new FakeRipgrepProcess();
    const path = resolve(tmpdir(), "chunked.jsonl");
    const scan = fakeScan(process);
    const output = [
      matchEvent(path, 0, { type: "session", cwd: resolve("workspace") }),
      matchEvent(path, 100, { type: "session_info", name: "Chunked" }),
      endEvent(path, 200),
    ].join("\n") + "\n";

    await scan.ready;
    process.write(output.slice(0, 37));
    process.write(output.slice(37));
    process.close(0);

    const result = await scan.result;
    expect(result.complete).toBe(true);
    if (!result.complete) return;
    expect(result.sessions.get(sessionPathKey(path))?.sessionInfo).toEqual({ name: "Chunked" });
  });

  it("falls back on malformed protocol output", async () => {
    const process = new FakeRipgrepProcess();
    const scan = fakeScan(process);

    await scan.ready;
    process.write("{not-json}\n");
    process.close(0);

    await expect(scan.result).resolves.toEqual({ complete: false });
  });

  it("falls back without retaining an oversized protocol event", async () => {
    const process = new FakeRipgrepProcess();
    const scan = fakeScan(process);

    await scan.ready;
    process.write("x".repeat(1024 * 1024 + 1));
    process.write("\n");
    process.close(0);

    await expect(scan.result).resolves.toEqual({ complete: false });
  });

  it("falls back when spawning ripgrep throws", async () => {
    const result = scanSessionFilesWithRipgrep([tmpdir()], {
      ripgrep: Promise.resolve("rg"),
      spawnRipgrep: () => { throw new Error("spawn failed"); },
    });

    await expect(result).resolves.toEqual({ complete: false });
  });

  it("kills ripgrep and falls back on stdout errors", async () => {
    const process = new FakeRipgrepProcess();
    const scan = fakeScan(process);

    await scan.ready;
    process.stdout.emit("error", new Error("stream failed"));

    await expect(scan.result).resolves.toEqual({ complete: false });
    expect(process.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("treats no matches as a complete empty scan", async () => {
    const process = new FakeRipgrepProcess();
    const scan = fakeScan(process);

    await scan.ready;
    process.finish(1, []);

    await expect(scan.result).resolves.toEqual({ complete: true, sessions: new Map() });
  });

  it("skips missing roots instead of treating ripgrep's partial exit as failure", async () => {
    const process = new FakeRipgrepProcess();
    const spawnRipgrep = vi.fn((_command: string, args: readonly string[]) => {
      expect(args).toContain(tmpdir());
      expect(args).not.toContain(resolve(tmpdir(), "frostpi-missing-session-root"));
      return process as unknown as ChildProcess;
    });
    const result = scanSessionFilesWithRipgrep([tmpdir(), resolve(tmpdir(), "frostpi-missing-session-root")], {
      ripgrep: Promise.resolve("rg"),
      spawnRipgrep,
    });

    await vi.waitFor(() => expect(spawnRipgrep).toHaveBeenCalledOnce());
    process.finish(1, []);

    await expect(result).resolves.toEqual({ complete: true, sessions: new Map() });
  });

  it("uses traversal flags that preserve Pi session roots", () => {
    const args = buildRipgrepArguments([tmpdir()]);
    expect(args).toEqual(expect.arrayContaining([
      "--json",
      "--no-config",
      "--no-ignore",
      "--hidden",
      "--text",
      "--glob",
      "*.jsonl",
    ]));
    expect(args[args.indexOf("--regexp") + 1]).toBe('^\\{"type"\\s*:\\s*"(session|session_info)"');
    expect(args.at(-1)).toBe(tmpdir());
  });

  it("selects the first available executable", async () => {
    const probe = vi.fn((command: string) => Promise.resolve(command === "/pi/bin/rg"));
    await expect(selectRipgrepExecutable(["rg", "/pi/bin/rg"], probe)).resolves.toBe("/pi/bin/rg");
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

function fakeScan(process: FakeRipgrepProcess): {
  result: ReturnType<typeof scanSessionFilesWithRipgrep>;
  ready: Promise<void>;
} {
  const spawnRipgrep = vi.fn(() => process as unknown as ChildProcess);
  const result = scanSessionFilesWithRipgrep([tmpdir()], {
    ripgrep: Promise.resolve("rg"),
    spawnRipgrep,
  });
  const ready = vi.waitFor(() => expect(spawnRipgrep).toHaveBeenCalledOnce());
  return { result, ready };
}

function endEvent(path: string, bytesScanned: number): string {
  return JSON.stringify({
    type: "end",
    data: { path: { text: path }, stats: { bytes_searched: bytesScanned } },
  });
}

function matchEvent(path: string, absoluteOffset: number, entry: Record<string, unknown>): string {
  return JSON.stringify({
    type: "match",
    data: {
      path: { text: path },
      lines: { text: `${JSON.stringify(entry)}\n` },
      line_number: 1,
      absolute_offset: absoluteOffset,
      submatches: [],
    },
  });
}

class FakeRipgrepProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => true);

  write(output: string): void {
    this.stdout.write(output);
  }

  close(code: number): void {
    this.emit("close", code);
  }

  finish(code: number, events: readonly string[]): void {
    if (events.length) this.write(`${events.join("\n")}\n`);
    this.close(code);
  }
}
