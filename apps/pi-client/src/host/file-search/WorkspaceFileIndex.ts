import type { ChildProcess } from "node:child_process";

import type { WorkspaceFileCandidateView } from "../../shared/model/workspaceFileModel.js";
import { parseFdOutput, rankFileCandidate, type FdEntry } from "./fdResults.js";

/** A larger workspace is not indexed; its queries keep going to fd one by one. */
export const MAX_INDEX_ENTRIES = 1_000_000;
/** An index older than this is rebuilt in the background while it keeps answering. */
export const INDEX_TTL_MS = 20_000;
export const INDEX_BUILD_TIMEOUT_MS = 60_000;
/** After a failed or oversized build, the workspace is not indexed again for this long. */
export const INDEX_RETRY_MS = 5 * 60_000;

export interface WorkspaceFileIndexOptions {
  /** Starts fd listing every searchable path. */
  list: () => ChildProcess;
  /** Paths fd lists but search never offers. */
  isExcluded: (path: string) => boolean;
  now?: () => number;
  ttlMs?: number;
  buildTimeoutMs?: number;
  retryMs?: number;
  maxEntries?: number;
}

interface IndexedEntry extends FdEntry {
  lowerPath: string;
}

/**
 * Every searchable path of one workspace, listed once by fd and matched in memory. Per-query
 * fd runs walk the whole tree for each keystroke and stop at a result cap, so in a very large
 * workspace a name that contains the query in its middle can take longer than the search may
 * run, or be cut off. Matching the listing finds every such name at once.
 *
 * Until the first listing completes, `entries` is undefined and search uses fd per query. An
 * older listing keeps answering while a newer one is built, so a file created moments ago can
 * be missing for up to `INDEX_TTL_MS` plus one listing.
 */
export class WorkspaceFileIndex {
  readonly #options: Required<Omit<WorkspaceFileIndexOptions, "list" | "isExcluded">> & Pick<WorkspaceFileIndexOptions, "list" | "isExcluded">;
  #entries: IndexedEntry[] | undefined;
  #builtAt = 0;
  #building: ChildProcess | undefined;
  #unusableUntil = 0;
  #disposed = false;

  constructor(options: WorkspaceFileIndexOptions) {
    this.#options = {
      now: Date.now,
      ttlMs: INDEX_TTL_MS,
      buildTimeoutMs: INDEX_BUILD_TIMEOUT_MS,
      retryMs: INDEX_RETRY_MS,
      maxEntries: MAX_INDEX_ENTRIES,
      ...options,
    };
  }

  /** The current listing, starting a build when there is none or it has gone stale. */
  entries(): readonly IndexedEntry[] | undefined {
    const now = this.#options.now();
    const stale = !this.#entries || now - this.#builtAt >= this.#options.ttlMs;
    if (stale && !this.#building && now >= this.#unusableUntil && !this.#disposed) this.#build();
    return this.#entries;
  }

  dispose(): void {
    this.#disposed = true;
    this.#building?.kill("SIGKILL");
    this.#building = undefined;
    this.#entries = undefined;
  }

  #build(): void {
    const child = this.#options.list();
    this.#building = child;
    const chunks: Buffer[] = [];
    let entryCount = 0;
    let settled = false;
    const finish = (entries: IndexedEntry[] | undefined): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (this.#building === child) this.#building = undefined;
      if (this.#disposed) return;
      if (entries) {
        this.#entries = entries;
        this.#builtAt = this.#options.now();
      } else {
        // A failed rebuild does not discard a listing that still answers.
        this.#unusableUntil = this.#options.now() + this.#options.retryMs;
        if (entryCount > this.#options.maxEntries) this.#entries = undefined;
      }
    };
    const timer = setTimeout(() => {
      finish(undefined);
      child.kill("SIGKILL");
    }, this.#options.buildTimeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (settled) return;
      for (let index = chunk.indexOf(0); index >= 0; index = chunk.indexOf(0, index + 1)) entryCount++;
      if (entryCount > this.#options.maxEntries) {
        finish(undefined);
        child.kill("SIGKILL");
        return;
      }
      chunks.push(chunk);
    });
    child.stderr?.resume();
    child.on("error", () => finish(undefined));
    child.on("close", (code) => {
      if (code !== 0) {
        finish(undefined);
        return;
      }
      const entries = parseFdOutput(Buffer.concat(chunks).toString("utf8"))
        .filter((entry) => !this.#options.isExcluded(entry.path))
        .map((entry) => ({ ...entry, lowerPath: entry.path.toLowerCase() }));
      finish(entries);
    });
  }
}

/** Entries matched between yields to the event loop, which keeps typing responsive. */
const RANK_BATCH = 20_000;

/**
 * The best `limit` listing entries for `query`, ranked as fd results are. `prefix` limits the
 * search to one directory, as a query's directory part does for fd. A large listing is ranked
 * in batches; `cancelled` ends the work early, with no result, when a newer query arrives.
 */
export async function rankIndexedEntries(
  entries: readonly IndexedEntry[],
  query: string,
  prefix: string,
  limit: number,
  boosts: ReadonlySet<string>,
  cancelled: () => boolean = () => false,
): Promise<WorkspaceFileCandidateView[] | undefined> {
  const needle = query.trim().toLowerCase();
  const top: WorkspaceFileCandidateView[] = [];
  for (let index = 0; index < entries.length; index++) {
    if (index > 0 && index % RANK_BATCH === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (cancelled()) return undefined;
    }
    const entry = entries[index]!;
    if (prefix && !entry.path.startsWith(prefix)) continue;
    // Every candidate contains the query's characters in order; most paths fail this cheaply.
    if (needle && !containsInOrder(entry.lowerPath, needle)) continue;
    // Without a query, an unboosted path scores lower the longer it is (`rankFileCandidate`),
    // so one that scores below a full list's last needs no ranking.
    if (!needle && top.length >= limit && !boosts.has(entry.path) && lengthPenalty(entry.path) > lengthPenalty(top.at(-1)?.path ?? "")) continue;
    const candidate = rankFileCandidate(entry.path, query, boosts, entry.isDirectory);
    if (!candidate) continue;
    const last = top.at(-1);
    if (top.length >= limit && last && compareCandidates(candidate, last) >= 0) continue;
    const at = top.findIndex((kept) => compareCandidates(candidate, kept) < 0);
    top.splice(at < 0 ? top.length : at, 0, candidate);
    if (top.length > limit) top.pop();
  }
  return top;
}

export function compareCandidates(left: WorkspaceFileCandidateView, right: WorkspaceFileCandidateView): number {
  return right.score - left.score || left.path.localeCompare(right.path);
}

function lengthPenalty(path: string): number {
  return Math.min(path.length / 8, 60);
}

function containsInOrder(value: string, needle: string): boolean {
  let position = 0;
  for (const character of needle) {
    position = value.indexOf(character, position);
    if (position < 0) return false;
    position++;
  }
  return true;
}
