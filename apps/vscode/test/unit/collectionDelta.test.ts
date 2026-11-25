import { describe, expect, it } from "vitest";

import { collectionDelta, conversationDelta } from "@frostime/pi-client/host/bridge/collectionDelta";
import type { AgentTurnView, ConversationItemView } from "$shared/model/conversationModel";
import { mergeCollection, mergeConversation } from "$ui/bridge/applyHostMessage.js";

describe("incremental Webview collections", () => {
  it("transmits only appended or replaced objects while preserving order", () => {
    const first = { id: "a", value: 1 };
    const changed = { id: "a", value: 2 };
    const appended = { id: "b", value: 3 };
    const delta = collectionDelta(["a"], new Map([["a", first]]), [changed, appended]);
    expect(delta).toEqual({ mode: "upsert", items: [changed, appended] });
    expect(mergeCollection([first], delta)).toEqual([changed, appended]);
  });

  it("replaces the collection when items are removed or reordered", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    expect(collectionDelta(["a", "b"], new Map([["a", a], ["b", b]]), [b, a])).toEqual({ mode: "replace", items: [b, a] });
  });

  it("patches a known turn with only its changed steps and keeps the rest of the Webview's objects", () => {
    const tool = (id: string, output: string) => ({ id, type: "tool", timestamp: 1, tool: { output } }) as unknown as AgentTurnView["items"][number];
    const response = (text: string) => ({ id: "r", type: "response", status: "streaming", timestamp: 1, blocks: [{ type: "text", text }] }) as AgentTurnView["items"][number];
    const steps = [tool("t1", "one"), tool("t2", "two")];
    const turn: AgentTurnView = { id: "turn", type: "turn", items: [...steps, response("Hel")], status: "running", startedAt: 1 };
    const earlier: AgentTurnView = { id: "earlier", type: "turn", items: [], status: "completed", startedAt: 0 };
    const previous: ConversationItemView[] = [earlier, turn];
    const grown: AgentTurnView = { ...turn, items: [...steps, response("Hello")] };
    const notice = { id: "n", type: "notice", text: "note", level: "info", timestamp: 2 } as ConversationItemView;

    const delta = conversationDelta(previous.map((item) => item.id), new Map(previous.map((item) => [item.id, item])), [earlier, grown, notice]);
    expect(delta).toEqual({
      mode: "upsert",
      items: [notice],
      turnPatches: [{ turn: { id: "turn", type: "turn", status: "running", startedAt: 1 }, items: { mode: "upsert", items: [grown.items[2]] } }],
    });

    // The Webview holds its own copies; untouched turns and steps keep them.
    const webview = structuredClone(previous);
    const merged = mergeConversation(webview, structuredClone(delta));
    expect(merged).toEqual([earlier, grown, notice]);
    expect(merged[0]).toBe(webview[0]);
    const mergedTurn = merged[1] as AgentTurnView;
    const webviewTurn = webview[1] as AgentTurnView;
    expect(mergedTurn.items[0]).toBe(webviewTurn.items[0]);
    expect(mergedTurn.items[1]).toBe(webviewTurn.items[1]);
  });

  it("sends a new turn whole and replaces a turn's steps when they were removed or reordered", () => {
    const a = { id: "a", type: "notice", text: "a", level: "info", timestamp: 1 } as AgentTurnView["items"][number];
    const b = { ...a, id: "b" };
    const turn: AgentTurnView = { id: "turn", type: "turn", items: [a, b], status: "running", startedAt: 1 };
    const fresh: AgentTurnView = { ...turn, id: "fresh" };
    const reordered: AgentTurnView = { ...turn, items: [b] };
    expect(conversationDelta(["turn"], new Map([["turn", turn]]), [reordered, fresh])).toEqual({
      mode: "upsert",
      items: [fresh],
      turnPatches: [{ turn: { id: "turn", type: "turn", status: "running", startedAt: 1 }, items: { mode: "replace", items: [b] } }],
    });
  });
});
