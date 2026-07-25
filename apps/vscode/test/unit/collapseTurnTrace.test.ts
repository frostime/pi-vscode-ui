import { describe, expect, it } from "vitest";

import type { AgentActivityView, AgentTurnView } from "../../src/shared/model/agentTurnModel.js";
import {
  formatTraceSummaryLabel,
  formatTurnDuration,
  planTurnActivities,
  turnStateLabel,
} from "../../src/webview/features/conversation/collapseTurnTrace.js";

describe("planTurnActivities", () => {
  it("keeps a running turn flat so live tool rows stay visible", () => {
    const turn = makeTurn("running", [tool("t1"), response("r1")]);
    expect(planTurnActivities(turn, true)).toEqual({ mode: "flat", activities: turn.activities });
  });

  it("collapses everything before the final response on completed turns", () => {
    const activities = [tool("t1"), reasoning("think"), response("mid"), tool("t2"), response("final")];
    const turn = makeTurn("completed", activities, 1_000, 62_000);
    expect(planTurnActivities(turn, true)).toEqual({
      mode: "collapsed",
      stateLabel: "Worked",
      collapsed: activities.slice(0, 4),
      visible: [activities[4]],
      summary: { steps: 4, errors: 0, durationLabel: "1m 01s" },
    });
  });

  it("collapses aborted turns under a Stopped header", () => {
    const activities = [tool("t1"), tool("t2"), response("partial")];
    const turn = makeTurn("aborted", activities, 0, 5_000);
    expect(planTurnActivities(turn, true)).toEqual({
      mode: "collapsed",
      stateLabel: "Stopped",
      collapsed: activities.slice(0, 2),
      visible: [activities[2]],
      summary: { steps: 2, errors: 0, durationLabel: "5s" },
    });
  });

  it("collapses aborted turns with no final response by anchoring on the last tool", () => {
    const activities = [tool("t1"), tool("t2"), tool("t3")];
    const turn = makeTurn("aborted", activities, 0, 5_000);
    expect(planTurnActivities(turn, true)).toEqual({
      mode: "collapsed",
      stateLabel: "Stopped",
      collapsed: activities.slice(0, 2),
      visible: [activities[2]],
      summary: { steps: 2, errors: 0, durationLabel: "5s" },
    });
  });

  it("collapses error turns under a Failed header and still counts tool errors", () => {
    const activities = [tool("ok"), tool("bad", true), response("final")];
    const turn = makeTurn("error", activities, 0, 4_200);
    const plan = planTurnActivities(turn, true);
    expect(plan.mode).toBe("collapsed");
    if (plan.mode !== "collapsed") return;
    expect(plan.stateLabel).toBe("Failed");
    expect(plan.summary).toEqual({ steps: 2, errors: 1, durationLabel: "4s" });
    expect(formatTraceSummaryLabel(plan.summary)).toBe("2 steps · 1 error · 4s");
  });

  it("stays flat when collapse is disabled or there is nothing before the final response", () => {
    const onlyFinal = makeTurn("completed", [response("final")]);
    expect(planTurnActivities(onlyFinal, true).mode).toBe("flat");
    expect(planTurnActivities(makeTurn("completed", [tool("t1"), response("r1")]), false).mode).toBe("flat");
    expect(planTurnActivities(makeTurn("completed", [tool("t1")]), true).mode).toBe("flat");
    expect(planTurnActivities(makeTurn("aborted", [tool("t1")]), true).mode).toBe("flat");
  });
});

describe("turnStateLabel", () => {
  it("maps turn status to a header label", () => {
    expect(turnStateLabel("completed")).toBe("Worked");
    expect(turnStateLabel("aborted")).toBe("Stopped");
    expect(turnStateLabel("error")).toBe("Failed");
    expect(turnStateLabel("running")).toBe("Worked");
  });
});

describe("formatTurnDuration", () => {
  it("formats whole-turn durations for the summary row", () => {
    expect(formatTurnDuration(0, 400)).toBe("<1s");
    expect(formatTurnDuration(0, 45_000)).toBe("45s");
    expect(formatTurnDuration(0, 65_000)).toBe("1m 05s");
    expect(formatTurnDuration(0, 3_600_000)).toBe("1h");
    expect(formatTurnDuration(0)).toBeNull();
  });
});

function makeTurn(
  status: AgentTurnView["status"],
  activities: AgentActivityView[],
  startedAt = 0,
  endedAt?: number,
): Pick<AgentTurnView, "status" | "activities" | "startedAt" | "endedAt"> {
  return {
    status,
    activities,
    startedAt,
    ...(endedAt === undefined ? {} : { endedAt }),
  };
}

function tool(id: string, isError = false): AgentActivityView {
  return {
    id,
    type: "tool",
    timestamp: 0,
    tool: {
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

function reasoning(id: string): AgentActivityView {
  return { id, type: "reasoning", text: "…", status: "complete", timestamp: 0 };
}

function response(id: string): AgentActivityView {
  return { id, type: "response", blocks: [{ type: "text", text: id }], status: "complete", timestamp: 0 };
}
