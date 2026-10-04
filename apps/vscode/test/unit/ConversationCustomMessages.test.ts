import type { RpcSessionEntry } from "@frostime/pi-rpc";
import { describe, expect, it } from "vitest";

import { ConversationProjection } from "../../src/extension/conversation/ConversationProjection.js";
import type { AgentTurnItemView, CustomMessageView } from "../../src/shared/model/conversationModel.js";

const image = { type: "image", data: "AA==", mimeType: "image/png" };

describe("live custom messages", () => {
  it("displays mail during a running turn without consuming prompts or interrupting assistant deltas", () => {
    const projection = new ConversationProjection();
    projection.appendUserPrompt("Work", [], 1);
    projection.applyEvent({ type: "agent_start" });
    projection.enqueueSteer("User steering", [], 2);
    projection.enqueueFollowUp("User follow-up", [], 3);
    projection.applyEvent({ type: "message_start", message: { role: "assistant", content: [], timestamp: 4 } });
    projection.applyEvent({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
    projection.applyEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Before" } });
    const before = projection.read();

    deliverCustom(projection, "pi-mail", [{ type: "text", text: "New mail" }, image]);
    deliverCustom(projection, "internal", "Hidden", false);
    projection.applyEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: " after" } });

    expect(customMessages(projection)).toEqual([expect.objectContaining({
      customType: "pi-mail",
      blocks: [
        { type: "text", text: "New mail" },
        { type: "images", images: [expect.objectContaining({ dataUrl: "data:image/png;base64,AA==" })] },
      ],
    })]);
    expect(items(projection).filter((item) => item.type === "response")).toEqual([
      expect.objectContaining({ blocks: [{ type: "text", text: "Before after" }], status: "streaming" }),
    ]);
    expect(projection.read().items[0]).toMatchObject({ type: "turn", status: "running" });
    expect(projection.read().queuedSteers).toBe(before.queuedSteers);
    expect(projection.read().queuedFollowUps).toBe(before.queuedFollowUps);
    expect(projection.read().contentRevision).toBeGreaterThan(before.contentRevision);
    expect(customMessages({ read: () => before })).toEqual([]);
  });

  it("adopts custom messages FIFO, including hidden slots, despite different persisted timestamps and repeated content", () => {
    const projection = new ConversationProjection();
    const turnId = projection.appendUserPrompt("Work", [], 1);
    projection.applyEvent({ type: "message_start", message: { role: "user", content: "Work", timestamp: 1 } });
    deliverCustom(projection, "pi-mail", "Hidden", false);
    deliverCustom(projection, "pi-mail", "Repeat");
    deliverCustom(projection, "pi-mail", "Repeat");
    const liveIds = customMessages(projection).map((item) => item.id);
    projection.applyEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Done" }], timestamp: 6, stopReason: "stop" } });
    projection.applyEvent({ type: "agent_settled" });

    const entries = [
      entry("message", "u1", null, { message: { role: "user", content: "Work", timestamp: 1 } }),
      customEntry("hidden", "u1", "pi-mail", "Hidden", false, 100),
      customEntry("c1", "hidden", "pi-mail", "Persisted authority", true, 101),
      customEntry("c2", "c1", "pi-mail", "Repeat", true, 102),
      entry("message", "a1", "c2", { message: { role: "assistant", content: [{ type: "text", text: "Done" }], timestamp: 6, stopReason: "stop" } }),
    ];
    expect(projection.reconcileEntries(entries, [])).toBe("applied");
    expect(projection.read().items).toHaveLength(1);
    expect(projection.read().items[0]?.id).toBe(turnId);
    expect(customMessages(projection)).toEqual([
      expect.objectContaining({ id: liveIds[0], timestamp: 101, blocks: [{ type: "text", text: "Persisted authority" }] }),
      expect.objectContaining({ id: liveIds[1], timestamp: 102, blocks: [{ type: "text", text: "Repeat" }] }),
    ]);
    expect(items(projection).map((item) => item.type)).toEqual(["customMessage", "customMessage", "response"]);
    projection.reconcileEntries(entries, []);
    expect(customMessages(projection).map((item) => item.id)).toEqual(liveIds);
  });

  it("renders idle custom messages without inventing a user turn and omits hidden messages", () => {
    const projection = new ConversationProjection();
    deliverCustom(projection, "state", "Not displayed", false);
    expect(projection.read().items).toEqual([]);
    expect(projection.read().contentRevision).toBe(0);
    deliverCustom(projection, "pi-mail-nudge", "Unread mail");
    const liveId = customMessages(projection)[0]?.id;

    projection.reconcileEntries([
      customEntry("hidden", null, "state", "Not displayed", false),
      customEntry("nudge", "hidden", "pi-mail-nudge", "Unread mail"),
    ], []);
    expect(projection.read().items).toEqual([
      expect.objectContaining({ id: liveId, type: "customMessage", customType: "pi-mail-nudge" }),
    ]);
  });

  it("requests authoritative replacement on a FIFO type mismatch without mutating the visible projection", () => {
    const projection = new ConversationProjection();
    deliverCustom(projection, "pi-mail", "Provisional");
    const before = projection.read();
    const entries = [customEntry("c1", null, "another-extension", "Persisted")];

    expect(projection.reconcileEntries(entries, [])).toBe("reload");
    expect(projection.read()).toEqual(before);
    projection.replaceEntries(entries, []);
    deliverCustom(projection, "pi-mail", "New mail");
    const newLiveId = customMessages(projection)[1]?.id;
    projection.reconcileEntries([customEntry("c2", "c1", "pi-mail", "New mail")], []);
    expect(customMessages(projection).map((item) => item.id)).toEqual(["c1", newLiveId]);
  });

  it("rebuilds a new branch edge so its control precedes an adopted custom child", () => {
    const projection = new ConversationProjection();
    deliverCustom(projection, "pi-mail", "New branch");
    const before = projection.read();
    const entries = [customEntry("c1", null, "pi-mail", "New branch")];
    const edges = [{ branchPointId: null, activeChildEntryId: "c1", pathCount: 2 }];

    expect(projection.reconcileEntries(entries, edges)).toBe("reload");
    expect(projection.read()).toEqual(before);
    projection.replaceEntries(entries, edges);
    expect(projection.read().items.map((item) => item.type)).toEqual(["branchControl", "customMessage"]);
  });

  it("applies Host image limits before a live custom message enters the conversation", () => {
    const projection = new ConversationProjection(1, 12);
    expect(() => deliverCustom(projection, "pi-mail", [{ ...image, data: "AAAA" }])).toThrow("image limit");
    expect(projection.read().items).toEqual([]);
  });
});

function deliverCustom(projection: ConversationProjection, customType: string, content: unknown, display = true): void {
  const message = { role: "custom", customType, content, display, timestamp: 5 };
  projection.applyEvent({ type: "message_start", message });
  projection.applyEvent({ type: "message_end", message });
}

function items(projection: Pick<ConversationProjection, "read">): AgentTurnItemView[] {
  return projection.read().items.flatMap((item) => item.type === "turn" ? item.items : [item]);
}

function customMessages(projection: Pick<ConversationProjection, "read">): CustomMessageView[] {
  return items(projection).filter((item): item is CustomMessageView => item.type === "customMessage");
}

function customEntry(id: string, parentId: string | null, customType: string, content: string, display = true, timestamp = 100): RpcSessionEntry {
  return entry("custom_message", id, parentId, { customType, content, display, timestamp: new Date(timestamp).toISOString() });
}

function entry(type: string, id: string, parentId: string | null, fields: Record<string, unknown>): RpcSessionEntry {
  return { type, id, parentId, timestamp: new Date(1).toISOString(), ...fields };
}
