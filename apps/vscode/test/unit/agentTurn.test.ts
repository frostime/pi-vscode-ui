import { render } from "svelte/server";
import { describe, expect, it } from "vitest";

import type { AgentTurnView } from "../../src/shared/model/conversationModel.js";
import AgentTurn from "../../src/webview/features/conversation/AgentTurn.svelte";

describe("AgentTurn timing", () => {
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
