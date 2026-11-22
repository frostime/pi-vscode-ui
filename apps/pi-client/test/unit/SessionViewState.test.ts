import type { RpcSessionStats } from "@frostime/pi-rpc";
import { describe, expect, it } from "vitest";

import { ConversationProjection } from "../../src/core/conversation/ConversationProjection.js";
import { SessionViewState } from "../../src/core/sessions/SessionViewState.js";

const STATS: RpcSessionStats = {
  sessionId: "session",
  userMessages: 1,
  assistantMessages: 0,
  toolCalls: 0,
  toolResults: 0,
  totalMessages: 1,
  tokens: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, total: 10 },
  cost: 0,
};

describe("SessionViewState", () => {
  it("keeps stats refreshes separate from conversation content changes", () => {
    const conversation = new ConversationProjection();
    const session = new SessionViewState("session", "/workspace", "Session");
    const initialContentRevision = session.read(conversation.read()).conversationContentRevision;

    expect(session.updateStats(STATS)).toBe(true);
    expect(session.read(conversation.read()).conversationContentRevision).toBe(initialContentRevision);

    expect(session.updateStats(structuredClone(STATS))).toBe(false);

    conversation.appendNotice("Visible conversation update");
    expect(session.read(conversation.read()).conversationContentRevision).toBe(initialContentRevision + 1);
  });

  it("adopts Pi's session name from an info-change event", () => {
    const conversation = new ConversationProjection();
    const session = new SessionViewState("session", "/workspace", "New session");

    session.applyEvent({ type: "session_info_changed", name: "26-11-14T17:48_梳理backend" });

    expect(session.read(conversation.read()).title).toBe("26-11-14T17:48_梳理backend");
  });

  it("keeps the current title when Pi reports a cleared name", () => {
    const conversation = new ConversationProjection();
    const session = new SessionViewState("session", "/workspace", "Named session");

    session.applyEvent({ type: "session_info_changed" });

    expect(session.read(conversation.read()).title).toBe("Named session");
  });
});
