import { render } from "svelte/server";
import { describe, expect, it } from "vitest";

import { ConversationProjection } from "../../src/extension/conversation/ConversationProjection.js";
import type { AgentTurnView } from "../../src/shared/model/conversationModel.js";
import AgentTurn from "../../src/webview/features/conversation/AgentTurn.svelte";

describe("AgentTurn", () => {
  it("renders projected live mail while running, even with work-trace collapsing enabled", () => {
    const projection = new ConversationProjection();
    projection.applyEvent({ type: "message_start", message: { role: "assistant", content: [], timestamp: 1 } });
    const message = { role: "custom", customType: "pi-mail", display: true, content: "Live peer mail", timestamp: 2 };
    projection.applyEvent({ type: "message_start", message });
    projection.applyEvent({ type: "message_end", message });
    const turn = projection.read().items.find((item): item is AgentTurnView => item.type === "turn");
    if (!turn) throw new Error("Expected a live agent turn");

    const html = render(AgentTurn, { props: { turn, session: { collapseTurnTrace: true } as never } }).body;
    expect(turn.status).toBe("running");
    expect(html).toContain('aria-label="Expand custom message from pi-mail"');
    expect(html).toContain("Custom message");
  });

  it("shows live timing only while the turn is running", () => {
    expect(renderAgentTurn("running")).toContain("turn-timing");

    for (const status of ["completed", "aborted", "error"] as const) {
      expect(renderAgentTurn(status)).not.toContain("turn-timing");
    }
  });
});

function renderAgentTurn(status: AgentTurnView["status"]): string {
  const turn: AgentTurnView = {
    id: `turn-${status}`,
    type: "turn",
    items: [],
    status,
    startedAt: 0,
  };

  return render(AgentTurn, { props: { turn, session: {} as never } }).body;
}
