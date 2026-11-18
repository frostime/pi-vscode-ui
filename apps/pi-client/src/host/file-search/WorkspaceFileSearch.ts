import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";

import { minimatch } from "minimatch";

import {
  buildFdArgumentPasses,
  buildFdIndexArguments,
  MAX_FD_RESULTS,
  normalizeGlob,
  resolveQueryScope,
  type WorkspaceFileExcludeRule,
  type WorkspaceFileSearchOptions,
} from "./fdArgs.js";
import { parseFdOutput, rankFileCandidate, type FdEntry } from "./fdResults.js";
import { discoverFdExecutable, type FdExecutable } from "./fdExecutable.js";
import { compareCandidates, rankIndexedEntries, WorkspaceFileIndex, type WorkspaceFileIndexOptions } from "./WorkspaceFileIndex.js";
import type { WorkspaceFileCandidateView } from "../../shared/model/workspaceFileModel.js";

const FD_TIMEOUT_MS = 7_000;
/** Indexes kept at once, one per working directory and search configuration. */
const MAX_INDEXES = 4;

export interface WorkspaceFileSearchDependencies {
  discoverFd?: () => Promise<FdExecutable>;
  spawnFd?: (command: string, args: readonly string[]) => ChildProcess;
  timeoutMs?: number;
  onLegacyFd?: (fd: FdExecutable) => void;
  /** Off, every query runs fd; tests of the per-query path turn it off. */
  indexFiles?: boolean;
  indexOptions?: Pick<WorkspaceFileIndexOptions, "now" | "ttlMs" | "buildTimeoutMs" | "retryMs" | "maxEntries">;
}

export class WorkspaceFileSearch {
  readonly #discoverFd: () => Promise<FdExecutable>;
  readonly #spawnFd: (command: string, args: readonly string[]) => ChildProcess;
  readonly #timeoutMs: number;
  readonly #onLegacyFd: ((fd: FdExecutable) => void) | undefined;
  readonly #indexFiles: boolean;
  readonly #indexOptions: WorkspaceFileSearchDependencies["indexOptions"];
  /** Most recently used last. */
  readonly #indexes = new Map<string, WorkspaceFileIndex>();
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
    this.#indexFiles = dependencies.indexFiles ?? true;
    this.#indexOptions = dependencies.indexOptions;
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
    this.#activeProcess = undefined;

    const fd = await this.#resolvedFd();
    if (version !== this.#searchVersion) return [];
    if (!fd.supportsDirectoryMarkers && !this.#legacyFdReported) {
      this.#legacyFdReported = true;
      this.#onLegacyFd?.(fd);
    }

    const scope = resolveQueryScope(cwd, query, isDirectory);
    const indexed = this.#indexFiles ? this.#index(cwd, options, fd).entries() : undefined;
    if (indexed) {
      // Rank a few extra in case conditional files.exclude rules drop some.
      const ranked = await rankIndexedEntries(indexed, query, scope.displayPrefix, limit * 2, boosts, () => version !== this.#searchVersion);
      if (!ranked) return [];
      return ranked.filter((candidate) => !isWorkspacePathExcluded(cwd, candidate.path, options.excludeRules)).slice(0, limit);
    }

    const passes = buildFdArgumentPasses(scope, options, fd.supportsDirectoryMarkers);
    const deadline = Date.now() + this.#timeoutMs;
    const candidates = new Map<string, WorkspaceFileCandidateView>();
    const collect = (entries: readonly FdEntry[]): void => {
      for (const entry of entries) {
        const path = `${scope.displayPrefix}${entry.path}`;
        if (candidates.has(path) || isAlwaysExcluded(path) || isWorkspacePathExcluded(cwd, path, options.excludeRules)) continue;
        const candidate = rankFileCandidate(path, query, boosts, entry.isDirectory);
        if (candidate) candidates.set(path, candidate);
      }
    };

    let fuzzy: FdEntry[];
    try {
      fuzzy = await this.#runFd(fd, passes.fuzzy, version, this.#timeoutMs);
    } catch (error) {
      throw error instanceof FdTimeoutError ? new Error(`Workspace path search timed out after ${this.#timeoutMs} ms.`) : error;
    }
    if (version !== this.#searchVersion) return [];
    collect(fuzzy);
    // A cut-off fuzzy run may have missed files whose names contain the query. The exact run
    // gets the time left; if it runs out, the fuzzy matches still stand.
    if (passes.exact && fuzzy.length >= MAX_FD_RESULTS) {
      try {
        const exact = await this.#runFd(fd, passes.exact, version, Math.max(deadline - Date.now(), 0));
        if (version !== this.#searchVersion) return [];
        collect(exact);
      } catch (error) {
        if (!(error instanceof FdTimeoutError)) throw error;
      }
    }
    return [...candidates.values()].sort(compareCandidates).slice(0, limit);
  }

  dispose(): void {
    for (const index of this.#indexes.values()) index.dispose();
    this.#indexes.clear();
    this.#searchVersion++;
    this.#activeProcess?.kill("SIGKILL");
    this.#activeProcess = undefined;
  }

  #index(cwd: string, options: WorkspaceFileSearchOptions, fd: FdExecutable): WorkspaceFileIndex {
    const args = buildFdIndexArguments(cwd, options, fd.supportsDirectoryMarkers);
    const key = JSON.stringify([fd.command, args]);
    let index = this.#indexes.get(key);
    if (index) {
      this.#indexes.delete(key);
    } else {
      index = new WorkspaceFileIndex({
        ...this.#indexOptions,
        list: () => this.#spawnFd(fd.command, args),
        // Conditional rules depend on sibling files, so they apply per query instead.
        isExcluded: isAlwaysExcluded,
      });
      for (const [oldKey, old] of this.#indexes) {
        if (this.#indexes.size < MAX_INDEXES) break;
        old.dispose();
        this.#indexes.delete(oldKey);
      }
    }
    this.#indexes.set(key, index);
    return index;
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

  async #runFd(fd: FdExecutable, args: readonly string[], version: number, timeoutMs: number): Promise<FdEntry[]> {
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
        else finish(() => reject(new FdTimeoutError()));
        child.kill("SIGKILL");
      }, timeoutMs);

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

class FdTimeoutError extends Error {}

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
