import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildFdArguments,
  buildFdFuzzyPattern,
  isWorkspacePathExcluded,
  parseFdOutput,
  parseFdVersion,
  resolveQueryScope,
  selectFdExecutable,
  WorkspaceFileSearch,
  type FdExecutable,
  type WorkspaceFileSearchOptions,
} from "../../src/extension/composer/mentions/WorkspaceFileSearch.js";

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
  it("builds an escaped fuzzy query that matches full paths", () => {
    const pattern = buildFdFuzzyPattern("/workspace", "ss[c]/x");
    expect(pattern).toContain("s.*s.*\\[.*c.*\\].*[\\\\/].*x");
    expect(new RegExp(pattern, "i").test("/workspace/docs/ss[c]/x.ts")).toBe(true);
  });

  it("parses NUL-delimited files and directories across path separators", () => {
    expect(parseFdOutput("src\\app.ts\0src\\features\\\0")).toEqual([
      { path: "src/app.ts", isDirectory: false },
      { path: "src/features", isDirectory: true },
    ]);
  });

  it("selects a modern managed fd over an older PATH fd", async () => {
    const oldFd = parseFdVersion("fd", "fd 9.0.0");
    const managedFd = parseFdVersion("/pi/bin/fd", "fd 10.2.0");
    const probe = vi.fn((command: string) => Promise.resolve(command === "fd" ? oldFd : managedFd));

    await expect(selectFdExecutable(["fd", "/pi/bin/fd"], probe)).resolves.toEqual(managedFd);
    expect(probe).toHaveBeenCalledTimes(2);
  });

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

  it("scopes continued directory completion to that directory", () => {
    const cwd = mkdtempSync(join(tmpdir(), "frostpi-files-"));
    temporaryDirectories.push(cwd);
    mkdirSync(join(cwd, "src"));

    expect(resolveQueryScope(cwd, "src/com")).toEqual({
      baseDirectory: join(cwd, "src"),
      displayPrefix: "src/",
      query: "com",
    });
  });

  it("honors conditional files.exclude rules only when the sibling exists", () => {
    const cwd = mkdtempSync(join(tmpdir(), "frostpi-exclude-"));
    temporaryDirectories.push(cwd);
    writeFileSync(join(cwd, "app.ts"), "");

    const rules = [{ pattern: "**/*.js", when: "$(basename).ts" }];
    expect(isWorkspacePathExcluded(cwd, "app.js", rules)).toBe(true);
    expect(isWorkspacePathExcluded(cwd, "other.js", rules)).toBe(false);
  });

  it("maps ignore, symlink, and exclude controls to bounded fd arguments", () => {
    const args = buildFdArguments(
      { baseDirectory: "/workspace", displayPrefix: "", query: "src" },
      {
        excludeRules: [{ pattern: "dist/**" }, { pattern: "**/*.js", when: "$(basename).ts" }],
        respectIgnoreFiles: false,
        followSymlinks: true,
      },
    );
    expect(args).toContain("500");
    expect(args).toContain("--no-ignore");
    expect(args).toContain("--follow");
    expect(args).toContain("dist/**");
    expect(args).not.toContain("**/*.js");
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
