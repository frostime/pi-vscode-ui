import type { RpcSessionEntry } from "@frostime/pi-rpc";
import { describe, expect, it } from "vitest";

import { ConversationProjection } from "../../src/extension/conversation/ConversationProjection.js";
import type { AgentTurnView } from "../../src/shared/model/conversationModel.js";
import type { BoundToolCallView } from "../../src/shared/model/toolCallModel.js";

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

  it("promotes steering prompts before follow-ups when Pi injects queued user messages", () => {
    const projection = new ConversationProjection();
    projection.appendUserPrompt("first", [], 1);
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({ type: "message_start", message: { role: "user", content: "first", timestamp: 1 } });
    projection.enqueueFollowUp("afterward", [], 2);
    projection.enqueueSteer("redirect now", [], 3);

    projection.applyEvent({ type: "message_start", message: { role: "user", content: "redirect now", timestamp: 3 } });
    expect(projection.read().queuedSteers).toEqual([]);
    expect(projection.read().queuedFollowUps.map((item) => item.text)).toEqual(["afterward"]);

    projection.applyEvent({ type: "message_start", message: { role: "user", content: "afterward", timestamp: 2 } });
    expect(turns(projection.read().items).map((turn) => userText(turn))).toEqual(["first", "redirect now", "afterward"]);
    expect(projection.read().queuedFollowUps).toEqual([]);
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

  it("does not reuse a completed turn's assistant correlation for the next turn", () => {
    const projection = new ConversationProjection();
    const firstTurnId = projection.appendUserPrompt("first", [], 1);
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({ type: "message_start", message: { role: "user", content: "first", timestamp: 1 } });
    projection.applyEvent({
      type: "message_start",
      message: { role: "assistant", content: [{ type: "text", text: "partial" }], timestamp: 10 },
    });
    expect(projection.completeTurn(firstTurnId, "error", 11)).toBe(true);

    projection.appendUserPrompt("second", [], 2);
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({ type: "message_start", message: { role: "user", content: "second", timestamp: 2 } });
    projection.applyEvent({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "final" }], stopReason: "stop", timestamp: 20 },
    });

    expect(turns(projection.read().items).map((turn) => (
      turn.items.filter((item) => item.type === "response").map(responseText)
    ))).toEqual([["partial"], ["final"]]);
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
      result: { summary: "Compact", tokensBefore: 500, firstKeptEntryId: "kept-1" },
    });
    const liveId = projection.read().items[0]?.id;

    projection.reconcileEntries([
      entry("compaction", "c1", null, {
        summary: "Compact",
        tokensBefore: 500,
        firstKeptEntryId: "kept-1",
        timestamp: 1,
      }),
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

    expect(projection.reconcileEntries([
      entry("custom_message", "custom1", "a1", { display: true, content: "Appended" }),
    ], [
      { branchPointId: null, activeChildEntryId: "u1", pathCount: 2 },
    ])).toBe("reload");
    expect(projection.read().items.some((item) => item.id === "custom1")).toBe(false);
  });

  it("keeps provider retry in one user turn and converges to full replacement", () => {
    const entries = [
      userEntry("u1", null, "Retry", 1),
      assistantEntry("a1", "u1", [{ type: "text", text: "partial" }], "error", 2, undefined, "transient"),
      assistantEntry("a2", "a1", [{ type: "text", text: "final" }], "stop", 3),
    ];
    const projection = new ConversationProjection();
    projection.appendUserPrompt("Retry", [], 1);
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({ type: "message_start", message: { role: "user", content: "Retry", timestamp: 1 } });
    projection.applyEvent({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "error", errorMessage: "transient", timestamp: 2 },
    });
    projection.applyEvent({ type: "agent_end", willRetry: true, messages: [] });
    projection.applyEvent({ type: "auto_retry_start", attempt: 2, maxAttempts: 3, delayMs: 0, errorMessage: "transient" });
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "final" }], stopReason: "stop", timestamp: 3 },
    });
    projection.applyEvent({ type: "agent_end", willRetry: false, messages: [] });
    projection.applyEvent({ type: "agent_settled" });

    expect(projection.reconcileEntries(entries, [])).toBe("applied");
    const [turn] = turns(projection.read().items);
    expect(turn?.status).toBe("completed");
    expect(turn?.items.filter((item) => item.type === "response").map(responseText)).toEqual([
      "partial",
      "transient",
      "final",
    ]);
    expect(turn?.items.filter((item) => item.type === "notice")).toHaveLength(1);

    const replacement = new ConversationProjection();
    replacement.replaceEntries(entries, []);
    expect(normalizePersistedProjection(projection)).toEqual(normalizePersistedProjection(replacement));
  });

  it("finalizes a retry error only when Pi will not continue", () => {
    const entries = [
      userEntry("u1", null, "Fail", 1),
      assistantEntry("a1", "u1", [{ type: "text", text: "partial" }], "error", 2, undefined, "failed"),
    ];
    const projection = new ConversationProjection();
    projection.appendUserPrompt("Fail", [], 1);
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({ type: "message_start", message: { role: "user", content: "Fail", timestamp: 1 } });
    projection.applyEvent({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "error", errorMessage: "failed", timestamp: 2 },
    });
    expect(turns(projection.read().items)[0]?.status).toBe("running");
    projection.applyEvent({ type: "agent_end", willRetry: false, messages: [] });
    expect(turns(projection.read().items)[0]?.status).toBe("error");
    projection.applyEvent({ type: "agent_settled" });
    projection.reconcileEntries(entries, []);

    const replacement = new ConversationProjection();
    replacement.replaceEntries(entries, []);
    expect(normalizePersistedProjection(projection)).toEqual(normalizePersistedProjection(replacement));
    expect(turns(replacement.read().items)[0]?.status).toBe("error");
  });

  it("returns reload before mutation when two persisted entries could adopt one timestamp identity", () => {
    const projection = new ConversationProjection();
    projection.appendUserPrompt("Collision", [], 1);
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({ type: "message_start", message: { role: "user", content: "Collision", timestamp: 1 } });
    projection.applyEvent({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "live" }], stopReason: "stop", timestamp: 2 },
    });
    const before = projection.read().items;
    const entries = [
      userEntry("u1", null, "Collision", 1),
      assistantEntry("a1", "u1", [{ type: "text", text: "first" }], "stop", 2),
      assistantEntry("a2", "a1", [{ type: "text", text: "second" }], "stop", 2),
    ];

    expect(projection.reconcileEntries(entries, [])).toBe("reload");
    expect(projection.read().items).toBe(before);

    projection.replaceEntries(entries, []);
    expect(turns(projection.read().items).flatMap((turn) => turn.items).filter((item) => item.type === "response")).toHaveLength(2);
  });

  it("keeps no-live timestamp collisions incremental and distinct", () => {
    const entries = [
      userEntry("u1", null, "Collision", 1),
      assistantEntry("a1", "u1", [{ type: "text", text: "first" }], "stop", 2),
      assistantEntry("a2", "a1", [{ type: "text", text: "second" }], "stop", 2),
    ];
    const projection = new ConversationProjection();

    expect(projection.reconcileEntries(entries, [])).toBe("applied");
    expect(turns(projection.read().items).flatMap((turn) => turn.items).filter((item) => item.type === "response")).toHaveLength(2);

    const replacement = new ConversationProjection();
    replacement.replaceEntries(entries, []);
    expect(normalizePersistedProjection(projection)).toEqual(normalizePersistedProjection(replacement));
  });

  it("finalizes unresolved tools after complete history replacement without inventing a result", () => {
    const projection = new ConversationProjection();
    projection.replaceEntries([
      userEntry("u1", null, "Inspect", 1),
      assistantEntry("a1", "u1", [{ type: "toolCall", id: "t1", name: "read", arguments: { path: "a.ts" } }], "toolUse", 2),
    ], []);

    const [tool] = turns(projection.read().items)[0]?.items.filter((item) => item.type === "tool") ?? [];
    expect(tool?.tool).toMatchObject({
      state: "bound",
      id: "t1",
      status: "cancelled",
      args: { path: "a.ts" },
      isError: false,
    });
    if (tool?.tool.state !== "bound") throw new Error("Expected a bound tool");
    expect(tool.tool.output).toBeUndefined();
    expect(tool.tool.endedAt).toBeUndefined();
  });

  it("preserves settled tool state through assistant takeover and accepts a later authoritative result", () => {
    const projection = new ConversationProjection();
    projection.appendUserPrompt("Inspect", [], 1);
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({ type: "message_start", message: { role: "user", content: "Inspect", timestamp: 1 } });
    projection.applyEvent({
      type: "message_end",
      message: {
        id: "assistant-1",
        role: "assistant",
        content: [{ type: "toolCall", id: "t1", name: "read", arguments: { path: "a.ts" } }],
        stopReason: "toolUse",
        timestamp: 2,
      },
    });
    projection.applyEvent({
      type: "tool_execution_update",
      toolCallId: "t1",
      toolName: "read",
      args: { path: "a.ts" },
      partialResult: [{ type: "text", text: "partial" }],
    });
    projection.applyEvent({ type: "agent_settled" });
    expect(projectedTool(projection, "t1")).toMatchObject({ status: "cancelled", output: "partial", isError: false });

    expect(projection.reconcileEntries([
      userEntry("u1", null, "Inspect", 1),
      assistantEntry(
        "a1",
        "u1",
        [{ type: "toolCall", id: "t1", name: "read", arguments: { path: "a.ts" } }],
        "toolUse",
        2,
        "assistant-1",
      ),
    ], [])).toBe("applied");
    expect(projectedTool(projection, "t1")).toMatchObject({ status: "cancelled", output: "partial", isError: false });

    expect(projection.reconcileEntries([
      toolResultEntry("r1", "a1", "t1", "final", 3),
    ], [])).toBe("applied");
    expect(projectedTool(projection, "t1")).toMatchObject({ status: "complete", output: "final", isError: false, endedAt: 3 });
  });

  it("keeps persisted tool failures authoritative", () => {
    const projection = new ConversationProjection();
    projection.replaceEntries([
      userEntry("u1", null, "Inspect", 1),
      assistantEntry("a1", "u1", [{ type: "toolCall", id: "t1", name: "read", arguments: {} }], "toolUse", 2),
      toolResultEntry("r1", "a1", "t1", "failed", 3, true),
    ], []);

    expect(projectedTool(projection, "t1")).toMatchObject({ status: "error", output: "failed", isError: true, endedAt: 3 });
  });

  it("ignores stale assistant and compaction replay after persisted replacement", () => {
    const projection = new ConversationProjection();
    projection.replaceEntries([
      userEntry("u1", null, "Done", 1),
      assistantEntry("a1", "u1", [{ type: "toolCall", id: "t1", name: "read", arguments: {} }], "toolUse", 2),
      toolResultEntry("r1", "a1", "t1", "body", 3),
      assistantEntry("a2", "r1", [{ type: "text", text: "answer" }], "stop", 4),
      entry("compaction", "c1", "a2", {
        summary: "compact",
        tokensBefore: 100,
        firstKeptEntryId: "kept-1",
        timestamp: 5,
      }),
    ], []);
    projection.applyEvent({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "answer" }], stopReason: "stop", timestamp: 4 },
    });
    projection.applyEvent({
      type: "tool_execution_end",
      toolCallId: "t1",
      toolName: "read",
      result: [{ type: "text", text: "late body" }],
      isError: false,
    });
    projection.applyEvent({
      type: "compaction_end",
      result: { summary: "compact", tokensBefore: 100, firstKeptEntryId: "kept-1" },
    });

    const [turn] = turns(projection.read().items);
    expect(turns(projection.read().items)).toHaveLength(1);
    expect(turn?.items.filter((item) => item.type === "response")).toHaveLength(1);
    const tools = turn?.items.filter((item) => item.type === "tool") ?? [];
    expect(tools).toHaveLength(1);
    expect(tools[0]?.tool).toMatchObject({ state: "bound", id: "t1", output: "body" });
    expect(projection.read().items.filter((item) => item.type === "compaction")).toHaveLength(1);
  });

  it("does not create an empty turn when a buffered lifecycle is already persisted", () => {
    const projection = new ConversationProjection();
    projection.replaceEntries([
      userEntry("u1", null, "Done", 1),
      assistantEntry("a1", "u1", [{ type: "text", text: "answer" }], "stop", 2),
    ], []);

    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({ type: "message_start", message: { role: "user", content: "Done", timestamp: 1 } });
    projection.applyEvent({
      type: "message_start",
      message: { role: "assistant", content: [{ type: "text", text: "answer" }], stopReason: "stop", timestamp: 2 },
    });
    projection.applyEvent({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "answer" }], stopReason: "stop", timestamp: 2 },
    });
    projection.applyEvent({ type: "agent_settled" });

    expect(turns(projection.read().items)).toHaveLength(1);
    expect(turns(projection.read().items)[0]?.items.filter((item) => item.type === "response")).toHaveLength(1);
  });

  it("reloads before reconciling a compaction without a structural correlation key", () => {
    const projection = new ConversationProjection();
    projection.applyEvent({
      type: "compaction_end",
      result: { summary: "live", tokensBefore: 100, firstKeptEntryId: "kept" },
    });
    const before = projection.read().items;
    const persisted = entry("compaction", "c1", null, {
      summary: "persisted",
      tokensBefore: 100,
      timestamp: 1,
    });

    expect(projection.reconcileEntries([persisted], [])).toBe("reload");
    expect(projection.read().items).toBe(before);

    projection.replaceEntries([persisted], []);
    expect(projection.read().items).toEqual([
      expect.objectContaining({ id: "c1", type: "compaction", summary: "persisted" }),
    ]);
  });

  it("keeps overflow continuation through an empty refresh after live success", () => {
    const prefix = [
      userEntry("u1", null, "Long", 1),
      assistantEntry("a1", "u1", [{ type: "text", text: "overflow" }], "error", 2),
      entry("compaction", "c1", "a1", {
        summary: "compact",
        tokensBefore: 100,
        firstKeptEntryId: "kept-1",
        timestamp: 3,
      }),
    ];
    const success = assistantEntry("a2", "c1", [{ type: "text", text: "final" }], "stop", 4);
    const projection = new ConversationProjection();
    projection.appendUserPrompt("Long", [], 1);
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({ type: "message_start", message: { role: "user", content: "Long", timestamp: 1 } });
    projection.applyEvent({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "overflow" }], stopReason: "error", timestamp: 2 },
    });
    projection.applyEvent({ type: "agent_end", willRetry: false, messages: [] });
    projection.applyEvent({
      type: "compaction_end",
      willRetry: true,
      result: { summary: "compact", tokensBefore: 100, firstKeptEntryId: "kept-1" },
    });
    expect(projection.reconcileEntries(prefix, [])).toBe("applied");

    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "final" }], stopReason: "stop", timestamp: 4 },
    });
    projection.applyEvent({ type: "agent_settled" });
    expect(projection.reconcileEntries([], [])).toBe("applied");
    expect(projection.reconcileEntries([success], [])).toBe("applied");

    const [turn] = turns(projection.read().items);
    expect(turns(projection.read().items)).toHaveLength(1);
    expect(turn?.status).toBe("completed");
    expect(turn?.items.map((item) => item.type)).toEqual(["response", "compaction", "response"]);
  });

  it("keeps overflow compaction continuation in one turn with stable activity order", () => {
    const entries = [
      userEntry("u1", null, "Long", 1),
      assistantEntry("a1", "u1", [{ type: "text", text: "overflow" }], "error", 2),
      entry("compaction", "c1", "a1", {
        summary: "compact",
        tokensBefore: 100,
        firstKeptEntryId: "kept-1",
        timestamp: 3,
      }),
      assistantEntry("a2", "c1", [{ type: "text", text: "final" }], "stop", 4),
    ];
    const projection = new ConversationProjection();
    expect(projection.reconcileEntries(entries.slice(0, 2), [])).toBe("applied");
    expect(turns(projection.read().items)[0]?.status).toBe("running");
    expect(projection.reconcileEntries(entries.slice(2, 3), [])).toBe("applied");
    expect(projection.reconcileEntries(entries.slice(3), [])).toBe("applied");

    const [turn] = turns(projection.read().items);
    expect(turn?.status).toBe("completed");
    expect(turn?.items.map((item) => item.type)).toEqual(["response", "compaction", "response"]);
    expect(projection.read().items).toHaveLength(1);

    const replacement = new ConversationProjection();
    replacement.replaceEntries(entries, []);
    expect(normalizePersistedProjection(projection)).toEqual(normalizePersistedProjection(replacement));
  });

  it("projects one indexed tool card through preparation, binding, execution, final replacement, and persisted takeover", () => {
    const projection = new ConversationProjection();
    projection.appendUserPrompt("Inspect", [], 1);
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({ type: "message_start", message: { role: "user", content: "Inspect", timestamp: 1 } });
    projection.applyEvent({ type: "message_start", message: { role: "assistant", content: [], timestamp: 2 } });
    projection.applyEvent({ type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 2 } });
    projection.applyEvent({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
    projection.applyEvent({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 2, delta: "Reason" } });
    projection.applyEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Draft" } });
    projection.applyEvent({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 1 } });
    projection.applyEvent({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 1, delta: '{"path":' } });

    let [turn] = turns(projection.read().items);
    expect(turn?.items.map((item) => item.id)).toEqual([
      "assistant-2:response:0",
      "assistant-2:tool:1",
      "assistant-2:reasoning:2",
    ]);
    expect(turn?.items[1]).toMatchObject({
      id: "assistant-2:tool:1",
      tool: { state: "preparing", rawArguments: '{"path":' },
    });

    const toolCall = { type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.ts" } };
    projection.applyEvent({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, toolCall },
    });
    projection.applyEvent({ type: "tool_execution_start", toolCallId: "call-1", toolName: "read", args: { path: "a.ts" } });
    projection.applyEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Final" },
          toolCall,
          { type: "thinking", thinking: "Reasoned" },
        ],
        stopReason: "toolUse",
        timestamp: 2,
      },
    });
    projection.applyEvent({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "read",
      result: [{ type: "text", text: "body" }],
      isError: false,
    });

    [turn] = turns(projection.read().items);
    expect(turn?.items.map((item) => item.id)).toEqual([
      "assistant-2:response:0",
      "assistant-2:tool:1",
      "assistant-2:reasoning:2",
    ]);
    expect(turn?.items[1]).toMatchObject({
      id: "assistant-2:tool:1",
      tool: { state: "bound", id: "call-1", status: "complete", output: "body" },
    });
    expect(responseTexts(projection)).toContain("Final");

    const persisted = [
      userEntry("u1", null, "Inspect", 1),
      assistantEntry("a1", "u1", [
        { type: "text", text: "Final" },
        toolCall,
        { type: "thinking", thinking: "Reasoned" },
      ], "toolUse", 2),
      toolResultEntry("r1", "a1", "call-1", "persisted body", 3),
    ];
    expect(projection.reconcileEntries(persisted, [])).toBe("applied");
    projection.applyEvent({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "late" }], stopReason: "stop", timestamp: 2 },
    });

    [turn] = turns(projection.read().items);
    expect(turn?.items.filter((item) => item.type === "tool")).toHaveLength(1);
    expect(turn?.items.find((item) => item.type === "tool")).toMatchObject({
      id: "assistant-2:tool:1",
      tool: { state: "bound", id: "call-1", output: "persisted body" },
    });
    expect(responseTexts(projection)).toContain("Final");
    expect(responseTexts(projection)).not.toContain("late");
  });

  it("removes a provisional tool when the authoritative final message omits it", () => {
    const projection = new ConversationProjection();
    projection.appendUserPrompt("Draft", [], 1);
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({ type: "message_start", message: { role: "assistant", content: [], timestamp: 2 } });
    projection.applyEvent({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 0 } });
    projection.applyEvent({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: "partial" } });
    expect(projectedToolsInProjection(projection)).toHaveLength(1);

    projection.applyEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "No tool needed" }],
        stopReason: "stop",
        timestamp: 2,
      },
    });

    projection.applyEvent({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "late cumulative" }], timestamp: 2 },
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "late cumulative" },
    });

    expect(projectedToolsInProjection(projection)).toHaveLength(0);
    expect(responseTexts(projection).at(-1)).toBe("No tool needed");
  });

  it("does not carry an unfinished indexed retry attempt into the successful attempt", () => {
    const projection = new ConversationProjection();
    projection.appendUserPrompt("Retry", [], 1);
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({ type: "message_start", message: { role: "assistant", content: [], timestamp: 2 } });
    projection.applyEvent({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
    projection.applyEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "failed partial" } });
    projection.applyEvent({ type: "message_update", assistantMessageEvent: { type: "error", reason: "error" } });
    projection.applyEvent({ type: "agent_end", willRetry: true });
    projection.applyEvent({ type: "auto_retry_start", attempt: 2 });
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({ type: "message_start", message: { role: "assistant", content: [], timestamp: 3 } });
    projection.applyEvent({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
    projection.applyEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "success" } });
    projection.applyEvent({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "success" }], stopReason: "stop", timestamp: 3 },
    });

    expect(responseTexts(projection)).toEqual(["failed partial", "success"]);
  });

  it("isolates indexed partial content at every Projection reset boundary", () => {
    const boundaries: Array<{ name: string; apply(projection: ConversationProjection, turnId: string): void }> = [
      { name: "replacement start", apply: (projection) => projection.applyEvent({ type: "message_start", message: { role: "assistant", content: [], timestamp: 50 } }) },
      { name: "agent settled", apply: (projection) => projection.applyEvent({ type: "agent_settled" }) },
      { name: "completed turn", apply: (projection, turnId) => { projection.completeTurn(turnId); } },
      { name: "history replacement", apply: (projection) => projection.replaceEntries([], []) },
    ];

    for (const [index, boundary] of boundaries.entries()) {
      const projection = new ConversationProjection();
      const turnId = projection.appendUserPrompt(boundary.name, [], index + 1);
      projection.applyEvent({ type: "agent_start" });
      projection.applyEvent({ type: "message_start", message: { role: "assistant", content: [], timestamp: 10 + index } });
      projection.applyEvent({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
      projection.applyEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "old" } });

      boundary.apply(projection, turnId);
      const beforeLateUpdate = responseTexts(projection);
      projection.applyEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "late" },
      });
      expect(responseTexts(projection), boundary.name).toEqual(beforeLateUpdate);

      projection.applyEvent({ type: "message_start", message: { role: "assistant", content: [], timestamp: 100 + index } });
      projection.applyEvent({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 1 } });
      projection.applyEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "new" } });

      expect(responseTexts(projection).at(-1), boundary.name).toBe("new");
    }
  });
});

function projectedTool(projection: ConversationProjection, toolCallId: string): BoundToolCallView | undefined {
  for (const turn of turns(projection.read().items)) {
    for (const item of turn.items) {
      if (item.type === "tool" && item.tool.state === "bound" && item.tool.id === toolCallId) return item.tool;
    }
  }
  return undefined;
}

function projectedToolsInProjection(projection: ConversationProjection) {
  return turns(projection.read().items).flatMap((turn) => turn.items.filter((item) => item.type === "tool"));
}

function responseText(item: Extract<AgentTurnView["items"][number], { type: "response" }>): string {
  return item.blocks.map((block) => block.type === "text" || block.type === "error" ? block.text : "").join("");
}

function responseTexts(projection: ConversationProjection): string[] {
  return turns(projection.read().items).flatMap((turn) => turn.items.flatMap((item) => item.type === "response" ? responseText(item) : []));
}

function normalizePersistedProjection(projection: ConversationProjection): unknown {
  return projection.read().items.map((item) => {
    if (item.type !== "turn") return { type: item.type };
    return {
      type: "turn",
      sourceEntryId: item.userMessage?.sourceEntryId,
      status: item.status,
      items: item.items.filter((turnItem) => turnItem.type !== "notice").map((turnItem) => {
        if (turnItem.type === "response") {
          return { type: turnItem.type, status: turnItem.status, text: responseText(turnItem) };
        }
        if (turnItem.type === "reasoning") return { type: turnItem.type, status: turnItem.status, text: turnItem.text };
        if (turnItem.type === "tool") {
          return {
            type: turnItem.type,
            toolId: turnItem.tool.state === "bound" ? turnItem.tool.id : undefined,
            status: turnItem.tool.status,
          };
        }
        if (turnItem.type === "compaction") return { type: turnItem.type, summary: turnItem.summary };
        return { type: turnItem.type };
      }),
    };
  });
}

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
  errorMessage?: string,
): RpcSessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      ...(messageId ? { id: messageId } : {}),
      ...(errorMessage ? { errorMessage } : {}),
      role: "assistant",
      content,
      stopReason,
      timestamp,
    },
  };
}

function toolResultEntry(
  id: string,
  parentId: string,
  toolCallId: string,
  output: string,
  timestamp: number,
  isError = false,
): RpcSessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: { role: "toolResult", toolCallId, toolName: "read", content: [{ type: "text", text: output }], isError, timestamp },
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
