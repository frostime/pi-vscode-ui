import type { RpcSessionEntry } from "@frostime/pi-rpc";
import { describe, expect, it } from "vitest";

import { ConversationProjection } from "../../src/extension/conversation/ConversationProjection.js";
import type { AgentTurnView } from "../../src/shared/model/conversationModel.js";

describe("ConversationProjection", () => {
  it("preserves active-path order across turns, branch edges, boundaries, and custom blocks", () => {
    const projection = new ConversationProjection();
    projection.replaceEntries([
      userEntry("u1", null, "Start", 1),
      assistantEntry("a1", "u1", [{ type: "text", text: "Done" }], "stop", 2),
      entry("compaction", "c1", "a1", { summary: "Earlier context", tokensBefore: 1200, timestamp: 3 }),
      entry("custom_message", "custom1", "c1", {
        customType: "session-prune",
        display: true,
        content: [
          { type: "text", text: "before" },
          { type: "image", data: "AA==", mimeType: "image/png" },
          { type: "text", text: "after" },
        ],
        timestamp: 4,
      }),
      entry("branch_summary", "summary1", "custom1", { summary: "Other path", timestamp: 5 }),
      userEntry("u2", "summary1", "Continue", 6),
    ], [{ branchPointId: "a1", activeChildEntryId: "c1", pathCount: 2 }]);

    const items = projection.read().items;
    expect(items.map((item) => item.type)).toEqual([
      "turn",
      "branchControl",
      "compaction",
      "customMessage",
      "branchSummary",
      "turn",
    ]);
    expect(items[3]).toMatchObject({
      id: "custom1",
      type: "customMessage",
      blocks: [
        { type: "text", text: "before" },
        { type: "images", images: [expect.objectContaining({ id: "custom1-image-1" })] },
        { type: "text", text: "after" },
      ],
    });
    expect(turns(items).map((turn) => turn.userMessage?.sourceEntryId)).toEqual(["u1", "u2"]);
  });

  it("places a non-user branch edge inside its visual turn and updates the existing tool call", () => {
    const projection = new ConversationProjection();
    projection.replaceEntries([
      userEntry("u1", null, "Inspect", 1),
      assistantEntry("a1", "u1", [{ type: "toolCall", id: "t1", name: "read", arguments: { path: "a.ts" } }], "toolUse", 2),
      toolResultEntry("r1", "a1", "t1", "body", 3),
      assistantEntry("a2", "r1", [{ type: "text", text: "Finished" }], "stop", 4),
    ], [{ branchPointId: "a1", activeChildEntryId: "r1", pathCount: 2 }]);

    const [turn] = turns(projection.read().items);
    expect(turn?.items.map((item) => item.type)).toEqual(["tool", "branchControl", "response"]);
    expect(turn?.items[0]).toMatchObject({
      type: "tool",
      tool: { id: "t1", status: "complete", output: "body" },
    });
  });

  it("pairs equal live prompts with persisted user entries in protocol order without rebuilding turns", () => {
    const projection = new ConversationProjection();
    const firstTurnId = runLiveTurn(projection, "repeat", 10, "assistant-1", "First");
    const secondTurnId = runLiveTurn(projection, "repeat", 10, "assistant-2", "Second");

    projection.reconcileEntries([
      userEntry("u1", null, "repeat", 100),
      assistantEntry("a1", "u1", [{ type: "text", text: "First" }], "stop", 101, "assistant-1"),
      userEntry("u2", "a1", "repeat", 100),
      assistantEntry("a2", "u2", [{ type: "text", text: "Second" }], "stop", 102, "assistant-2"),
    ], []);

    const projectedTurns = turns(projection.read().items);
    expect(projectedTurns.map((turn) => turn.id)).toEqual([firstTurnId, secondTurnId]);
    expect(projectedTurns.map((turn) => turn.userMessage?.sourceEntryId)).toEqual(["u1", "u2"]);
    expect(projectedTurns.map((turn) => turn.items.filter((item) => item.type === "response").length)).toEqual([1, 1]);
  });

  it("moves a matched live turn behind its newly persisted entering edge", () => {
    const projection = new ConversationProjection();
    projection.replaceEntries([
      userEntry("u1", null, "Start", 1),
      assistantEntry("a1", "u1", [{ type: "text", text: "Done" }], "stop", 2),
    ], []);
    const liveTurnId = projection.appendUserPrompt("Branch", [], 3);
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({ type: "message_start", message: { role: "user", content: "Branch", timestamp: 3 } });

    expect(projection.reconcileEntries([
      userEntry("u2", "a1", "Branch", 3),
    ], [{ branchPointId: "a1", activeChildEntryId: "u2", pathCount: 2 }])).toBe("applied");

    expect(projection.read().items.map((item) => [item.type, item.id])).toEqual([
      ["turn", "turn-u1"],
      ["branchControl", "branch-control:a1:u2"],
      ["turn", liveTurnId],
    ]);
  });

  it("keeps persisted boundaries between matched live turns", () => {
    const projection = new ConversationProjection();
    const firstTurnId = runLiveTurn(projection, "first", 10, "assistant-1", "First");
    const secondTurnId = runLiveTurn(projection, "second", 20, "assistant-2", "Second");

    projection.reconcileEntries([
      userEntry("u1", null, "first", 100),
      assistantEntry("a1", "u1", [{ type: "text", text: "First" }], "stop", 101, "assistant-1"),
      entry("branch_summary", "summary1", "a1", { summary: "Previous path", timestamp: 102 }),
      entry("custom_message", "custom1", "summary1", { display: true, content: "Custom", timestamp: 103 }),
      userEntry("u2", "custom1", "second", 104),
      assistantEntry("a2", "u2", [{ type: "text", text: "Second" }], "stop", 105, "assistant-2"),
    ], [{ branchPointId: "a1", activeChildEntryId: "summary1", pathCount: 2 }]);

    expect(projection.read().items.map((item) => [item.type, item.id])).toEqual([
      ["turn", firstTurnId],
      ["branchControl", "branch-control:a1:summary1"],
      ["branchSummary", "summary1"],
      ["customMessage", "custom1"],
      ["turn", secondTurnId],
    ]);
  });

  it("does not consume the next queued follow-up after agent_start already promoted one", () => {
    const projection = new ConversationProjection();
    const firstTurnId = projection.appendUserPrompt("first", [], 1);
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({ type: "message_start", message: { role: "user", content: "first", timestamp: 1 } });
    projection.enqueueFollowUp("second", [], 2);
    projection.enqueueFollowUp("third", [], 3);
    projection.applyEvent({ type: "agent_settled" });

    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({ type: "message_start", message: { role: "user", content: "second", timestamp: 2 } });
    expect(projection.read().queuedFollowUps.map((item) => item.text)).toEqual(["third"]);

    projection.applyEvent({ type: "agent_settled" });
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({ type: "message_start", message: { role: "user", content: "third", timestamp: 3 } });
    projection.reconcileEntries([
      userEntry("u1", null, "first", 1),
      userEntry("u2", "u1", "second", 2),
      userEntry("u3", "u2", "third", 3),
    ], []);

    expect(turns(projection.read().items).map((turn) => [turn.id, turn.userMessage?.sourceEntryId])).toEqual([
      [firstTurnId, "u1"],
      [expect.any(String), "u2"],
      [expect.any(String), "u3"],
    ]);
  });

  it("promotes queued follow-ups from consecutive user events without agent_start", () => {
    const projection = new ConversationProjection();
    projection.appendUserPrompt("first", [], 1);
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({ type: "message_start", message: { role: "user", content: "first", timestamp: 1 } });
    projection.enqueueFollowUp("second", [], 2);
    projection.enqueueFollowUp("third", [], 3);

    projection.applyEvent({ type: "message_start", message: { role: "user", content: "second", timestamp: 2 } });
    expect(projection.read().queuedFollowUps.map((item) => item.text)).toEqual(["third"]);
    projection.applyEvent({ type: "message_start", message: { role: "user", content: "third", timestamp: 3 } });

    expect(turns(projection.read().items).map((turn) => userText(turn))).toEqual(["first", "second", "third"]);
    expect(projection.read().queuedFollowUps).toEqual([]);
  });

  it("does not attach a rejected optimistic prompt to a later identical persisted prompt", () => {
    const projection = new ConversationProjection();
    const rejectedTurnId = projection.appendUserPrompt("repeat", [], 10);
    projection.completeTurn(rejectedTurnId, "error", 11);
    const acceptedTurnId = runLiveTurn(projection, "repeat", 10, "assistant-1", "Accepted");

    projection.reconcileEntries([
      userEntry("u1", null, "repeat", 100),
      assistantEntry("a1", "u1", [{ type: "text", text: "Accepted" }], "stop", 101, "assistant-1"),
    ], []);

    const projectedTurns = turns(projection.read().items);
    expect(projectedTurns.find((turn) => turn.id === rejectedTurnId)?.userMessage?.sourceEntryId).toBeUndefined();
    expect(projectedTurns.find((turn) => turn.id === acceptedTurnId)?.userMessage?.sourceEntryId).toBe("u1");
  });

  it("reconciles a live compaction to one persisted boundary while preserving its view identity", () => {
    const projection = new ConversationProjection();
    projection.applyEvent({
      type: "compaction_end",
      result: { summary: "Compact", tokensBefore: 500 },
    });
    const liveId = projection.read().items[0]?.id;

    projection.reconcileEntries([
      entry("compaction", "c1", null, { summary: "Compact", tokensBefore: 500, timestamp: 1 }),
    ], []);

    expect(projection.read().items).toEqual([
      expect.objectContaining({ id: liveId, type: "compaction", summary: "Compact" }),
    ]);
  });

  it("rejects persisted custom images that exceed Host projection limits", () => {
    const projection = new ConversationProjection(1, 12);

    expect(() => projection.replaceEntries([
      entry("custom_message", "custom1", null, {
        customType: "extension",
        display: true,
        content: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
      }),
    ], [])).toThrow("image limit");
  });

  it("rejects persisted assistant messages above the image-count limit", () => {
    const projection = new ConversationProjection(1024, 12);

    expect(() => projection.replaceEntries([
      userEntry("u1", null, "Show images", 1),
      assistantEntry("a1", "u1", Array.from({ length: 13 }, () => ({
        type: "image",
        data: "AA==",
        mimeType: "image/png",
      })), "stop", 2),
    ], [])).toThrow("more than 12 images");
  });

  it("requests a full rebuild when a new branch control belongs before the appended segment", () => {
    const projection = new ConversationProjection();
    projection.replaceEntries([
      userEntry("u1", null, "Start", 1),
      assistantEntry("a1", "u1", [{ type: "text", text: "Done" }], "stop", 2),
    ], []);

    expect(projection.reconcileEntries([], [
      { branchPointId: null, activeChildEntryId: "u1", pathCount: 2 },
    ])).toBe("reload");
  });
});

function runLiveTurn(
  projection: ConversationProjection,
  prompt: string,
  timestamp: number,
  assistantId: string,
  response: string,
): string {
  const turnId = projection.appendUserPrompt(prompt, [], timestamp);
  projection.applyEvent({ type: "agent_start" });
  projection.applyEvent({ type: "message_start", message: { role: "user", content: prompt, timestamp: 100 } });
  projection.applyEvent({
    type: "message_end",
    message: { id: assistantId, role: "assistant", content: [{ type: "text", text: response }], stopReason: "stop", timestamp: timestamp + 1 },
  });
  projection.applyEvent({ type: "agent_settled" });
  return turnId;
}

function turns(items: readonly { type: string }[]): AgentTurnView[] {
  return items.filter((item): item is AgentTurnView => item.type === "turn");
}

function userText(turn: AgentTurnView): string {
  return turn.userMessage?.blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("") ?? "";
}

function userEntry(id: string, parentId: string | null, content: string, timestamp: number): RpcSessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: { role: "user", content, timestamp },
  };
}

function assistantEntry(
  id: string,
  parentId: string | null,
  content: unknown[],
  stopReason: string,
  timestamp: number,
  messageId?: string,
): RpcSessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: { ...(messageId ? { id: messageId } : {}), role: "assistant", content, stopReason, timestamp },
  };
}

function toolResultEntry(
  id: string,
  parentId: string,
  toolCallId: string,
  output: string,
  timestamp: number,
): RpcSessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: { role: "toolResult", toolCallId, toolName: "read", content: [{ type: "text", text: output }], timestamp },
  };
}

function entry(
  type: string,
  id: string,
  parentId: string | null,
  fields: Record<string, unknown>,
): RpcSessionEntry {
  return { type, id, parentId, ...fields };
}
