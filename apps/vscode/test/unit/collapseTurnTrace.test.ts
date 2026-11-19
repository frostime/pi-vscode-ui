import { describe, expect, it } from "vitest";

import type { AgentTurnItemView, AgentTurnView } from "@frostime/pi-client/shared/model/conversationModel";
import { formatStepGroupLabel, formatTurnDuration, planTurnItems, type TurnItemPlan } from "$ui/features/conversation/collapseTurnTrace.js";

const FLAT: TurnItemPlan = { trace: null, groups: null };

describe("a finished turn with collapseTurnTrace", () => {
  it("collapses its work above the final reply without moving a branch control inside the trace", () => {
    const items = [tool("t1"), branchControl("edge"), reasoning("think"), response("final")];
    const plan = planTurnItems(turn("completed", items, 1_000, 62_000), true);

    expect(plan.trace).toMatchObject({
      stateLabel: "Worked",
      firstCollapsedItemId: "t1",
      anchorItemId: "final",
      anchorLabel: "Reply",
      summary: { steps: 2, errors: 0, durationLabel: "1m 01s" },
    });
    expect([...plan.trace!.collapsedItemIds]).toEqual(["t1", "think"]);
    expect(plan.trace!.collapsedItemIds.has("edge")).toBe(false);
  });

  it("folds interim replies into the trace, since only the last reply answers the user", () => {
    const items = [tool("t1"), reasoning("r1"), response("interim"), tool("t2"), tool("t3"), response("final")];
    const plan = planTurnItems(turn("completed", items, 0, 1_000), true);

    expect([...plan.trace!.collapsedItemIds]).toEqual(["t1", "r1", "interim", "t2", "t3"]);
    expect(plan.trace).toMatchObject({ anchorItemId: "final", summary: { steps: 5 } });
    // Opened, the trace still folds each run of steps and shows the interim reply between them.
    expect([...plan.groups!.groupsByFirstItemId.keys()]).toEqual(["t1", "t2"]);
    expect(plan.groups!.groupsByFirstItemId.get("t1")).toMatchObject({ steps: 2, active: false, detail: "bash, reasoning" });
    expect(plan.groups!.groupIdByItemId.has("interim")).toBe(false);
    expect(plan.groups!.groupIdByItemId.has("final")).toBe(false);
  });

  it("does not repeat the trace as a group when it holds a single run of steps", () => {
    const plan = planTurnItems(turn("completed", [tool("t1"), reasoning("r1"), tool("t2"), response("final")]), true, true);
    expect(plan.trace).not.toBeNull();
    expect(plan.groups).toBeNull();
  });

  it("anchors interrupted turns without a response on the last activity", () => {
    const plan = planTurnItems(turn("aborted", [tool("t1"), tool("t2"), tool("t3")], 0, 5_000), true);

    expect(plan.trace).toMatchObject({
      stateLabel: "Stopped",
      anchorItemId: "t3",
      anchorLabel: "Last step",
      summary: { steps: 2, errors: 0, durationLabel: "5s" },
    });
  });

  it("counts failed tools in the collapsed trace summary", () => {
    const plan = planTurnItems(turn("error", [tool("ok"), tool("bad", true), response("final")], 0, 4_200), true);
    expect(plan.trace?.summary).toMatchObject({ steps: 2, errors: 1 });
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

    expect(plan.trace).toMatchObject({
      stateLabel: "Worked",
      anchorItemId: "final",
      summary: { steps: 3, errors: 2, durationLabel: "2s" },
    });
    expect([...plan.trace!.collapsedItemIds]).toEqual(["partial", "provider-error", "retry"]);
    expect(plan.trace!.collapsedItemIds.has("compact")).toBe(false);
  });

  it("stays flat when collapse is disabled or no activity precedes the anchor", () => {
    expect(planTurnItems(turn("completed", [response("final")]), true)).toEqual(FLAT);
    expect(planTurnItems(turn("completed", [tool("t1"), response("final")]), false)).toEqual(FLAT);
    // The running-turn setting does not reach a finished turn.
    expect(planTurnItems(turn("completed", [tool("t1"), tool("t2"), response("final")]), false, true)).toEqual(FLAT);
  });
});

describe("a running turn with collapseRunningTurnTrace (Focus View)", () => {
  it("folds each run of tools and reasoning and keeps replies in place", () => {
    const items = [
      reasoning("think-1"), tool("read-1", false, "read"), tool("read-2", false, "read"),
      response("interim"),
      tool("bash-1"), running("bash-2", "npm   test --watch"),
    ];
    const plan = planTurnItems(turn("running", items), true, true);

    expect(plan.trace).toBeNull();
    expect([...plan.groups!.groupsByFirstItemId.values()]).toEqual([
      { id: "think-1", steps: 3, errors: 0, active: false, detail: "reasoning, read ×2" },
      { id: "bash-1", steps: 2, errors: 0, active: true, detail: "bash npm test --watch" },
    ]);
    expect([...plan.groups!.groupIdByItemId]).toEqual([
      ["think-1", "think-1"], ["read-1", "think-1"], ["read-2", "think-1"], ["bash-1", "bash-1"], ["bash-2", "bash-1"],
    ]);
    expect(plan.groups!.groupIdByItemId.has("interim")).toBe(false);
  });

  it("keeps a group's identity while it grows so an opened group stays open", () => {
    const first = planTurnItems(turn("running", [tool("t1"), tool("t2")]), false, true);
    const later = planTurnItems(turn("running", [tool("t1"), tool("t2"), tool("t3"), reasoning("r1")]), false, true);
    expect([...first.groups!.groupsByFirstItemId.keys()]).toEqual(["t1"]);
    expect([...later.groups!.groupsByFirstItemId.keys()]).toEqual(["t1"]);
    expect(later.groups!.groupsByFirstItemId.get("t1")).toMatchObject({ steps: 4, detail: "bash ×3, reasoning" });
  });

  it("leaves a lone step, notices and structural markers visible and outside any group", () => {
    const items = [tool("solo"), notice("retry", "info"), tool("a"), compaction("compact"), tool("b"), branchControl("edge"), tool("c"), tool("d")];
    const plan = planTurnItems(turn("running", items), true, true);
    expect([...plan.groups!.groupIdByItemId.keys()]).toEqual(["c", "d"]);

    expect(planTurnItems(turn("running", [tool("solo"), response("r")]), true, true)).toEqual(FLAT);
  });

  it("reports what is running now, and failures, in the group summary", () => {
    const thinking: AgentTurnItemView = { id: "live", type: "reasoning", text: "", status: "streaming", timestamp: 0 };
    const preparing: AgentTurnItemView = { id: "prep", type: "tool", timestamp: 0, tool: { state: "preparing", rawArguments: "{", status: "running", isError: false, startedAt: 0 } };

    const live = planTurnItems(turn("running", [tool("bad", true), thinking]), false, true);
    const group = live.groups!.groupsByFirstItemId.get("bad")!;
    expect(group).toMatchObject({ active: true, errors: 1, detail: "Thinking" });
    expect(formatStepGroupLabel(group)).toBe("2 steps · 1 error");

    const prepared = planTurnItems(turn("running", [tool("ok"), preparing]), false, true);
    expect(prepared.groups!.groupsByFirstItemId.get("ok")).toMatchObject({ active: true, detail: "Preparing tool call" });

    // Inside a stopped turn's trace nothing is in progress, even if a tool never reported its end.
    const stopped = planTurnItems(turn("aborted", [tool("ok"), running("stuck", "sleep"), response("partial"), tool("x"), tool("y"), response("end")], 0, 1), true);
    expect(stopped.groups!.groupsByFirstItemId.get("ok")).toMatchObject({ active: false, detail: "bash ×2" });
  });

  it("summarizes many tool kinds without growing past the row", () => {
    const items = ["read", "grep", "bash", "edit", "write", "ls"].map((name) => tool(name, false, name));
    const plan = planTurnItems(turn("running", items), false, true);
    expect(plan.groups!.groupsByFirstItemId.get("read")?.detail).toBe("read, grep, bash, edit, +2 more");
  });

  it("is off unless requested, whatever collapseTurnTrace says", () => {
    const items = [tool("t1"), tool("t2"), response("final")];
    expect(planTurnItems(turn("running", items), true, false)).toEqual(FLAT);
    expect(planTurnItems(turn("running", items), true)).toEqual(FLAT);
  });
});

describe("trace timestamps", () => {
  it("skips a duration it cannot measure", () => {
    expect(formatTurnDuration(0)).toBeNull();
    expect(formatTurnDuration(1_000, 500)).toBeNull();
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

function running(id: string, label: string): AgentTurnItemView {
  return {
    id,
    type: "tool",
    timestamp: 0,
    tool: { state: "bound", id, name: "bash", args: {}, label, status: "running", isError: false, startedAt: 0 },
  };
}

function tool(id: string, isError = false, name = "bash"): AgentTurnItemView {
  return {
    id,
    type: "tool",
    timestamp: 0,
    tool: {
      state: "bound",
      id,
      name,
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

function branchControl(id: string): AgentTurnItemView {
  return {
    id,
    type: "branchControl",
    branchPointId: "parent",
    activeChildEntryId: "child",
    pathCount: 2,
  };
}

function notice(id: string, level: "info" | "error"): AgentTurnItemView {
  return { id, type: "notice", text: id, level, timestamp: 0 };
}

function compaction(id: string): AgentTurnItemView {
  return { id, type: "compaction", summary: id, tokensBefore: 100, timestamp: 0 };
}
