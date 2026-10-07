import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import { basename, isAbsolute, normalize, relative, resolve, sep } from "node:path";

import { canonicalPath } from "../_shared/canonicalPath.js";

const execFileAsync = promisify(execFile);

export interface GitWorktree {
  path: string;
  head?: string;
  branch?: string;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
}

export interface SessionWorkingDirectory {
  cwd: string;
  workspaceFolderCwd: string;
  worktreeRoot?: string;
  directoryName: string;
  branch?: string;
  detached?: boolean;
  isCurrent: boolean;
}

export interface SessionWorkingDirectoryDiscovery {
  directories: SessionWorkingDirectory[];
  /** True only when Git established the complete worktree boundary for this workspace. */
  authoritative: boolean;
}

interface DiscoveryDependencies {
  listWorktrees(cwd: string): Promise<string>;
  isDirectory(path: string): Promise<boolean>;
}

export async function discoverSessionWorkingDirectories(
  workspaceCwd: string,
  dependencies: Partial<DiscoveryDependencies> = {},
): Promise<SessionWorkingDirectoryDiscovery> {
  const cwd = await canonicalPath(workspaceCwd);
  const fallback = workspaceOnly(cwd);
  const listWorktrees = dependencies.listWorktrees ?? listGitWorktrees;
  const isDirectory = dependencies.isDirectory ?? pathIsDirectory;

  let worktrees: GitWorktree[];
  try {
    worktrees = parseGitWorktreeList(await listWorktrees(cwd));
  } catch {
    return fallback;
  }

  const current = worktrees
    .filter((worktree) => !worktree.prunable && pathContains(worktree.path, cwd))
    .sort((left, right) => right.path.length - left.path.length)[0];
  if (!current) return fallback;

  const relativeDirectory = relative(current.path, cwd);
  const directories: SessionWorkingDirectory[] = [{
    cwd,
    workspaceFolderCwd: cwd,
    worktreeRoot: current.path,
    directoryName: basename(current.path),
    ...(current.branch ? { branch: current.branch } : {}),
    ...(current.detached ? { detached: true } : {}),
    isCurrent: true,
  }];

  for (const worktree of worktrees) {
    if (worktree.bare || worktree.prunable || samePath(worktree.path, current.path)) continue;
    const targetCwd = resolve(worktree.path, relativeDirectory);
    if (!await isDirectory(targetCwd)) continue;
    directories.push({
      cwd: targetCwd,
      workspaceFolderCwd: cwd,
      worktreeRoot: worktree.path,
      directoryName: basename(worktree.path),
      ...(worktree.branch ? { branch: worktree.branch } : {}),
      ...(worktree.detached ? { detached: true } : {}),
      isCurrent: false,
    });
  }

  const [currentDirectory, ...linkedDirectories] = directories;
  return {
    directories: [currentDirectory!, ...linkedDirectories.sort(compareWorkingDirectories)],
    authoritative: true,
  };
}

export function parseGitWorktreeList(output: string): GitWorktree[] {
  const worktrees: GitWorktree[] = [];
  let current: GitWorktree | undefined;

  const finishCurrent = (): void => {
    if (current) worktrees.push(current);
    current = undefined;
  };

  for (const field of output.split("\0")) {
    if (!field) {
      finishCurrent();
      continue;
    }
    const separator = field.indexOf(" ");
    const key = separator === -1 ? field : field.slice(0, separator);
    const value = separator === -1 ? "" : field.slice(separator + 1);
    if (key === "worktree") {
      finishCurrent();
      current = {
        path: resolve(value),
        bare: false,
        detached: false,
        locked: false,
        prunable: false,
      };
      continue;
    }
    if (!current) continue;
    if (key === "HEAD") current.head = value;
    else if (key === "branch") current.branch = value.startsWith("refs/heads/") ? value.slice("refs/heads/".length) : value;
    else if (key === "bare") current.bare = true;
    else if (key === "detached") current.detached = true;
    else if (key === "locked") current.locked = true;
    else if (key === "prunable") current.prunable = true;
  }
  finishCurrent();
  return worktrees;
}

export function findSessionWorkingDirectory(
  directories: readonly SessionWorkingDirectory[],
  cwd: string,
): SessionWorkingDirectory | undefined {
  return directories.find((directory) => samePath(directory.cwd, cwd));
}

function workspaceOnly(cwd: string): SessionWorkingDirectoryDiscovery {
  return {
    authoritative: false,
    directories: [{
      cwd,
      workspaceFolderCwd: cwd,
      directoryName: basename(cwd),
      isCurrent: true,
    }],
  };
}

async function listGitWorktrees(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["worktree", "list", "--porcelain", "-z"], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

async function pathIsDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function compareWorkingDirectories(left: SessionWorkingDirectory, right: SessionWorkingDirectory): number {
  const leftLabel = left.branch ?? left.directoryName;
  const rightLabel = right.branch ?? right.directoryName;
  return leftLabel.localeCompare(rightLabel, undefined, { sensitivity: "base" });
}

function pathContains(parent: string, child: string): boolean {
  if (samePath(parent, child)) return true;
  const suffix = relative(resolve(parent), resolve(child));
  return Boolean(suffix && suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix));
}

function samePath(left: string, right: string): boolean {
  const a = normalize(resolve(left));
  const b = normalize(resolve(right));
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
