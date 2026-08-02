import type {
  AgentActivityView,
  AgentTurnItemView,
  AgentTurnStatus,
  AgentTurnView,
  ConversationItemView,
} from "../../shared/model/conversationModel.js";
import type { ToolCallView } from "../../shared/model/toolCallModel.js";
import { createToolView } from "./messageAssembler.js";

/** A Pi-provided clue used only to correlate live and persisted representations. */
export type MessageCorrelationKey = `id:${string}` | `timestamp:${number}`;

export type AssistantMessageSource =
  | {
      kind: "live";
      correlationKey: MessageCorrelationKey;
      fallbackViewMessageId: string;
    }
  | {
      kind: "persisted";
      entryId: string;
      correlationKey?: MessageCorrelationKey;
      fallbackViewMessageId: string;
    };

export type CompactionSource =
  | {
      kind: "live";
      firstKeptEntryId: string;
      fallbackViewId: string;
    }
  | {
      kind: "persisted";
      entryId: string;
      firstKeptEntryId: string;
      fallbackViewId: string;
    };

export interface PersistedOwnershipPreflight {
  assistantSources: readonly Extract<AssistantMessageSource, { kind: "persisted" }>[];
  compactionSources: readonly Extract<CompactionSource, { kind: "persisted" }>[];
}

export type PlacementConflict = {
  kind: "conflict";
  reason:
    | "assistant-correlation-ambiguous"
    | "compaction-correlation-ambiguous";
};

export type AssistantPlacementResult =
  | { kind: "placed"; viewMessageId: string }
  | { kind: "ignored-persisted-owner"; viewMessageId: string }
  | PlacementConflict;

export type CompactionPlacementResult =
  | { kind: "placed"; viewId: string }
  | { kind: "ignored-persisted-owner"; viewId: string }
  | PlacementConflict;

export interface AssistantPlacement {
  turnId: string;
  source: AssistantMessageSource;
  buildActivities(viewMessageId: string): AgentActivityView[];
}

export interface CompactionPlacement {
  turnId?: string | undefined;
  source: CompactionSource;
  buildItem(viewId: string): Extract<AgentTurnItemView | ConversationItemView, { type: "compaction" }>;
}

export interface ToolPlacementUpdate {
  source: { kind: "live" } | { kind: "persisted"; entryId: string };
  fallbackTurnId?: string | undefined;
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolCallView["status"];
  output?: string;
  isError: boolean;
  endedAt?: number;
  timestamp: number;
}

interface ItemLocation {
  turnId: string | undefined;
  itemId: string;
}

interface AssistantOwner {
  viewMessageId: string;
  locations: ItemLocation[];
  persistedEntryId?: string;
}

interface ToolOwner {
  location: ItemLocation;
  persistedEntryId?: string;
}

interface CompactionOwner {
  viewId: string;
  location?: ItemLocation;
  persistedEntryId?: string;
}

/**
 * Owns the single ordered conversation result and every message/tool location.
 * ConversationProjection decides lifecycle and visual-turn grouping.
 */
export class ConversationItemStore {
  #items: ConversationItemView[] = [];
  readonly #liveAssistants = new Map<MessageCorrelationKey, AssistantOwner>();
  readonly #persistedAssistants = new Map<string, AssistantOwner>();
  readonly #persistedAssistantKeys = new Map<MessageCorrelationKey, Set<string>>();
  readonly #toolItems = new Map<string, ToolOwner>();
  readonly #liveCompactions = new Map<string, CompactionOwner>();
  readonly #persistedCompactions = new Map<string, CompactionOwner>();
  readonly #persistedCompactionKeys = new Map<string, Set<string>>();

  read(): readonly ConversationItemView[] {
    return this.#items;
  }

  reset(): void {
    this.#items = [];
    this.#liveAssistants.clear();
    this.#persistedAssistants.clear();
    this.#persistedAssistantKeys.clear();
    this.#toolItems.clear();
    this.#liveCompactions.clear();
    this.#persistedCompactions.clear();
    this.#persistedCompactionKeys.clear();
  }

  hasPersistedAssistantOwnership(correlationKey: MessageCorrelationKey): boolean {
    return (this.#persistedAssistantKeys.get(correlationKey)?.size ?? 0) > 0;
  }

  hasTool(toolCallId: string): boolean {
    return this.#toolItems.has(toolCallId);
  }

  /** Detects ambiguous live adoption before any public item is mutated. */
  preflightPersistedOwnership(input: PersistedOwnershipPreflight): PlacementConflict | undefined {
    const assistantCounts = countByKey(input.assistantSources, (source) => source.correlationKey);
    for (const [key, count] of assistantCounts) {
      const liveOwner = this.#liveAssistants.get(key);
      if (count > 1 && liveOwner && liveOwner.persistedEntryId === undefined) {
        return { kind: "conflict", reason: "assistant-correlation-ambiguous" };
      }
    }

    const compactionCounts = countByKey(input.compactionSources, (source) => source.firstKeptEntryId);
    for (const [key, count] of compactionCounts) {
      const liveOwner = this.#liveCompactions.get(key);
      if (count > 1 && liveOwner && liveOwner.persistedEntryId === undefined) {
        return { kind: "conflict", reason: "compaction-correlation-ambiguous" };
      }
    }
    return undefined;
  }

  placeAssistant(input: AssistantPlacement): AssistantPlacementResult {
    const source = input.source;
    if (source.kind === "live") {
      const persistedIds = this.#persistedAssistantKeys.get(source.correlationKey);
      if (persistedIds && persistedIds.size > 0) {
        const owner = this.#persistedAssistants.get(persistedIds.values().next().value as string);
        return { kind: "ignored-persisted-owner", viewMessageId: owner?.viewMessageId ?? source.fallbackViewMessageId };
      }
      const owner = this.#liveAssistants.get(source.correlationKey) ?? {
        viewMessageId: source.fallbackViewMessageId,
        locations: [],
      };
      this.#liveAssistants.set(source.correlationKey, owner);
      this.#publishAssistant(owner, input.turnId, input.buildActivities(owner.viewMessageId));
      return { kind: "placed", viewMessageId: owner.viewMessageId };
    }

    const existing = this.#persistedAssistants.get(source.entryId);
    if (existing) {
      this.#publishAssistant(existing, input.turnId, input.buildActivities(existing.viewMessageId));
      return { kind: "placed", viewMessageId: existing.viewMessageId };
    }

    const correlatedPersistedIds = source.correlationKey
      ? this.#persistedAssistantKeys.get(source.correlationKey)
      : undefined;
    const liveOwner = source.correlationKey && (!correlatedPersistedIds || correlatedPersistedIds.size === 0)
      ? this.#liveAssistants.get(source.correlationKey)
      : undefined;
    const owner: AssistantOwner = liveOwner ?? {
      viewMessageId: source.fallbackViewMessageId,
      locations: [],
    };
    owner.persistedEntryId = source.entryId;
    this.#persistedAssistants.set(source.entryId, owner);
    if (source.correlationKey) {
      addSetValue(this.#persistedAssistantKeys, source.correlationKey, source.entryId);
      if (liveOwner) this.#liveAssistants.set(source.correlationKey, owner);
    }
    this.#publishAssistant(owner, input.turnId, input.buildActivities(owner.viewMessageId));
    return { kind: "placed", viewMessageId: owner.viewMessageId };
  }

  upsertTool(input: ToolPlacementUpdate): void {
    const owner = this.#toolItems.get(input.toolCallId);
    if (input.source.kind === "live" && owner?.persistedEntryId) return;
    const location = owner?.location;
    const turnId = location?.turnId ?? input.fallbackTurnId;
    if (!turnId) return;
    const current = location ? this.turnItem(turnId, location.itemId) : undefined;
    const currentTool = current?.type === "tool" ? current.tool : undefined;
    const args = Object.keys(input.args).length > 0 ? input.args : currentTool?.args ?? {};
    const created = createToolView(
      input.toolCallId,
      input.name || currentTool?.name || "tool",
      args,
      currentTool?.startedAt ?? input.timestamp,
    );
    const tool: ToolCallView = {
      ...created,
      ...currentTool,
      name: input.name || currentTool?.name || created.name,
      args,
      status: input.status,
      isError: input.isError,
      ...(input.output !== undefined ? { output: input.output } : currentTool?.output !== undefined ? { output: currentTool.output } : {}),
      ...(input.endedAt !== undefined ? { endedAt: input.endedAt } : currentTool?.endedAt !== undefined ? { endedAt: currentTool.endedAt } : {}),
    };
    const activity: AgentActivityView = {
      id: location?.itemId ?? `tool-${input.toolCallId}`,
      type: "tool",
      tool,
      timestamp: current?.type === "tool" ? current.timestamp : tool.startedAt,
    };
    this.upsertTurnItem(turnId, activity);
    // Persisted tool-result content is authoritative; subsequent live tool
    // events are ignored by the guard at the start of this method.
    this.#toolItems.set(input.toolCallId, {
      location: { turnId, itemId: activity.id },
      ...(input.source.kind === "persisted"
        ? { persistedEntryId: input.source.entryId }
        : owner?.persistedEntryId ? { persistedEntryId: owner.persistedEntryId } : {}),
    });
  }

  placeCompaction(input: CompactionPlacement): CompactionPlacementResult {
    const source = input.source;
    if (source.kind === "live") {
      const persistedIds = this.#persistedCompactionKeys.get(source.firstKeptEntryId);
      if (persistedIds && persistedIds.size > 0) {
        const owner = this.#persistedCompactions.get(persistedIds.values().next().value as string);
        return { kind: "ignored-persisted-owner", viewId: owner?.viewId ?? source.fallbackViewId };
      }
      const owner = this.#liveCompactions.get(source.firstKeptEntryId) ?? { viewId: source.fallbackViewId };
      this.#liveCompactions.set(source.firstKeptEntryId, owner);
      this.#publishCompaction(owner, input.turnId, input.buildItem(owner.viewId));
      return { kind: "placed", viewId: owner.viewId };
    }

    const existing = this.#persistedCompactions.get(source.entryId);
    if (existing) {
      this.#publishCompaction(existing, input.turnId, input.buildItem(existing.viewId));
      return { kind: "placed", viewId: existing.viewId };
    }
    const correlatedPersistedIds = this.#persistedCompactionKeys.get(source.firstKeptEntryId);
    const liveOwner = (!correlatedPersistedIds || correlatedPersistedIds.size === 0)
      ? this.#liveCompactions.get(source.firstKeptEntryId)
      : undefined;
    const owner: CompactionOwner = liveOwner ?? { viewId: source.fallbackViewId };
    owner.persistedEntryId = source.entryId;
    this.#persistedCompactions.set(source.entryId, owner);
    addSetValue(this.#persistedCompactionKeys, source.firstKeptEntryId, source.entryId);
    if (liveOwner) this.#liveCompactions.set(source.firstKeptEntryId, owner);
    this.#publishCompaction(owner, input.turnId, input.buildItem(owner.viewId));
    return { kind: "placed", viewId: owner.viewId };
  }

  appendItem(item: ConversationItemView): void {
    this.#items = [...this.#items, item];
  }

  removeTopLevelItem(itemId: string): void {
    this.#items = this.#items.filter((item) => item.id !== itemId);
  }

  mapItems(mapper: (item: ConversationItemView) => ConversationItemView): void {
    this.#items = this.#items.map(mapper);
  }

  findTurn(turnId: string): AgentTurnView | undefined {
    const item = this.#items.find((candidate) => candidate.id === turnId);
    return item?.type === "turn" ? item : undefined;
  }

  turn(turnId: string): AgentTurnView {
    const turn = this.findTurn(turnId);
    if (!turn) throw new Error(`Unknown projected turn: ${turnId}`);
    return turn;
  }

  replaceTurn(next: AgentTurnView): void {
    this.#items = this.#items.map((item) => item.id === next.id ? next : item);
  }

  replaceTurnAtEnd(next: AgentTurnView): void {
    this.#items = [...this.#items.filter((item) => item.id !== next.id), next];
  }

  upsertTurnItem(turnId: string, item: AgentTurnItemView): void {
    const turn = this.turn(turnId);
    const itemIndex = turn.items.findIndex((current) => current.id === item.id);
    const items = [...turn.items];
    if (itemIndex === -1) items.push(item);
    else items[itemIndex] = item;
    this.replaceTurn({ ...turn, items });
  }

  setTurnStatus(turnId: string, status: AgentTurnStatus, endedAt?: number): void {
    const turn = this.turn(turnId);
    this.replaceTurn({ ...turn, status, ...(endedAt === undefined ? {} : { endedAt }) });
  }

  turnItem(turnId: string | undefined, itemId: string): AgentTurnItemView | undefined {
    return turnId ? this.findTurn(turnId)?.items.find((item) => item.id === itemId) : undefined;
  }

  conversationItems(): AgentTurnItemView[] {
    return this.#items.flatMap((item) => item.type === "turn" ? item.items : [item]);
  }

  #publishAssistant(owner: AssistantOwner, turnId: string, activities: AgentActivityView[]): void {
    const staysInTurn = owner.locations.length > 0
      && owner.locations.every((location) => location.turnId === turnId);
    if (staysInTurn) {
      this.#replaceAssistantInTurn(owner, turnId, activities);
      return;
    }

    for (const location of owner.locations) {
      this.#removeOwnedAssistantLocation(location);
    }
    const targetTurn = this.turn(turnId);
    this.replaceTurn({ ...targetTurn, items: [...targetTurn.items, ...activities] });
    this.#recordAssistantLocations(owner, turnId, activities);
  }

  /** Same-turn streaming updates preserve notices observed between message parts. */
  #replaceAssistantInTurn(owner: AssistantOwner, turnId: string, activities: AgentActivityView[]): void {
    const previousIds = new Set(owner.locations.map((location) => location.itemId));
    const replacements = new Map(activities.map((activity) => [activity.id, activity]));
    const observedIds = new Set<string>();
    const turn = this.turn(turnId);
    const items = turn.items.flatMap((item) => {
      const replacement = replacements.get(item.id);
      if (replacement) {
        observedIds.add(item.id);
        return [replacement];
      }
      return previousIds.has(item.id) ? [] : [item];
    });
    for (const activity of activities) {
      if (!observedIds.has(activity.id)) items.push(activity);
    }
    for (const location of owner.locations) {
      for (const [toolCallId, toolOwner] of this.#toolItems) {
        if (sameLocation(toolOwner.location, location)) this.#toolItems.delete(toolCallId);
      }
    }
    this.replaceTurn({ ...turn, items });
    this.#recordAssistantLocations(owner, turnId, activities);
  }

  #removeOwnedAssistantLocation(location: ItemLocation): void {
    this.#removeAt(location);
    for (const [toolCallId, toolOwner] of this.#toolItems) {
      if (sameLocation(toolOwner.location, location)) this.#toolItems.delete(toolCallId);
    }
  }

  #recordAssistantLocations(owner: AssistantOwner, turnId: string, activities: AgentActivityView[]): void {
    owner.locations = activities.map((activity) => ({ turnId, itemId: activity.id }));
    for (const activity of activities) {
      if (activity.type === "tool") {
        this.#toolItems.set(activity.tool.id, { location: { turnId, itemId: activity.id } });
      }
    }
  }

  #publishCompaction(
    owner: CompactionOwner,
    turnId: string | undefined,
    item: Extract<AgentTurnItemView | ConversationItemView, { type: "compaction" }>,
  ): void {
    const existingIndex = owner.location?.turnId === turnId
      ? turnId
        ? this.turn(turnId).items.findIndex((candidate) => candidate.id === owner.location?.itemId)
        : this.#items.findIndex((candidate) => candidate.id === owner.location?.itemId)
      : -1;
    if (owner.location) this.#removeAt(owner.location);
    if (turnId) {
      const turn = this.turn(turnId);
      const items = [...turn.items];
      items.splice(existingIndex < 0 ? items.length : existingIndex, 0, item);
      this.replaceTurn({ ...turn, items });
    } else {
      const items = [...this.#items];
      items.splice(existingIndex < 0 ? items.length : existingIndex, 0, item);
      this.#items = items;
    }
    owner.location = { turnId, itemId: item.id };
  }

  #removeAt(location: ItemLocation): void {
    if (location.turnId) {
      const turn = this.findTurn(location.turnId);
      if (turn) this.replaceTurn({ ...turn, items: turn.items.filter((item) => item.id !== location.itemId) });
      return;
    }
    this.#items = this.#items.filter((item) => item.id !== location.itemId);
  }
}

function countByKey<T, K>(values: readonly T[], keyOf: (value: T) => K | undefined): Map<K, number> {
  const counts = new Map<K, number>();
  for (const value of values) {
    const key = keyOf(value);
    if (key === undefined) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function addSetValue<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const values = map.get(key) ?? new Set<V>();
  values.add(value);
  map.set(key, values);
}

function sameLocation(left: ItemLocation, right: ItemLocation): boolean {
  return left.turnId === right.turnId && left.itemId === right.itemId;
}
