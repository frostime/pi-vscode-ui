import type { RpcSessionEntry } from "@frostime/pi-rpc";
import { describe, expect, it } from "vitest";

import { ConversationProjection } from "../../src/extension/conversation/ConversationProjection.js";
import { OmpPromptCompatibility } from "../../src/extension/sessions/OmpPromptCompatibility.js";
import type { AgentTurnView } from "../../src/shared/model/conversationModel.js";

const commands = [
  { name: "review", source: "prompt", runtimeSource: "file" as const },
  { name: "skill:testing", source: "skill", runtimeSource: "skill" as const },
];

describe("OMP prompt product compatibility", () => {
  it("admits discovered text commands and skills but rejects unknown invocations and skill images", () => {
    const compatibility = new OmpPromptCompatibility();
    expect(() => compatibility.assertSupported("/review auth", 1, commands)).not.toThrow();
    expect(() => compatibility.assertSupported("/skill:testing auth", 0, commands)).not.toThrow();
    expect(() => compatibility.assertSupported("plain text", 1, commands)).not.toThrow();
    expect(() => compatibility.assertSupported("/ui", 0, commands)).toThrow("not supported");
    expect(() => compatibility.assertSupported("/unlisted-template", 0, commands)).toThrow("not supported");
    expect(() => compatibility.assertSupported("/skill:testing", 1, commands)).toThrow("image attachments");
  });

  it("keeps the original skill invocation through live reconciliation and history replacement", () => {
    const compatibility = new OmpPromptCompatibility();
    const projection = new ConversationProjection();
    const invocation = "/skill:testing focus on auth";
    const turnId = projection.appendUserPrompt(invocation, [], 1);
    projection.applyEvent(compatibility.projectEvent({ type: "message_start", message: skillMessage(invocation) }));
    const persisted = skillEntry("s1", null, invocation);
    projection.applyEvent(compatibility.projectEvent({ type: "entry_appended", entry: persisted }));
    expect(projection.reconcileEntries(compatibility.projectEntries([persisted]), [])).toBe("applied");
    expect(turns(projection)[0]?.items).toEqual([]);
    expect(turns(projection)).toHaveLength(1);
    expect(turns(projection)[0]).toMatchObject({ id: turnId, userMessage: { sourceEntryId: "s1", blocks: [{ type: "text", text: invocation }] } });

    projection.replaceEntries(compatibility.projectEntries([persisted]), []);
    expect(turns(projection)).toHaveLength(1);
    expect(projection.userMessage("s1")?.blocks).toEqual([{ type: "text", text: invocation }]);
    expect(persisted.type).toBe("custom_message");
    expect(persisted.content).toBe("Expanded instructions should not appear in the UI");
  });

  it("promotes queued skills with ordinary Steer-before-Queue delivery and FIFO persisted identity", () => {
    const compatibility = new OmpPromptCompatibility();
    const projection = new ConversationProjection();
    projection.appendUserPrompt("running", [], 1);
    projection.applyEvent({ type: "message_start", message: { role: "user", timestamp: 1 } });
    projection.enqueueFollowUp("/skill:testing later", [], 3);
    projection.enqueueSteer("/skill:testing now", [], 2);
    projection.applyEvent(compatibility.projectEvent({ type: "message_start", message: skillMessage("/skill:testing now", 2) }));
    expect(projection.read().queuedSteers).toEqual([]);
    expect(projection.read().queuedFollowUps.map((prompt) => prompt.text)).toEqual(["/skill:testing later"]);
    projection.applyEvent(compatibility.projectEvent({ type: "message_start", message: skillMessage("/skill:testing later", 3) }));
    expect(projection.read().queuedFollowUps).toEqual([]);
    projection.reconcileEntries(compatibility.projectEntries([
      { type: "message", id: "u1", parentId: null, timestamp: new Date(1).toISOString(), message: { role: "user", content: "running", timestamp: 1 } },
      skillEntry("s1", "u1", "/skill:testing now", 2),
      skillEntry("s2", "s1", "/skill:testing later", 3),
    ]), []);
    expect(turns(projection).map((turn) => turn.userMessage?.sourceEntryId)).toEqual(["u1", "s1", "s2"]);
    expect(turns(projection).map((turn) => turn.userMessage?.blocks)).toEqual([
      [{ type: "text", text: "running" }],
      [{ type: "text", text: "/skill:testing now" }],
      [{ type: "text", text: "/skill:testing later" }],
    ]);
  });

  it("does not reinterpret generic custom messages or agent-autoloaded skill content", () => {
    const compatibility = new OmpPromptCompatibility();
    const generic = { ...skillEntry("custom", null, "/skill:testing"), customType: "extension-note" };
    const autoload = { ...skillEntry("autoload", null, "/skill:testing"), attribution: "agent" };
    const projection = new ConversationProjection();
    projection.replaceEntries(compatibility.projectEntries([generic, autoload]), []);
    expect(turns(projection)).toEqual([]);
    expect(projection.read().items.map((item) => item.type)).toEqual(["customMessage", "customMessage"]);
    expect(compatibility.projectEntry(generic)).toBe(generic);
    expect(compatibility.projectEntry(autoload)).toBe(autoload);
  });

  it("correlates pre-admission failures independently of other queued work and ignores duplicate results", () => {
    const compatibility = new OmpPromptCompatibility();
    compatibility.track("req_1", { turnId: "turn-1" });
    compatibility.track("req_2", { queuedId: "queued-2" });
    const result = { type: "prompt_result", id: "req_2", agentInvoked: false, status: "error", sessionSettled: false, error: { message: "Skill disappeared" } };
    expect(compatibility.takeResult(result)).toEqual({ target: { queuedId: "queued-2" }, agentInvoked: false, status: "error", sessionSettled: false, error: "Skill disappeared" });
    expect(compatibility.takeResult(result)).toBeUndefined();
    expect(compatibility.takeResult({ type: "prompt_result", id: "req_1", agentInvoked: true, status: "completed", sessionSettled: true }))
      .toMatchObject({ target: { turnId: "turn-1" }, sessionSettled: true });
  });
});

function skillMessage(prompt: string, timestamp = 1) {
  return {
    role: "custom", customType: "skill-prompt", attribution: "user", display: true,
    content: "Expanded instructions should not appear in the UI", timestamp,
    details: { name: "testing", args: "focus on auth", prompt },
  };
}

function skillEntry(id: string, parentId: string | null, prompt: string, timestamp = 1): RpcSessionEntry {
  const message: Record<string, unknown> = skillMessage(prompt, timestamp);
  delete message.role;
  return { ...message, type: "custom_message", id, parentId, timestamp: new Date(timestamp).toISOString() };
}

function turns(projection: ConversationProjection): AgentTurnView[] {
  return projection.read().items.filter((item): item is AgentTurnView => item.type === "turn");
}
