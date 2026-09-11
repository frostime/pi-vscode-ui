import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { isWorkspacePathExcluded, WorkspaceFileSearch } from "../../src/extension/fd/WorkspaceFileSearch.js";
import type { WorkspaceFileSearchOptions } from "../../src/extension/fd/fdArgs.js";
import { parseFdVersion, type FdExecutable } from "../../src/extension/fd/fdExecutable.js";

const temporaryDirectories: string[] = [];
const searchOptions: WorkspaceFileSearchOptions = {
  excludeRules: [],
  respectIgnoreFiles: true,
  followSymlinks: true,
};
const modernFd: FdExecutable = { command: "fd", version: "10.4.2", supportsDirectoryMarkers: true };

afterEach(() => {
  vi.useRealTimers();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

describe("workspace path search", () => {
  it("falls back to file-only search and reports a legacy fd once", async () => {
    const oldFd = parseFdVersion("fd", "fd 9.0.0");
    const processes: FakeFdProcess[] = [];
    const argumentLists: string[][] = [];
    const onLegacyFd = vi.fn();
    const search = new WorkspaceFileSearch({
      discoverFd: () => Promise.resolve(oldFd),
      spawnFd: (_command, args) => {
        argumentLists.push([...args]);
        const process = new FakeFdProcess();
        processes.push(process);
        return process as unknown as ChildProcess;
      },
      onLegacyFd,
    });

    const first = search.search(process.cwd(), "", 20, new Set(), searchOptions);
    await vi.waitFor(() => expect(processes).toHaveLength(1));
    processes[0]?.finish(0, "src/app.ts\0");
    await first;
    const second = search.search(process.cwd(), "", 20, new Set(), searchOptions);
    await vi.waitFor(() => expect(processes).toHaveLength(2));
    processes[1]?.finish(0, "src/other.ts\0");
    await second;

    expect(argumentLists[0]).not.toContain("directory");
    expect(onLegacyFd).toHaveBeenCalledOnce();
  });

  it("terminates an older query when a new search starts", async () => {
    const processes: FakeFdProcess[] = [];
    const search = searchWithProcesses(processes);
    const first = search.search(process.cwd(), "first", 20, new Set(), searchOptions);
    await vi.waitFor(() => expect(processes).toHaveLength(1));

    const second = search.search(process.cwd(), "second", 20, new Set(), searchOptions);
    await vi.waitFor(() => expect(processes).toHaveLength(2));
    processes[1]?.finish(0, "second.ts\0");

    await expect(first).resolves.toEqual([]);
    await expect(second).resolves.toMatchObject([{ path: "second.ts" }]);
    expect(processes[0]?.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("terminates an active query when disposed", async () => {
    const processes: FakeFdProcess[] = [];
    const search = searchWithProcesses(processes);
    const result = search.search(process.cwd(), "query", 20, new Set(), searchOptions);
    await vi.waitFor(() => expect(processes).toHaveLength(1));

    search.dispose();

    await expect(result).resolves.toEqual([]);
    expect(processes[0]?.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("reports fd stderr on a non-zero exit", async () => {
    const processes: FakeFdProcess[] = [];
    const search = searchWithProcesses(processes);
    const result = search.search(process.cwd(), "query", 20, new Set(), searchOptions);
    await vi.waitFor(() => expect(processes).toHaveLength(1));
    processes[0]?.finish(2, "", "invalid pattern");

    await expect(result).rejects.toThrow("invalid pattern");
  });

  it("kills and rejects a search that exceeds its timeout", async () => {
    vi.useFakeTimers();
    const processes: FakeFdProcess[] = [];
    const search = searchWithProcesses(processes, 50);
    const result = search.search(process.cwd(), "query", 20, new Set(), searchOptions);
    await vi.advanceTimersByTimeAsync(0);
    expect(processes).toHaveLength(1);

    const rejection = expect(result).rejects.toThrow("timed out after 50 ms");
    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    expect(processes[0]?.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("honors conditional files.exclude rules only when the sibling exists", () => {
    const cwd = mkdtempSync(join(tmpdir(), "frostpi-exclude-"));
    temporaryDirectories.push(cwd);
    writeFileSync(join(cwd, "app.ts"), "");

    const rules = [{ pattern: "**/*.js", when: "$(basename).ts" }];
    expect(isWorkspacePathExcluded(cwd, "app.js", rules)).toBe(true);
    expect(isWorkspacePathExcluded(cwd, "other.js", rules)).toBe(false);
  });
});

function searchWithProcesses(processes: FakeFdProcess[], timeoutMs?: number): WorkspaceFileSearch {
  return new WorkspaceFileSearch({
    discoverFd: () => Promise.resolve(modernFd),
    spawnFd: () => {
      const process = new FakeFdProcess();
      processes.push(process);
      return process as unknown as ChildProcess;
    },
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

class FakeFdProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => {
    queueMicrotask(() => this.emit("close", null));
    return true;
  });

  finish(code: number, stdout = "", stderr = ""): void {
    if (stdout) this.stdout.write(stdout);
    if (stderr) this.stderr.write(stderr);
    this.emit("close", code);
  }
}
