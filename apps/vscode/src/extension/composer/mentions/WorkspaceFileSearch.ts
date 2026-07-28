import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

import { minimatch } from "minimatch";

import type { WorkspaceFileCandidateView } from "../../../shared/model/workspaceFileModel.js";
import { rankFileCandidate } from "./rankFileCandidate.js";

const MAX_FD_RESULTS = 500;
const FD_TIMEOUT_MS = 7_000;

export interface WorkspaceFileExcludeRule {
  pattern: string;
  when?: string;
}

export interface WorkspaceFileSearchOptions {
  excludeRules: readonly WorkspaceFileExcludeRule[];
  respectIgnoreFiles: boolean;
  followSymlinks: boolean;
}

export interface FdExecutable {
  command: string;
  version: string;
  supportsDirectoryMarkers: boolean;
}

export interface WorkspaceFileSearchDependencies {
  discoverFd?: () => Promise<FdExecutable>;
  spawnFd?: (command: string, args: readonly string[]) => ChildProcess;
  timeoutMs?: number;
  onLegacyFd?: (fd: FdExecutable) => void;
}

interface FdEntry {
  path: string;
  isDirectory: boolean;
}

export interface ScopedQuery {
  baseDirectory: string;
  displayPrefix: string;
  query: string;
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

    const scope = resolveQueryScope(cwd, query);
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

export function buildFdArguments(
  scope: ScopedQuery,
  options: WorkspaceFileSearchOptions,
  includeDirectories = true,
): string[] {
  const args = [
    "--base-directory", scope.baseDirectory,
    "--max-results", String(MAX_FD_RESULTS),
    "--type", "file",
  ];
  if (includeDirectories) args.push("--type", "directory");
  args.push(
    "--color", "never",
    "--print0",
    "--hidden",
    "--ignore-case",
    "--exclude", ".git",
    "--exclude", "node_modules",
  );
  if (!options.respectIgnoreFiles) args.push("--no-ignore");
  if (options.followSymlinks) args.push("--follow");
  for (const rule of options.excludeRules) {
    if (!rule.when) args.push("--exclude", normalizeGlob(rule.pattern));
  }
  if (scope.query) args.push("--full-path", "--", buildFdFuzzyPattern(scope.baseDirectory, scope.query));
  return args;
}

export function buildFdFuzzyPattern(baseDirectory: string, query: string): string {
  const base = [...baseDirectory.replaceAll("\\", "/")]
    .map((character) => character === "/" ? "[\\\\/]" : escapeRegex(character))
    .join("");
  const fuzzy = [...query.replaceAll("\\", "/")]
    .map((character) => character === "/" ? "[\\\\/]" : escapeRegex(character))
    .join(".*");
  return `^${base}[\\\\/].*${fuzzy}`;
}

export function parseFdOutput(output: string): FdEntry[] {
  return output
    .split("\0")
    .filter(Boolean)
    .map((rawPath) => {
      const isDirectory = /[\\/]$/.test(rawPath);
      const path = rawPath.replace(/[\\/]$/, "").replaceAll("\\", "/").replace(/^\.\//, "");
      return { path, isDirectory };
    })
    .filter((entry) => entry.path && !entry.path.startsWith("../"));
}

export function resolveQueryScope(cwd: string, query: string): ScopedQuery {
  const normalized = query.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  if (slash < 0 || isAbsolute(normalized)) return { baseDirectory: cwd, displayPrefix: "", query: normalized };

  const displayPrefix = normalized.slice(0, slash + 1);
  const baseDirectory = resolve(cwd, displayPrefix);
  const relativeBase = relative(cwd, baseDirectory);
  if (relativeBase.startsWith("..") || isAbsolute(relativeBase) || !isDirectory(baseDirectory)) {
    return { baseDirectory: cwd, displayPrefix: "", query: normalized };
  }
  return { baseDirectory, displayPrefix, query: normalized.slice(slash + 1) };
}

export async function selectFdExecutable(
  commands: readonly string[],
  probe: (command: string) => Promise<FdExecutable | undefined> = probeFdExecutable,
): Promise<FdExecutable> {
  let legacy: FdExecutable | undefined;
  for (const command of commands) {
    const fd = await probe(command);
    if (!fd) continue;
    if (fd.supportsDirectoryMarkers) return fd;
    legacy ??= fd;
  }
  if (legacy) return legacy;
  throw new Error("fd is required for workspace path completion but was not found in PATH or Pi's managed bin directory.");
}

async function discoverFdExecutable(): Promise<FdExecutable> {
  const pathCandidates = process.platform === "linux" ? ["fd", "fdfind"] : ["fd"];
  const agentDirectory = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  const managed = join(agentDirectory, "bin", process.platform === "win32" ? "fd.exe" : "fd");
  return selectFdExecutable([...new Set([...pathCandidates, managed])]);
}

function probeFdExecutable(command: string): Promise<FdExecutable | undefined> {
  return new Promise((resolvePromise) => {
    execFile(command, ["--version"], { encoding: "utf8", windowsHide: true }, (error, stdout) => {
      if (error) {
        resolvePromise(undefined);
        return;
      }
      resolvePromise(parseFdVersion(command, stdout));
    });
  });
}

export function parseFdVersion(command: string, output: string): FdExecutable {
  const match = output.match(/\b(\d+)(?:\.\d+){1,2}\b/);
  const version = match?.[0] ?? "unknown";
  const major = match ? Number.parseInt(match[1] ?? "0", 10) : 0;
  return { command, version, supportsDirectoryMarkers: major >= 10 };
}

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

function normalizeGlob(pattern: string): string {
  const normalized = pattern.replaceAll("\\", "/");
  return normalized.startsWith("/") ? normalized.slice(1) : normalized;
}

function isAlwaysExcluded(path: string): boolean {
  return path === ".git" || path.startsWith(".git/") || path.includes("/.git/")
    || path === "node_modules" || path.startsWith("node_modules/") || path.includes("/node_modules/");
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
