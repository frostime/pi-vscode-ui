import { describe, expect, it } from "vitest";

import { TurnProjection } from "../../src/extension/conversation/TurnProjection.js";

describe("TurnProjection", () => {
  it("hydrates branch summaries as separate conversation boundaries", () => {
    const projection = new TurnProjection();
    projection.hydrate([
      { role: "user", timestamp: 1, content: "Earlier prompt" },
      { role: "branchSummary", summary: "Decisions from the other path", fromId: "old-leaf", timestamp: 2 },
      { role: "user", timestamp: 3, content: "Current prompt" },
    ]);

    const summary = projection.snapshot().branchSummaries[0];
    expect(summary?.id).toMatch(/^branch-summary-/);
    expect(summary).toMatchObject({
      summary: "Decisions from the other path",
      fromId: "old-leaf",
      timestamp: 2,
    });
    expect(projection.snapshot().turns).toHaveLength(2);
  });

  it("hydrates displayable custom messages with their content and type", () => {
    const projection = new TurnProjection();
    projection.hydrate([
      { role: "user", timestamp: 1, content: "Hello" },
      {
        role: "custom",
        customType: "my-extension",
        content: "Injected context",
        display: true,
        details: { key: "value" },
        timestamp: 2,
      },
      { role: "custom", customType: "hidden", content: "Hidden", display: false, timestamp: 3 },
    ]);

    const messages = projection.snapshot().customMessages;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      customType: "my-extension",
      content: "Injected context",
      display: true,
      details: { key: "value" },
      timestamp: 2,
    });
  });

  it("binds stable Pi entry ids to duplicate user prompts without guessing by text", () => {
    const projection = new TurnProjection();
    projection.hydrate([
      { role: "user", timestamp: 10, content: "repeat" },
      { role: "assistant", timestamp: 11, stopReason: "stop", content: [] },
      { role: "user", timestamp: 20, content: "repeat" },
    ], [
      { entryId: "entry-1", timestamp: 10 },
      { entryId: "entry-2", timestamp: 20 },
    ]);

    expect(projection.snapshot().turns.map((turn) => turn.userMessage?.sourceEntryId)).toEqual(["entry-1", "entry-2"]);
  });

  it("uses Pi user event timestamps to bind duplicate live prompts in protocol order", () => {
    const projection = new TurnProjection();
    projection.appendUserPrompt("repeat", [], 10);
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({ type: "message_start", message: { role: "user", content: "expanded first", timestamp: 100 } });
    projection.applyEvent({ type: "agent_settled" });
    projection.appendUserPrompt("repeat", [], 20);
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({ type: "message_start", message: { role: "user", content: "expanded second", timestamp: 100 } });

    expect(projection.attachUserEntryReferences([
      { entryId: "entry-1", timestamp: 100 },
      { entryId: "entry-2", timestamp: 100 },
    ])).toBe(true);
    expect(projection.snapshot().turns.map((turn) => turn.userMessage?.sourceEntryId)).toEqual(["entry-1", "entry-2"]);
  });

  it("never attaches an entry to a rejected same-text optimistic turn", () => {
    const projection = new TurnProjection();
    const rejected = projection.appendUserPrompt("repeat", [], 10);
    projection.completeTurn(rejected, "error");
    projection.appendUserPrompt("repeat", [], 20);
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({ type: "message_start", message: { role: "user", content: "repeat", timestamp: 30 } });

    projection.attachUserEntryReferences([{ entryId: "accepted", timestamp: 30 }]);

    expect(projection.snapshot().turns.map((turn) => turn.userMessage?.sourceEntryId)).toEqual([undefined, "accepted"]);
  });

  it("keeps reasoning, tools, and response segments in protocol order", () => {
    const projection = new TurnProjection();
    projection.hydrate([
      { role: "user", id: "u1", timestamp: 1, content: "Check release" },
      {
        role: "assistant", id: "a1", timestamp: 2, stopReason: "stop", content: [
          { type: "thinking", thinking: "Inspect repository" },
          { type: "toolCall", id: "t1", name: "bash", arguments: { command: "git status" } },
          { type: "text", text: "The repository is clean." },
        ],
      },
      { role: "toolResult", toolCallId: "t1", toolName: "bash", timestamp: 3, content: [{ type: "text", text: "clean" }] },
    ]);

    expect(projection.snapshot().turns[0]?.activities.map((activity) => activity.type)).toEqual(["reasoning", "tool", "response"]);
    expect(projection.snapshot().turns[0]?.activities[1]).toMatchObject({ type: "tool", tool: { status: "complete", output: "clean" } });
  });

  it("restores provider errors that have no assistant content", () => {
    const projection = new TurnProjection();
    projection.hydrate([
      { role: "user", id: "u1", timestamp: 1, content: "test" },
      {
        role: "assistant",
        id: "a1",
        timestamp: 2,
        stopReason: "error",
        errorMessage: "Provided authentication token is expired.",
        content: [],
      },
    ]);

    expect(projection.snapshot().turns[0]).toMatchObject({
      status: "error",
      activities: [{ type: "response", status: "error", blocks: [{ type: "error", text: "Provided authentication token is expired." }] }],
    });
  });

  it("keeps notices between the turn activities observed before and after them", () => {
    const projection = new TurnProjection();
    projection.appendUserPrompt("test", []);
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({
      type: "message_start",
      message: { id: "a1", role: "assistant", timestamp: 1, content: [{ type: "thinking", thinking: "Inspect" }] },
    });
    projection.appendNotice("Retrying", "info", 2);
    projection.applyEvent({
      type: "message_update",
      message: {
        id: "a1",
        role: "assistant",
        timestamp: 1,
        content: [{ type: "thinking", thinking: "Inspect" }, { type: "text", text: "Done" }],
      },
      assistantMessageEvent: { type: "text_delta" },
    });

    expect(projection.snapshot().turns[0]?.activities.map((activity) => activity.type)).toEqual(["reasoning", "notice", "response"]);
    expect(projection.snapshot().notices).toEqual([]);
  });

  it("does not attach a new orphan run to the final historical turn", () => {
    const projection = new TurnProjection();
    projection.hydrate([{ role: "user", id: "u1", timestamp: 1, content: "old" }]);
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({ type: "message_end", message: { role: "assistant", timestamp: 2, stopReason: "stop", content: [{ type: "text", text: "new" }] } });

    expect(projection.snapshot().turns).toHaveLength(2);
    expect(projection.snapshot().turns[1]?.userMessage).toBeUndefined();
  });

  it("keeps a turn running through an intermediate assistant reply and tool execution", () => {
    const projection = new TurnProjection();
    projection.appendUserPrompt("inspect", []);
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({
      type: "message_end",
      message: {
        id: "tool-request",
        role: "assistant",
        timestamp: 1,
        stopReason: "tool_use",
        content: [{ type: "toolCall", id: "tool-1", name: "bash", arguments: { command: "git status" } }],
      },
    });
    projection.applyEvent({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "bash", args: { command: "git status" } });

    const runningTurn = projection.snapshot().turns[0];
    expect(runningTurn?.status).toBe("running");
    expect(runningTurn?.endedAt).toBeUndefined();
    expect(runningTurn?.activities[0]).toMatchObject({ type: "tool", tool: { status: "running" } });

    projection.applyEvent({ type: "agent_settled" });

    const settledTurn = projection.snapshot().turns[0];
    expect(settledTurn?.status).toBe("completed");
    expect(settledTurn?.endedAt).toEqual(expect.any(Number));
  });

  it("shows an assistant error with no content after the agent settles", () => {
    const projection = new TurnProjection();
    projection.appendUserPrompt("test", []);
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({
      type: "message_end",
      message: {
        role: "assistant",
        timestamp: 1,
        stopReason: "error",
        errorMessage: "Provided authentication token is expired.",
        content: [],
      },
    });
    projection.applyEvent({ type: "agent_settled" });

    expect(projection.snapshot().turns[0]).toMatchObject({
      status: "error",
      activities: [{ type: "response", status: "error", blocks: [{ type: "error", text: "Provided authentication token is expired." }] }],
    });
  });

  it("parks follow-ups outside the active turn until the next agent_start", () => {
    const projection = new TurnProjection();
    projection.appendUserPrompt("first", []);
    projection.applyEvent({ type: "agent_start" });
    projection.enqueueFollowUp("second", []);
    projection.enqueueFollowUp("third", []);

    expect(projection.snapshot().turns).toHaveLength(1);
    expect(projection.snapshot().queuedFollowUps.map((item) => item.text)).toEqual(["second", "third"]);

    projection.applyEvent({ type: "agent_settled" });
    projection.applyEvent({ type: "agent_start" });

    expect(projection.snapshot().turns.map((turn) => turn.userMessage?.blocks)).toEqual([
      [{ type: "text", text: "first" }],
      [{ type: "text", text: "second" }],
    ]);
    expect(projection.snapshot().turns[1]?.status).toBe("running");
    expect(projection.snapshot().queuedFollowUps.map((item) => item.text)).toEqual(["third"]);

    projection.applyEvent({ type: "agent_settled" });
    projection.applyEvent({ type: "agent_start" });
    expect(projection.snapshot().turns).toHaveLength(3);
    expect(projection.snapshot().queuedFollowUps).toEqual([]);
  });

  it("promotes queued follow-ups on user message_start within the same agent run", () => {
    const projection = new TurnProjection();
    projection.appendUserPrompt("first", []);
    projection.applyEvent({ type: "agent_start" });
    projection.applyEvent({
      type: "message_start",
      message: { id: "a1", role: "assistant", timestamp: 1, content: [{ type: "text", text: "answer A" }] },
    });
    projection.enqueueFollowUp("second", []);
    projection.enqueueFollowUp("third", []);

    // Pi drains follow-ups before agent_end without a new agent_start.
    projection.applyEvent({
      type: "message_start",
      message: { role: "user", timestamp: 2, content: [{ type: "text", text: "second" }] },
    });
    projection.applyEvent({
      type: "message_start",
      message: { id: "a2", role: "assistant", timestamp: 3, content: [{ type: "text", text: "answer B" }] },
    });

    expect(projection.snapshot().turns).toHaveLength(2);
    expect(projection.snapshot().turns[0]?.status).toBe("completed");
    expect(projection.snapshot().turns[1]?.userMessage?.blocks).toEqual([{ type: "text", text: "second" }]);
    expect(projection.snapshot().turns[1]?.activities.map((activity) => activity.type)).toEqual(["response"]);
    expect(projection.snapshot().queuedFollowUps.map((item) => item.text)).toEqual(["third"]);

    projection.applyEvent({
      type: "message_start",
      message: { role: "user", timestamp: 4, content: [{ type: "text", text: "third" }] },
    });
    expect(projection.snapshot().turns).toHaveLength(3);
    expect(projection.snapshot().queuedFollowUps).toEqual([]);
    expect(projection.snapshot().turns[2]?.userMessage?.blocks).toEqual([{ type: "text", text: "third" }]);
  });

  it("prefers promoting a queued follow-up over an idle-gap local turn", () => {
    const projection = new TurnProjection();
    projection.appendUserPrompt("first", []);
    projection.applyEvent({ type: "agent_start" });
    projection.enqueueFollowUp("queued", []);
    projection.applyEvent({ type: "agent_settled" });
    // Simulates a bug/race that inserts a normal turn while the queue is still pending.
    projection.appendUserPrompt("gap", []);

    projection.applyEvent({ type: "agent_start" });

    expect(projection.snapshot().turns.map((turn) => turn.userMessage?.blocks)).toEqual([
      [{ type: "text", text: "first" }],
      [{ type: "text", text: "queued" }],
    ]);
    expect(projection.snapshot().queuedFollowUps).toEqual([]);
    expect(projection.snapshot().turns[1]?.status).toBe("running");
  });

  it("removes a single queued follow-up and can clear the rest", () => {
    const projection = new TurnProjection();
    const first = projection.enqueueFollowUp("a", []);
    projection.enqueueFollowUp("b", []);
    expect(projection.removeQueuedFollowUp(first)).toBe(true);
    expect(projection.snapshot().queuedFollowUps.map((item) => item.text)).toEqual(["b"]);
    projection.clearQueuedFollowUps();
    expect(projection.snapshot().queuedFollowUps).toEqual([]);
  });

  it("can complete a local extension-command turn by id without touching a later turn", () => {
    const projection = new TurnProjection();
    const firstTurnId = projection.appendUserPrompt("/toggle-web-proxy on", []);
    projection.appendNotice("Proxy enabled", "info");
    expect(projection.snapshot().turns[0]?.status).toBe("running");
    expect(projection.snapshot().turns[0]?.activities).toEqual([
      expect.objectContaining({ type: "notice", text: "Proxy enabled" }),
    ]);

    const secondTurnId = projection.appendUserPrompt("follow-up", []);
    expect(projection.completeTurn(firstTurnId, "completed")).toBe(true);
    expect(projection.snapshot().turns[0]?.status).toBe("completed");
    expect(projection.snapshot().turns[0]?.endedAt).toEqual(expect.any(Number));
    expect(projection.snapshot().turns[1]?.id).toBe(secondTurnId);
    expect(projection.snapshot().turns[1]?.status).toBe("running");

    projection.appendNotice("Later status", "info");
    expect(projection.snapshot().turns[1]?.activities).toEqual([
      expect.objectContaining({ type: "notice", text: "Later status" }),
    ]);
    expect(projection.snapshot().notices).toEqual([]);
  });
});
