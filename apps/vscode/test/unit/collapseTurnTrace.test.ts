import { describe, expect, it } from "vitest";

import type { AgentTurnItemView, AgentTurnView } from "../../src/shared/model/conversationModel.js";
import {
  formatTraceSummaryLabel,
  formatTurnDuration,
  planTurnItems,
  turnStateLabel,
} from "../../src/webview/features/conversation/collapseTurnTrace.js";

describe("planTurnItems", () => {
  it("keeps running turns flat so live tools remain visible", () => {
    expect(planTurnItems(turn("running", [tool("t1"), response("r1")]), true)).toEqual({ mode: "flat" });
  });

  it("collapses completed activities without moving a branch control inside the trace", () => {
    const items = [tool("t1"), branchControl("edge"), reasoning("think"), response("final")];
    const plan = planTurnItems(turn("completed", items, 1_000, 62_000), true);

    expect(plan).toMatchObject({
      mode: "collapsed",
      stateLabel: "Worked",
      firstCollapsedItemId: "t1",
      anchorItemId: "final",
      anchorLabel: "Reply",
      summary: { steps: 2, errors: 0, durationLabel: "1m 01s" },
    });
    if (plan.mode !== "collapsed") return;
    expect([...plan.collapsedItemIds]).toEqual(["t1", "think"]);
    expect(plan.collapsedItemIds.has("edge")).toBe(false);
  });

  it("anchors interrupted turns without a response on the last activity", () => {
    const plan = planTurnItems(turn("aborted", [tool("t1"), tool("t2"), tool("t3")], 0, 5_000), true);

    expect(plan).toMatchObject({
      mode: "collapsed",
      stateLabel: "Stopped",
      anchorItemId: "t3",
      anchorLabel: "Last step",
      summary: { steps: 2, errors: 0, durationLabel: "5s" },
    });
  });

  it("counts failed tools in the collapsed trace summary", () => {
    const plan = planTurnItems(turn("error", [tool("ok"), tool("bad", true), response("final")], 0, 4_200), true);
    expect(plan.mode).toBe("collapsed");
    if (plan.mode !== "collapsed") return;
    expect(plan.stateLabel).toBe("Failed");
    expect(formatTraceSummaryLabel(plan.summary)).toBe("2 steps · 1 error · 4s");
  });

  it("folds turn-wide retry work while leaving an intervening structural boundary visible", () => {
    const items = [
      response("partial", "error"),
      notice("provider-error", "error"),
      compaction("compact"),
      notice("retry", "info"),
      response("final"),
    ];
    const plan = planTurnItems(turn("completed", items, 0, 2_000), true);

    expect(plan).toMatchObject({
      mode: "collapsed",
      stateLabel: "Worked",
      anchorItemId: "final",
      summary: { steps: 3, errors: 2, durationLabel: "2s" },
    });
    if (plan.mode !== "collapsed") return;
    expect([...plan.collapsedItemIds]).toEqual(["partial", "provider-error", "retry"]);
    expect(plan.collapsedItemIds.has("compact")).toBe(false);
  });

  it("stays flat when collapse is disabled or no activity precedes the anchor", () => {
    expect(planTurnItems(turn("completed", [response("final")]), true)).toEqual({ mode: "flat" });
    expect(planTurnItems(turn("completed", [tool("t1"), response("final")]), false)).toEqual({ mode: "flat" });
  });
});

describe("trace labels", () => {
  it("maps statuses and formats durations", () => {
    expect(turnStateLabel("completed")).toBe("Worked");
    expect(turnStateLabel("aborted")).toBe("Stopped");
    expect(turnStateLabel("error")).toBe("Failed");
    expect(formatTurnDuration(0, 400)).toBe("<1s");
    expect(formatTurnDuration(0, 65_000)).toBe("1m 05s");
    expect(formatTurnDuration(0, 3_600_000)).toBe("1h");
    expect(formatTurnDuration(0)).toBeNull();
  });
});

function turn(
  status: AgentTurnView["status"],
  items: AgentTurnItemView[],
  startedAt = 0,
  endedAt?: number,
): Pick<AgentTurnView, "status" | "items" | "startedAt" | "endedAt"> {
  return { status, items, startedAt, ...(endedAt === undefined ? {} : { endedAt }) };
}

function tool(id: string, isError = false): AgentTurnItemView {
  return {
    id,
    type: "tool",
    timestamp: 0,
    tool: {
      state: "bound",
      id,
      name: "bash",
      args: {},
      label: id,
      status: isError ? "error" : "complete",
      isError,
      startedAt: 0,
    },
  };
}

function reasoning(id: string): AgentTurnItemView {
  return { id, type: "reasoning", text: "thinking", status: "complete", timestamp: 0 };
}

function response(id: string, status: "complete" | "error" = "complete"): AgentTurnItemView {
  return { id, type: "response", blocks: [{ type: "text", text: id }], status, timestamp: 0 };
}

function notice(id: string, level: "info" | "error"): AgentTurnItemView {
  return { id, type: "notice", text: id, level, timestamp: 0 };
}

function compaction(id: string): AgentTurnItemView {
  return { id, type: "compaction", summary: id, tokensBefore: 100, timestamp: 0 };
}

function branchControl(id: string): AgentTurnItemView {
  return {
    id,
    type: "branchControl",
    branchPointId: "parent",
    activeChildEntryId: "child",
    pathCount: 2,
  };
}
