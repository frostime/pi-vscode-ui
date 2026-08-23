import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  discoverSessionWorkingDirectories,
  findSessionWorkingDirectory,
  parseGitWorktreeList,
} from "../../src/extension/sessions/SessionWorkingDirectories.js";

const execFileAsync = promisify(execFile);
const gitOutput = (...records: string[][]): string => records.map((fields) => `${fields.join("\0")}\0\0`).join("");

describe("Session working-directory discovery", () => {
  it("parses branch, detached, locked, bare, and prunable worktrees", () => {
    const entries = parseGitWorktreeList(gitOutput(
      ["worktree /repo", "HEAD aaaaa", "branch refs/heads/main"],
      ["worktree /locked", "HEAD bbbbb", "branch refs/heads/feature/locked", "locked maintenance"],
      ["worktree /detached", "HEAD ccccc", "detached"],
      ["worktree /bare", "bare"],
      ["worktree /gone", "HEAD ddddd", "branch refs/heads/gone", "prunable gitdir file points to non-existent location"],
    ));

    expect(entries).toEqual([
      { path: resolve("/repo"), head: "aaaaa", branch: "main", bare: false, detached: false, locked: false, prunable: false },
      { path: resolve("/locked"), head: "bbbbb", branch: "feature/locked", bare: false, detached: false, locked: true, prunable: false },
      { path: resolve("/detached"), head: "ccccc", bare: false, detached: true, locked: false, prunable: false },
      { path: resolve("/bare"), bare: true, detached: false, locked: false, prunable: false },
      { path: resolve("/gone"), head: "ddddd", branch: "gone", bare: false, detached: false, locked: false, prunable: true },
    ]);
  });

  it("uses a bare repository as the anchor for linked worktrees", async () => {
    const bare = resolve("/repo.git");
    const linked = resolve("/worktrees/feature");
    const result = await discoverSessionWorkingDirectories(bare, {
      listWorktrees: () => Promise.resolve(gitOutput(
        ["worktree /repo.git", "bare"],
        ["worktree /worktrees/feature", "HEAD bbbbb", "branch refs/heads/feature/task"],
      )),
      isDirectory: () => Promise.resolve(true),
    });

    expect(result.authoritative).toBe(true);
    expect(result.directories).toEqual([
      {
        cwd: bare,
        workspaceFolderCwd: bare,
        worktreeRoot: bare,
        directoryName: "repo.git",
        isCurrent: true,
      },
      {
        cwd: linked,
        workspaceFolderCwd: bare,
        worktreeRoot: linked,
        directoryName: "feature",
        branch: "feature/task",
        isCurrent: false,
      },
    ]);
  });

  it("maps a nested workspace directory into valid worktrees", async () => {
    const workspaceCwd = resolve("/repo/packages/api");
    const target = resolve("/worktrees/feature/packages/api");
    const result = await discoverSessionWorkingDirectories(workspaceCwd, {
      listWorktrees: () => Promise.resolve(gitOutput(
        ["worktree /repo", "HEAD aaaaa", "branch refs/heads/main"],
        ["worktree /worktrees/feature", "HEAD bbbbb", "branch refs/heads/feature/api"],
        ["worktree /worktrees/missing", "HEAD ccccc", "branch refs/heads/feature/missing"],
      )),
      isDirectory: (path) => Promise.resolve([workspaceCwd, target].some((existing) => normalize(path) === normalize(existing))),
    });

    expect(result.authoritative).toBe(true);
    expect(result.directories).toEqual([
      {
        cwd: workspaceCwd,
        workspaceFolderCwd: workspaceCwd,
        worktreeRoot: resolve("/repo"),
        directoryName: "repo",
        branch: "main",
        isCurrent: true,
      },
      {
        cwd: target,
        workspaceFolderCwd: workspaceCwd,
        worktreeRoot: resolve("/worktrees/feature"),
        directoryName: "feature",
        branch: "feature/api",
        isCurrent: false,
      },
    ]);
    expect(findSessionWorkingDirectory(result.directories, target)?.branch).toBe("feature/api");
  });

  it("discovers a linked worktree from Git's real porcelain output", async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), "frostpi-git-worktrees-")));
    const main = join(parent, "main");
    const linked = join(parent, "linked");
    await mkdir(main);
    await execFileAsync("git", ["init"], { cwd: main });
    await writeFile(join(main, "README.md"), "fixture\n");
    await execFileAsync("git", ["add", "README.md"], { cwd: main });
    await execFileAsync("git", ["-c", "user.name=FrostPi Tests", "-c", "user.email=frostpi@example.invalid", "commit", "-m", "fixture"], { cwd: main });
    await execFileAsync("git", ["worktree", "add", "--detach", linked], { cwd: main });

    const result = await discoverSessionWorkingDirectories(main);

    expect(result.authoritative).toBe(true);
    expect(findSessionWorkingDirectory(result.directories, linked)).toMatchObject({
      cwd: resolve(linked),
      worktreeRoot: resolve(linked),
      detached: true,
      isCurrent: false,
    });
  });

  it("falls back to the workspace without authorizing external directories when Git fails", async () => {
    const workspaceCwd = resolve("/repo");
    const result = await discoverSessionWorkingDirectories(workspaceCwd, {
      listWorktrees: () => Promise.reject(new Error("git unavailable")),
      isDirectory: () => Promise.resolve(true),
    });

    expect(result).toEqual({
      authoritative: false,
      directories: [{
        cwd: workspaceCwd,
        workspaceFolderCwd: workspaceCwd,
        directoryName: "repo",
        isCurrent: true,
      }],
    });
    expect(findSessionWorkingDirectory(result.directories, resolve("/worktrees/feature"))).toBeUndefined();
  });
});
