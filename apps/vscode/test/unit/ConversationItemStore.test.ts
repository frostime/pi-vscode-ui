import { describe, expect, it } from "vitest";

import {
  ConversationItemStore,
  type AssistantMessageSource,
} from "../../src/extension/conversation/ConversationItemStore.js";
import type {
  AgentActivityView,
  AgentTurnView,
  CompactionView,
} from "../../src/shared/model/conversationModel.js";

const correlation = "timestamp:42" as const;

describe("ConversationItemStore", () => {
  it("cancels an unbound preparing tool and binds its real execution ID in place", () => {
    const store = storeWithTurns("live");
    const outerId = "live-message:tool:0";
    store.placeAssistant({
      turnId: "live",
      source: liveSource("live-message"),
      buildActivities: () => [preparingTool(outerId, '{"path":')],
    });

    expect(store.hasTool("call-1")).toBe(false);
    store.finalizeUnresolvedTools();
    const [cancelled] = store.turn("live").items;
    expect(cancelled?.id).toBe(outerId);
    expect(cancelled?.type === "tool" ? cancelled.tool : undefined).toMatchObject({
      state: "preparing",
      status: "cancelled",
      rawArguments: '{"path":',
    });

    store.placeAssistant({
      turnId: "live",
      source: liveSource("live-message"),
      buildActivities: () => [boundTool(outerId)],
    });
    expect(store.hasTool("call-1")).toBe(true);
    store.upsertTool({
      source: { kind: "live" },
      fallbackTurnId: "live",
      toolCallId: "call-1",
      name: "read",
      args: {},
      status: "complete",
      output: "body",
      isError: false,
      endedAt: 2,
      timestamp: 2,
    });
    const [completed] = store.turn("live").items;
    expect(completed?.id).toBe(outerId);
    expect(completed?.type === "tool" ? completed.tool : undefined).toMatchObject({
      state: "bound",
      id: "call-1",
      status: "complete",
      output: "body",
    });
  });

  it("moves every assistant part on persisted takeover and ignores a late live replay", () => {
    const store = storeWithTurns("live", "persisted");
    store.placeAssistant({
      turnId: "live",
      source: liveSource("live-message"),
      buildActivities: assistantParts,
    });

    const result = store.placeAssistant({
      turnId: "persisted",
      source: persistedSource("entry-a", "persisted-message"),
      buildActivities: assistantParts,
    });
    expect(result).toEqual({ kind: "placed", viewMessageId: "live-message" });
    expect(itemIds(store, "live")).toEqual([]);
    expect(itemIds(store, "persisted")).toEqual([
      "live-message:reasoning:0",
      "live-message:response:1",
      "tool-call-1",
    ]);

    expect(store.placeAssistant({
      turnId: "live",
      source: liveSource("late-message"),
      buildActivities: (id) => [response(`${id}:late`, "late")],
    })).toEqual({ kind: "ignored-persisted-owner", viewMessageId: "live-message" });
    expect(itemIds(store, "live")).toEqual([]);
    expect(itemIds(store, "persisted")).toHaveLength(3);
  });

  it("reports ambiguous live adoption before changing visible items and keeps persisted collisions distinct", () => {
    const store = storeWithTurns("live", "persisted");
    store.placeAssistant({ turnId: "live", source: liveSource("live-message"), buildActivities: assistantParts });
    const before = store.read();

    expect(store.preflightPersistedOwnership({
      assistantSources: [persistedSource("entry-a", "a"), persistedSource("entry-b", "b")],
      compactionSources: [],
    })).toEqual({ kind: "conflict", reason: "assistant-correlation-ambiguous" });
    expect(store.read()).toBe(before);

    const withoutLive = storeWithTurns("persisted");
    expect(withoutLive.preflightPersistedOwnership({
      assistantSources: [persistedSource("entry-a", "a"), persistedSource("entry-b", "b")],
      compactionSources: [
        { kind: "persisted", entryId: "compaction-a", firstKeptEntryId: "kept", fallbackViewId: "a" },
        { kind: "persisted", entryId: "compaction-b", firstKeptEntryId: "kept", fallbackViewId: "b" },
      ],
    })).toBeUndefined();

    const replacement = storeWithTurns("persisted");
    replacement.placeAssistant({
      turnId: "persisted",
      source: persistedSource("entry-a", "message-entry-a"),
      buildActivities: (id) => [response(`${id}:response:0`, "first")],
    });
    replacement.placeAssistant({
      turnId: "persisted",
      source: persistedSource("entry-b", "message-entry-b"),
      buildActivities: (id) => [response(`${id}:response:0`, "second")],
    });
    expect(itemIds(replacement, "persisted")).toEqual([
      "message-entry-a:response:0",
      "message-entry-b:response:0",
    ]);
  });

  it("preserves a notice observed between same-turn assistant parts", () => {
    const store = storeWithTurns("live");
    store.placeAssistant({
      turnId: "live",
      source: liveSource("live-message"),
      buildActivities: (id) => [{
        id: `${id}:reasoning:0`,
        type: "reasoning",
        text: "thinking",
        status: "streaming",
        timestamp: 1,
      }],
    });
    store.upsertTurnItem("live", {
      id: "notice",
      type: "notice",
      text: "retrying",
      level: "info",
      timestamp: 2,
    });
    store.placeAssistant({
      turnId: "live",
      source: liveSource("live-message"),
      buildActivities: (id) => [
        { id: `${id}:reasoning:0`, type: "reasoning", text: "thinking", status: "complete", timestamp: 1 },
        response(`${id}:response:1`, "answer"),
      ],
    });

    expect(itemIds(store, "live")).toEqual([
      "live-message:reasoning:0",
      "notice",
      "live-message:response:1",
    ]);
  });

  it("updates a relocated tool only at its authoritative turn", () => {
    const store = storeWithTurns("live", "persisted");
    store.placeAssistant({ turnId: "live", source: liveSource("live-message"), buildActivities: assistantParts });
    store.placeAssistant({
      turnId: "persisted",
      source: persistedSource("entry-a", "persisted-message"),
      buildActivities: assistantParts,
    });

    store.upsertTool({
      source: { kind: "persisted", entryId: "tool-result-entry" },
      fallbackTurnId: "live",
      toolCallId: "call-1",
      name: "read",
      args: {},
      status: "complete",
      output: "persisted body",
      isError: false,
      endedAt: 2,
      timestamp: 2,
    });
    store.upsertTool({
      source: { kind: "live" },
      fallbackTurnId: "live",
      toolCallId: "call-1",
      name: "read",
      args: {},
      status: "complete",
      output: "late body",
      isError: false,
      endedAt: 3,
      timestamp: 3,
    });

    expect(itemIds(store, "live")).toEqual([]);
    expect(store.turn("persisted").items.find((item) => item.type === "tool")).toMatchObject({
      id: "tool-call-1",
      tool: { id: "call-1", status: "complete", output: "persisted body" },
    });
  });

  it("adopts a live compaction by firstKeptEntryId and ignores replay after persisted takeover", () => {
    const store = storeWithTurns("turn");
    store.placeCompaction({
      source: { kind: "live", firstKeptEntryId: "kept", fallbackViewId: "live-compaction" },
      buildItem: (id) => compaction(id, "live"),
    });
    store.placeCompaction({
      source: { kind: "persisted", entryId: "entry-c", firstKeptEntryId: "kept", fallbackViewId: "entry-c" },
      buildItem: (id) => compaction(id, "persisted"),
    });

    expect(store.read()).toEqual([
      expect.objectContaining({ id: "turn", type: "turn" }),
      expect.objectContaining({ id: "live-compaction", type: "compaction", summary: "persisted" }),
    ]);
    expect(store.placeCompaction({
      turnId: "turn",
      source: { kind: "live", firstKeptEntryId: "kept", fallbackViewId: "late" },
      buildItem: (id) => compaction(id, "late"),
    })).toEqual({ kind: "ignored-persisted-owner", viewId: "live-compaction" });
    expect(itemIds(store, "turn")).toEqual([]);
  });
});

function storeWithTurns(...turnIds: string[]): ConversationItemStore {
  const store = new ConversationItemStore();
  for (const id of turnIds) store.appendItem(turn(id));
  return store;
}

function turn(id: string): AgentTurnView {
  return { id, type: "turn", items: [], status: "running", startedAt: 0 };
}

function liveSource(fallbackViewMessageId: string): AssistantMessageSource {
  return { kind: "live", correlationKey: correlation, fallbackViewMessageId };
}

function persistedSource(entryId: string, fallbackViewMessageId: string): Extract<AssistantMessageSource, { kind: "persisted" }> {
  return { kind: "persisted", entryId, correlationKey: correlation, fallbackViewMessageId };
}

function assistantParts(messageId: string): AgentActivityView[] {
  return [
    { id: `${messageId}:reasoning:0`, type: "reasoning", text: "thinking", status: "complete", timestamp: 1 },
    response(`${messageId}:response:1`, "answer"),
    {
      id: "tool-call-1",
      type: "tool",
      timestamp: 1,
      tool: {
        state: "bound",
        id: "call-1",
        name: "read",
        label: "read",
        args: { path: "a.ts" },
        status: "running",
        isError: false,
        startedAt: 1,
      },
    },
  ];
}

function response(id: string, text: string): AgentActivityView {
  return { id, type: "response", blocks: [{ type: "text", text }], status: "complete", timestamp: 1 };
}

function preparingTool(id: string, rawArguments: string): AgentActivityView {
  return {
    id,
    type: "tool",
    timestamp: 1,
    tool: { state: "preparing", rawArguments, status: "running", isError: false, startedAt: 1 },
  };
}

function boundTool(id: string): AgentActivityView {
  return {
    id,
    type: "tool",
    timestamp: 1,
    tool: {
      state: "bound",
      id: "call-1",
      name: "read",
      label: "read",
      args: { path: "a.ts" },
      status: "running",
      isError: false,
      startedAt: 1,
    },
  };
}

function compaction(id: string, summary: string): CompactionView {
  return { id, type: "compaction", summary, tokensBefore: 10, timestamp: 1 };
}

function itemIds(store: ConversationItemStore, turnId: string): string[] {
  return store.turn(turnId).items.map((item) => item.id);
}
