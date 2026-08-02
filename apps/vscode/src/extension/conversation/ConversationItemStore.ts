import type {
  AgentActivityView,
  AgentTurnItemView,
  ConversationItemView,
} from "../../shared/model/conversationModel.js";
import type { ToolCallView } from "../../shared/model/toolCallModel.js";

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
    | "compaction-correlation-ambiguous"
    | "persisted-location-conflict";
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
  turnId?: string;
  source: CompactionSource;
  buildItem(viewId: string): Extract<AgentTurnItemView | ConversationItemView, { type: "compaction" }>;
}

export interface ToolPlacementUpdate {
  fallbackTurnId: string;
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolCallView["status"];
  output?: string;
  isError: boolean;
  endedAt?: number;
  timestamp: number;
}

/**
 * Owns the single ordered conversation result and every message/tool location.
 * ConversationProjection decides lifecycle and visual-turn grouping; it cannot
 * maintain parallel location maps after migration.
 *
 * Persisted entry IDs are durable identities. Message IDs and timestamps are
 * correlation clues only: they may adopt a live view identity, but never merge
 * two persisted entries.
 */
export class ConversationItemStore {
  // <conversation-projection-convergence>::TODO [state-move]
  // Move #items, #messageItems, #toolItems, and compaction ownership here.
  // Expected diff: delete those fields and their direct mutation helpers from
  // ConversationProjection; preserve its public snapshot shape.

  /** Must detect ambiguous live adoption before any public item is mutated. */
  preflightPersistedOwnership(input: PersistedOwnershipPreflight): PlacementConflict | undefined {
    void input;
    return pass1("ConversationItemStore.preflightPersistedOwnership");
  }

  /**
   * Atomically removes all prior parts for this message, publishes the new
   * reasoning/response/tool parts, updates tool locations, and records whether
   * persisted state has taken ownership. Late live updates then become no-ops.
   */
  placeAssistant(input: AssistantPlacement): AssistantPlacementResult {
    void input;
    return pass1("ConversationItemStore.placeAssistant");
  }

  /** Updates the one tool activity at its authoritative post-relocation turn. */
  upsertTool(input: ToolPlacementUpdate): void {
    void input;
    pass1("ConversationItemStore.upsertTool");
  }

  /** Reconciles live/persisted compaction by firstKeptEntryId, never summary text. */
  placeCompaction(input: CompactionPlacement): CompactionPlacementResult {
    void input;
    return pass1("ConversationItemStore.placeCompaction");
  }

  // <conversation-projection-convergence>::TODO [mechanical-move]
  // Move ordinary append/find/turn-metadata helpers from ConversationProjection
  // only as demanded by call sites. Their signatures are intentionally not fixed
  // here because they carry no architectural decision.
}

function pass1(symbol: string): never {
  throw new Error(`Pass 1 skeleton: ${symbol}`);
}
