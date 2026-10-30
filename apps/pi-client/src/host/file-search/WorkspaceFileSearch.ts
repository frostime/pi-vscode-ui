import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";

import { minimatch } from "minimatch";

import {
  buildFdArguments,
  normalizeGlob,
  resolveQueryScope,
  type ScopedQuery,
  type WorkspaceFileExcludeRule,
  type WorkspaceFileSearchOptions,
} from "./fdArgs.js";
import { parseFdOutput, rankFileCandidate, type FdEntry } from "./fdResults.js";
import { discoverFdExecutable, type FdExecutable } from "./fdExecutable.js";
import type { WorkspaceFileCandidateView } from "../../shared/model/workspaceFileModel.js";

const FD_TIMEOUT_MS = 7_000;

export interface WorkspaceFileSearchDependencies {
  discoverFd?: () => Promise<FdExecutable>;
  spawnFd?: (command: string, args: readonly string[]) => ChildProcess;
  timeoutMs?: number;
  onLegacyFd?: (fd: FdExecutable) => void;
}

export class WorkspaceFileSearch {
  readonly #discoverFd: () => Promise<FdExecutable>;
  readonly #spawnFd: (command: string, args: readonly string[]) => ChildProcess;
  readonly #timeoutMs: number;
  readonly #onLegacyFd: ((fd: FdExecutable) => void) | undefined;
  #activeProcess: ChildProcess | undefined;
  #fdDiscovery: Promise<FdExecutable> | undefined;
  #legacyFdReported = false;
  #searchVersion = 0;

  constructor(dependencies: WorkspaceFileSearchDependencies = {}) {
    this.#discoverFd = dependencies.discoverFd ?? discoverFdExecutable;
    this.#spawnFd = dependencies.spawnFd ?? ((command, args) => spawn(command, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }));
    this.#timeoutMs = dependencies.timeoutMs ?? FD_TIMEOUT_MS;
    this.#onLegacyFd = dependencies.onLegacyFd;
  }

  async search(
    cwd: string,
    query: string,
    limit: number,
    boosts: ReadonlySet<string>,
    options: WorkspaceFileSearchOptions,
  ): Promise<WorkspaceFileCandidateView[]> {
    const version = ++this.#searchVersion;
    this.#activeProcess?.kill("SIGKILL");

    const fd = await this.#resolvedFd();
    if (version !== this.#searchVersion) return [];
    if (!fd.supportsDirectoryMarkers && !this.#legacyFdReported) {
      this.#legacyFdReported = true;
      this.#onLegacyFd?.(fd);
    }

    const scope = resolveQueryScope(cwd, query, isDirectory);
    const entries = await this.#runFd(fd, scope, options, version);
    if (version !== this.#searchVersion) return [];

    const candidates = entries
      .map((entry) => ({ ...entry, path: `${scope.displayPrefix}${entry.path}` }))
      .filter((entry) => !isAlwaysExcluded(entry.path))
      .filter((entry) => !isWorkspacePathExcluded(cwd, entry.path, options.excludeRules))
      .map((entry) => rankFileCandidate(entry.path, query, boosts, entry.isDirectory))
      .filter((candidate): candidate is WorkspaceFileCandidateView => Boolean(candidate))
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
    return candidates.slice(0, limit);
  }

  dispose(): void {
    this.#searchVersion++;
    this.#activeProcess?.kill("SIGKILL");
    this.#activeProcess = undefined;
  }

  async #resolvedFd(): Promise<FdExecutable> {
    const discovery = this.#fdDiscovery ?? this.#discoverFd();
    this.#fdDiscovery = discovery;
    try {
      return await discovery;
    } catch (error) {
      if (this.#fdDiscovery === discovery) this.#fdDiscovery = undefined;
      throw error;
    }
  }

  async #runFd(
    fd: FdExecutable,
    scope: ScopedQuery,
    options: WorkspaceFileSearchOptions,
    version: number,
  ): Promise<FdEntry[]> {
    const args = buildFdArguments(scope, options, fd.supportsDirectoryMarkers);
    return new Promise((resolvePromise, reject) => {
      const child = this.#spawnFd(fd.command, args);
      this.#activeProcess = child;
      const stdout: Buffer[] = [];
      let stderr = "";
      let settled = false;
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        action();
      };
      const timer = setTimeout(() => {
        if (this.#activeProcess === child) this.#activeProcess = undefined;
        if (version !== this.#searchVersion) finish(() => resolvePromise([]));
        else finish(() => reject(new Error(`Workspace path search timed out after ${this.#timeoutMs} ms.`)));
        child.kill("SIGKILL");
      }, this.#timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
      child.on("error", (error) => finish(() => reject(new Error(`Failed to start fd: ${error.message}`))));
      child.on("close", (code) => {
        if (this.#activeProcess === child) this.#activeProcess = undefined;
        if (version !== this.#searchVersion) {
          finish(() => resolvePromise([]));
          return;
        }
        if (code !== 0) {
          finish(() => reject(new Error(stderr.trim() || `fd exited with code ${code ?? "unknown"}.`)));
          return;
        }
        finish(() => resolvePromise(parseFdOutput(Buffer.concat(stdout).toString("utf8"))));
      });
    });
  }
}

/** Applies workspace `files.exclude` rules, including conditional sibling-file rules. */
export function isWorkspacePathExcluded(cwd: string, path: string, rules: readonly WorkspaceFileExcludeRule[]): boolean {
  return rules.some((rule) => {
    if (!matchesGlob(path, rule.pattern)) return false;
    if (!rule.when) return true;
    const name = basename(path, extname(path));
    const sibling = rule.when.replaceAll("$(basename)", name);
    return existsSync(resolve(cwd, dirname(path), sibling));
  });
}

function matchesGlob(path: string, pattern: string): boolean {
  const normalized = normalizeGlob(pattern);
  const options = { dot: true, nocase: process.platform === "win32", matchBase: !normalized.includes("/") };
  return minimatch(path, normalized, options) || minimatch(path, `${normalized.replace(/\/$/, "")}/**`, options);
}

function isAlwaysExcluded(path: string): boolean {
  return path === ".git" || path.startsWith(".git/") || path.includes("/.git/")
    || path === "node_modules" || path.startsWith("node_modules/") || path.includes("/node_modules/");
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
