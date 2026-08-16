import type { RpcSessionStats } from "@frostime/pi-rpc";
import { describe, expect, it } from "vitest";

import { ConversationProjection } from "../../src/extension/conversation/ConversationProjection.js";
import { SessionViewState } from "../../src/extension/sessions/SessionViewState.js";

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
    const session = new SessionViewState("session", "/workspace", "Session", undefined, 1);
    const initialContentRevision = session.read(conversation.read()).conversationContentRevision;

    expect(session.updateStats(STATS)).toBe(true);
    const firstStatsChangeAt = session.lastViewStateChangeAt;
    expect(session.read(conversation.read()).conversationContentRevision).toBe(initialContentRevision);

    expect(session.updateStats(structuredClone(STATS))).toBe(false);
    expect(session.lastViewStateChangeAt).toBe(firstStatsChangeAt);

    conversation.appendNotice("Visible conversation update");
    expect(session.read(conversation.read()).conversationContentRevision).toBe(initialContentRevision + 1);
  });
});
