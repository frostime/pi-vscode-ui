import type { RpcSessionEntry } from "@frostime/pi-rpc";

export interface SessionEntryNode {
  id: string;
  type: string;
  parentId: string | null;
  timestamp?: string | number;
  messageRole?: string;
}

export interface SessionEntryIndex {
  entriesById: ReadonlyMap<string, SessionEntryNode>;
  childrenByParentId: ReadonlyMap<string | null, readonly string[]>;
  parentById: ReadonlyMap<string, string | null>;
  activePath: readonly string[];
  leafId: string | null;
}

export interface ReplacedSessionEntries {
  kind: "replace";
  activePath: readonly RpcSessionEntry[];
  index: SessionEntryIndex;
}

export interface AppendedSessionEntries {
  kind: "append";
  activePathAppend: readonly RpcSessionEntry[];
  index: SessionEntryIndex;
}

export interface ReloadSessionEntries {
  kind: "reload";
  reason: "not-initialized" | "active-leaf-not-continued";
}

export type IncrementalSessionEntries = AppendedSessionEntries | ReloadSessionEntries;

export class SessionEntryPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionEntryPathError";
  }
}

export class SessionEntryState {
  #initialized = false;
  #cursor: string | null = null;
  #nodesById = new Map<string, SessionEntryNode>();
  #index = emptyIndex();

  get initialized(): boolean {
    return this.#initialized;
  }

  get cursor(): string | null {
    return this.#cursor;
  }

  get leafId(): string | null {
    return this.#index.leafId;
  }

  get index(): SessionEntryIndex {
    return this.#index;
  }

  replace(entries: readonly RpcSessionEntry[], leafId: string | null): ReplacedSessionEntries {
    const entriesById = uniqueEntries(entries);
    const activePath = buildActivePath(entriesById, leafId);

    this.#initialized = true;
    this.#cursor = entries.at(-1)?.id ?? null;
    this.#nodesById = compactEntries(entriesById.values());
    this.#index = buildIndex(this.#nodesById, activePath.map((entry) => entry.id), leafId);

    return { kind: "replace", activePath, index: this.#index };
  }

  applyIncrement(entries: readonly RpcSessionEntry[], leafId: string | null): IncrementalSessionEntries {
    if (!this.#initialized) return { kind: "reload", reason: "not-initialized" };

    const activePathAppend = continuedActivePath(this.leafId, entries, leafId);
    if (!activePathAppend) return { kind: "reload", reason: "active-leaf-not-continued" };

    for (const [id, node] of compactEntries(uniqueEntries(entries).values())) {
      if (!this.#nodesById.has(id)) this.#nodesById.set(id, node);
    }
    this.#cursor = entries.at(-1)?.id ?? this.#cursor;
    const activePath = [...this.#index.activePath, ...activePathAppend.map((entry) => entry.id)];
    this.#index = buildIndex(this.#nodesById, activePath, leafId);

    return { kind: "append", activePathAppend, index: this.#index };
  }

  reset(): void {
    this.#initialized = false;
    this.#cursor = null;
    this.#nodesById.clear();
    this.#index = emptyIndex();
  }
}

function buildActivePath(
  entriesById: ReadonlyMap<string, RpcSessionEntry>,
  leafId: string | null,
): RpcSessionEntry[] {
  if (leafId === null) return [];

  const reversedPath: RpcSessionEntry[] = [];
  const seen = new Set<string>();
  let currentId: string | null = leafId;
  while (currentId !== null) {
    if (seen.has(currentId)) throw new SessionEntryPathError(`Session entry parent cycle at ${currentId}`);
    seen.add(currentId);

    const entry = entriesById.get(currentId);
    if (!entry) throw new SessionEntryPathError(`Session entry parent chain is missing ${currentId}`);
    reversedPath.push(entry);
    currentId = entry.parentId;
  }
  return reversedPath.reverse();
}

function continuedActivePath(
  previousLeafId: string | null,
  entries: readonly RpcSessionEntry[],
  leafId: string | null,
): RpcSessionEntry[] | null {
  if (leafId === previousLeafId) return [];
  if (leafId === null) return null;

  const entriesById = uniqueEntries(entries);
  const reversedPath: RpcSessionEntry[] = [];
  const seen = new Set<string>();
  let currentId: string | null = leafId;
  while (currentId !== previousLeafId) {
    if (currentId === null || seen.has(currentId)) return null;
    seen.add(currentId);

    const entry = entriesById.get(currentId);
    if (!entry) return null;
    reversedPath.push(entry);
    currentId = entry.parentId;
  }
  return reversedPath.reverse();
}

function uniqueEntries(entries: readonly RpcSessionEntry[]): Map<string, RpcSessionEntry> {
  const entriesById = new Map<string, RpcSessionEntry>();
  for (const entry of entries) {
    if (!entriesById.has(entry.id)) entriesById.set(entry.id, entry);
  }
  return entriesById;
}

function compactEntries(entries: Iterable<RpcSessionEntry>): Map<string, SessionEntryNode> {
  const nodesById = new Map<string, SessionEntryNode>();
  for (const entry of entries) {
    const messageRole = messageRoleOf(entry);
    nodesById.set(entry.id, {
      id: entry.id,
      type: entry.type,
      parentId: entry.parentId,
      ...(typeof entry.timestamp === "string" || typeof entry.timestamp === "number"
        ? { timestamp: entry.timestamp }
        : {}),
      ...(messageRole ? { messageRole } : {}),
    });
  }
  return nodesById;
}

function buildIndex(
  nodesById: ReadonlyMap<string, SessionEntryNode>,
  activePath: readonly string[],
  leafId: string | null,
): SessionEntryIndex {
  const parentById = new Map<string, string | null>();
  for (const node of nodesById.values()) parentById.set(node.id, validParentId(node, nodesById));

  const childrenByParentId = new Map<string | null, string[]>();
  childrenByParentId.set(null, []);
  for (const node of nodesById.values()) {
    const parentId = parentById.get(node.id) ?? null;
    const siblings = childrenByParentId.get(parentId) ?? [];
    siblings.push(node.id);
    childrenByParentId.set(parentId, siblings);
    if (!childrenByParentId.has(node.id)) childrenByParentId.set(node.id, []);
  }

  return {
    entriesById: new Map(nodesById),
    childrenByParentId,
    parentById,
    activePath: [...activePath],
    leafId,
  };
}

function validParentId(
  node: SessionEntryNode,
  nodesById: ReadonlyMap<string, SessionEntryNode>,
): string | null {
  if (node.parentId === null || !nodesById.has(node.parentId) || node.parentId === node.id) return null;

  const seen = new Set([node.id]);
  let currentId: string | null = node.parentId;
  while (currentId !== null) {
    if (seen.has(currentId)) return null;
    seen.add(currentId);
    currentId = nodesById.get(currentId)?.parentId ?? null;
  }
  return node.parentId;
}

function messageRoleOf(entry: RpcSessionEntry): string | undefined {
  if (entry.type !== "message" || !isRecord(entry.message)) return undefined;
  return typeof entry.message.role === "string" ? entry.message.role : undefined;
}

function emptyIndex(): SessionEntryIndex {
  return {
    entriesById: new Map(),
    childrenByParentId: new Map([[null, []]]),
    parentById: new Map(),
    activePath: [],
    leafId: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
