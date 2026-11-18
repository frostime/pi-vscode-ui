import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { rankIndexedEntries, WorkspaceFileIndex } from "../../src/host/file-search/WorkspaceFileIndex.js";
import { WorkspaceFileSearch } from "../../src/host/file-search/WorkspaceFileSearch.js";
import { MAX_FD_RESULTS, type WorkspaceFileSearchOptions } from "../../src/host/file-search/fdArgs.js";
import type { FdExecutable } from "../../src/host/file-search/fdExecutable.js";

const searchOptions: WorkspaceFileSearchOptions = { excludeRules: [], respectIgnoreFiles: true, followSymlinks: false };
const modernFd: FdExecutable = { command: "fd", version: "10.4.2", supportsDirectoryMarkers: true };

/** A large tree: many weak matches for "ntime" before the file the user means. */
const largeListing = [
  ...Array.from({ length: MAX_FD_RESULTS * 4 }, (_, index) => `vendor/n${index}/t/i/m/e.ts`),
  "src/core/SessionRuntime.ts",
];

describe("workspace file index", () => {
  it("lists the workspace once and finds a name containing the query anywhere", async () => {
    const processes: FakeFdProcess[] = [];
    const index = new WorkspaceFileIndex({ list: () => track(processes), isExcluded: () => false });

    expect(index.entries()).toBeUndefined();
    expect(index.entries()).toBeUndefined();
    expect(processes).toHaveLength(1);
    processes[0]!.finish(0, largeListing);

    const entries = index.entries()!;
    expect(entries).toHaveLength(largeListing.length);
    expect((await rankIndexedEntries(entries, "ntime.ts", "", 3, new Set()))?.[0]).toMatchObject({ path: "src/core/SessionRuntime.ts" });
    expect((await rankIndexedEntries(entries, "Runtime", "src/core/", 3, new Set()))?.map((item) => item.path)).toEqual(["src/core/SessionRuntime.ts"]);
    expect(processes).toHaveLength(1);
  });

  it("keeps answering from a stale listing while it lists again", () => {
    let now = 0;
    const processes: FakeFdProcess[] = [];
    const index = new WorkspaceFileIndex({ list: () => track(processes), isExcluded: () => false, now: () => now, ttlMs: 100 });
    index.entries();
    processes[0]!.finish(0, ["old.ts"]);

    now = 150;
    expect(index.entries()?.map((entry) => entry.path)).toEqual(["old.ts"]);
    expect(processes).toHaveLength(2);
    processes[1]!.finish(0, ["old.ts", "new.ts"]);
    expect(index.entries()?.map((entry) => entry.path)).toEqual(["old.ts", "new.ts"]);
  });

  it("gives up on a workspace too large to index, and tries again later", () => {
    let now = 0;
    const processes: FakeFdProcess[] = [];
    const index = new WorkspaceFileIndex({ list: () => track(processes), isExcluded: () => false, now: () => now, maxEntries: 2, retryMs: 1_000 });
    index.entries();
    processes[0]!.stdout.emit("data", Buffer.from("a.ts\0b.ts\0c.ts\0"));

    expect(processes[0]!.kill).toHaveBeenCalledWith("SIGKILL");
    expect(index.entries()).toBeUndefined();
    expect(processes).toHaveLength(1);
    now = 1_000;
    index.entries();
    expect(processes).toHaveLength(2);
  });

  it("leaves out paths search never offers", () => {
    const processes: FakeFdProcess[] = [];
    const index = new WorkspaceFileIndex({ list: () => track(processes), isExcluded: (path) => path.startsWith("node_modules/") });
    index.entries();
    processes[0]!.finish(0, ["node_modules/x/index.js", "src/", "src/a.ts"]);
    expect(index.entries()).toMatchObject([{ path: "src", isDirectory: true }, { path: "src/a.ts", isDirectory: false }]);
  });

  it("stops ranking a large listing when a newer query arrives", async () => {
    const entries = Array.from({ length: 50_000 }, (_, index) => ({ path: `f${index}.ts`, lowerPath: `f${index}.ts`, isDirectory: false }));
    await expect(rankIndexedEntries(entries, "f", "", 5, new Set(), () => true)).resolves.toBeUndefined();
    await expect(rankIndexedEntries(entries, "f", "", 5, new Set(), () => false)).resolves.toHaveLength(5);
  });

  it("orders an empty query by path length, boosted paths first", async () => {
    const entries = ["a/b/c/long.ts", "short.ts", "mid/file.ts", "z/zz/zzz/boosted.ts"].map((path) => ({ path, lowerPath: path, isDirectory: false }));
    const ranked = await rankIndexedEntries(entries, "", "", 2, new Set(["z/zz/zzz/boosted.ts"]));
    expect(ranked?.map((item) => item.path)).toEqual(["z/zz/zzz/boosted.ts", "short.ts"]);
  });
});

describe("indexed workspace path search", () => {
  it("answers from fd per query until the index is ready, then from the index alone", async () => {
    const processes: FakeFdProcess[] = [];
    const argumentLists: string[][] = [];
    const search = new WorkspaceFileSearch({
      discoverFd: () => Promise.resolve(modernFd),
      spawnFd: (_command, args) => {
        argumentLists.push([...args]);
        return track(processes);
      },
    });

    const first = search.search(process.cwd(), "Runtime", 5, new Set(), searchOptions);
    await vi.waitFor(() => expect(processes).toHaveLength(2));
    // The listing has no pattern and no cap; the query's own run has both.
    const listing = argumentLists.findIndex((args) => !args.includes("--max-results"));
    const query = 1 - listing;
    expect(argumentLists[query]).toContain("--max-results");
    processes[query]!.finish(0, ["src/core/SessionRuntime.ts"]);
    await expect(first).resolves.toMatchObject([{ path: "src/core/SessionRuntime.ts" }]);

    processes[listing]!.finish(0, largeListing);
    const second = await search.search(process.cwd(), "ntime.ts", 5, new Set(), searchOptions);
    expect(second[0]).toMatchObject({ path: "src/core/SessionRuntime.ts" });
    expect(processes).toHaveLength(2);
    search.dispose();
  });
});

function track(processes: FakeFdProcess[]): ChildProcess {
  const process = new FakeFdProcess();
  processes.push(process);
  return process as unknown as ChildProcess;
}

class FakeFdProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => {
    queueMicrotask(() => this.emit("close", null));
    return true;
  });

  /** Emits stdout synchronously, as the listing's `data` handler expects to see it before close. */
  finish(code: number, paths: readonly string[]): void {
    this.stdout.emit("data", Buffer.from(paths.map((path) => `${path}\0`).join("")));
    this.emit("close", code);
  }
}
