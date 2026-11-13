import { describe, expect, it } from "vitest";

import type { AgentTurnItemView, AgentTurnView } from "@frostime/pi-client/shared/model/conversationModel";
import { formatStepGroupLabel, formatTurnDuration, planTurnItems } from "$ui/features/conversation/collapseTurnTrace.js";

describe("planTurnItems for finished turns", () => {
  it("folds each run of steps, keeps every reply visible, and leaves structural markers outside", () => {
    const items = [
      tool("t1"), reasoning("think"), response("interim"),
      tool("t2"), branchControl("edge"), tool("t3"),
      reasoning("r2"), tool("t4"), response("final"),
    ];
    const plan = planTurnItems(turn("completed", items, 0, 62_000), true);

    expect(plan.mode).toBe("grouped");
    if (plan.mode !== "grouped") return;
    expect([...plan.groupsByFirstItemId.keys()]).toEqual(["t1", "t3"]);
    expect(plan.groupsByFirstItemId.get("t1")).toMatchObject({ steps: 2, active: false, detail: "bash, reasoning" });
    expect(plan.groupsByFirstItemId.get("t3")).toMatchObject({ steps: 3, detail: "bash ×2, reasoning" });
    // Replies between runs, a lone step and the branch control are never folded.
    for (const id of ["interim", "t2", "edge", "final"]) expect(plan.groupIdByItemId.has(id)).toBe(false);
  });

  it("applies to stopped and failed turns, and counts failed steps", () => {
    const plan = planTurnItems(turn("error", [tool("ok"), tool("bad", true), response("final")], 0, 4_200), true);
    expect(plan.mode).toBe("grouped");
    if (plan.mode !== "grouped") return;
    expect(plan.groupsByFirstItemId.get("ok")).toMatchObject({ steps: 2, errors: 1 });
    expect(planTurnItems(turn("aborted", [tool("t1"), tool("t2"), tool("t3")]), true).mode).toBe("grouped");
  });

  it("stays flat when both folds are off, or when no run has two steps", () => {
    expect(planTurnItems(turn("completed", [tool("t1"), tool("t2"), response("final")]), false)).toEqual({ mode: "flat" });
    expect(planTurnItems(turn("completed", [tool("t1"), response("r"), tool("t2")]), true)).toEqual({ mode: "flat" });
  });
});

describe("focus view", () => {
  it("folds each run of tools and reasoning while the turn is running and keeps replies in place", () => {
    const items = [
      reasoning("think-1"), tool("read-1", false, "read"), tool("read-2", false, "read"),
      response("interim"),
      tool("bash-1"), running("bash-2", "npm   test --watch"),
    ];
    const plan = planTurnItems(turn("running", items), true, true);

    expect(plan.mode).toBe("grouped");
    if (plan.mode !== "grouped") return;
    expect([...plan.groupsByFirstItemId.values()]).toEqual([
      { id: "think-1", steps: 3, errors: 0, active: false, detail: "reasoning, read ×2" },
      { id: "bash-1", steps: 2, errors: 0, active: true, detail: "bash npm test --watch" },
    ]);
    expect([...plan.groupIdByItemId]).toEqual([
      ["think-1", "think-1"], ["read-1", "think-1"], ["read-2", "think-1"], ["bash-1", "bash-1"], ["bash-2", "bash-1"],
    ]);
    expect(plan.groupIdByItemId.has("interim")).toBe(false);
  });

  it("keeps a group's identity while it grows so an opened group stays open", () => {
    const first = planTurnItems(turn("running", [tool("t1"), tool("t2")]), false, true);
    const later = planTurnItems(turn("running", [tool("t1"), tool("t2"), tool("t3"), reasoning("r1")]), false, true);
    if (first.mode !== "grouped" || later.mode !== "grouped") throw new Error("expected grouped plans");
    expect([...first.groupsByFirstItemId.keys()]).toEqual(["t1"]);
    expect([...later.groupsByFirstItemId.keys()]).toEqual(["t1"]);
    expect(later.groupsByFirstItemId.get("t1")).toMatchObject({ steps: 4, detail: "bash ×3, reasoning" });
  });

  it("leaves a lone step, notices and structural markers visible and outside any group", () => {
    const items = [tool("solo"), notice("retry", "info"), tool("a"), compaction("compact"), tool("b"), branchControl("edge"), tool("c"), tool("d")];
    const plan = planTurnItems(turn("running", items), true, true);
    if (plan.mode !== "grouped") throw new Error("expected a grouped plan");
    expect([...plan.groupIdByItemId.keys()]).toEqual(["c", "d"]);

    expect(planTurnItems(turn("running", [tool("solo"), response("r")]), true, true)).toEqual({ mode: "flat" });
  });

  it("reports what is running now, and failures, in the group summary", () => {
    const thinking: AgentTurnItemView = { id: "live", type: "reasoning", text: "", status: "streaming", timestamp: 0 };
    const preparing: AgentTurnItemView = { id: "prep", type: "tool", timestamp: 0, tool: { state: "preparing", rawArguments: "{", status: "running", isError: false, startedAt: 0 } };

    const live = planTurnItems(turn("running", [tool("bad", true), thinking]), false, true);
    if (live.mode !== "grouped") throw new Error("expected a grouped plan");
    const group = live.groupsByFirstItemId.get("bad")!;
    expect(group).toMatchObject({ active: true, errors: 1, detail: "Thinking" });
    expect(formatStepGroupLabel(group)).toBe("2 steps · 1 error");

    const prepared = planTurnItems(turn("running", [tool("ok"), preparing]), false, true);
    if (prepared.mode !== "grouped") throw new Error("expected a grouped plan");
    expect(prepared.groupsByFirstItemId.get("ok")).toMatchObject({ active: true, detail: "Preparing tool call" });

    // A stopped turn has nothing in progress even if a tool never reported its end.
    const stopped = planTurnItems(turn("aborted", [tool("ok"), running("stuck", "sleep")], 0, 1), false, true);
    if (stopped.mode !== "grouped") throw new Error("expected a grouped plan");
    expect(stopped.groupsByFirstItemId.get("ok")).toMatchObject({ active: false, detail: "bash ×2" });
  });

  it("summarizes many tool kinds without growing past the row", () => {
    const items = ["read", "grep", "bash", "edit", "write", "ls"].map((name) => tool(name, false, name));
    const plan = planTurnItems(turn("completed", items, 0, 1), false, true);
    if (plan.mode !== "grouped") throw new Error("expected a grouped plan");
    expect(plan.groupsByFirstItemId.get("read")?.detail).toBe("read, grep, bash, edit, +2 more");
  });

  it("is the only fold of a running turn, and is off unless requested", () => {
    const items = [tool("t1"), tool("t2"), response("final")];
    expect(planTurnItems(turn("completed", items, 0, 1_000), true, true).mode).toBe("grouped");
    expect(planTurnItems(turn("completed", items, 0, 1_000), false, true).mode).toBe("grouped");
    expect(planTurnItems(turn("running", items), true, false)).toEqual({ mode: "flat" });
    expect(planTurnItems(turn("running", items), true)).toEqual({ mode: "flat" });
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
