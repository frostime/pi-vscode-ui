import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";

import type { AgentTurnItemView, AgentTurnView } from "$shared/model/conversationModel";
import AgentTurn from "$ui/features/conversation/AgentTurn.svelte";

afterEach(cleanup);

function tool(id: string, name: string, label: string, status: "complete" | "running" = "complete"): AgentTurnItemView {
  return { id, type: "tool", timestamp: 0, tool: { state: "bound", id, name, args: {}, label, status, isError: false, startedAt: 0 } };
}

function turn(items: AgentTurnItemView[], status: AgentTurnView["status"] = "running"): AgentTurnView {
  return { id: "turn-focus", type: "turn", status, startedAt: 0, ...(status === "running" ? {} : { endedAt: 5_000 }), items };
}

function session(focusView: boolean, collapseTurnTrace = true) {
  return { id: "session", collapseTurnTrace, focusView } as never;
}

const reply: AgentTurnItemView = { id: "r1", type: "response", blocks: [{ type: "text", text: "Visible reply" }], status: "streaming", timestamp: 0 };

describe("focus view", () => {
  it("folds a running turn's tool run into one row and keeps the reply readable", async () => {
    const view = render(AgentTurn, {
      turn: turn([tool("t1", "read", "a.ts"), tool("t2", "bash", "npm test", "running"), reply]),
      session: session(true),
    });

    const group = view.getByRole("button", { name: "Expand 2 steps: bash npm test" });
    expect(group.getAttribute("aria-expanded")).toBe("false");
    expect(view.container.querySelectorAll(".tool-activity-name")).toHaveLength(0);
    expect(view.getByRole("status", { name: "In progress" })).toBeTruthy();
    expect(view.container.textContent).toContain("Visible reply");

    await fireEvent.click(group);
    expect(view.getByRole("button", { name: "Collapse 2 steps: bash npm test" }).getAttribute("aria-expanded")).toBe("true");
    expect([...view.container.querySelectorAll(".tool-activity-name")].map((node) => node.textContent)).toEqual(["read", "bash"]);
  });

  it("keeps a group the reader opened open while more steps arrive", async () => {
    const view = render(AgentTurn, { turn: turn([tool("t1", "read", "a.ts"), tool("t2", "read", "b.ts")]), session: session(true) });
    await fireEvent.click(view.getByRole("button", { name: /^Expand 2 steps/ }));

    await view.rerender({ turn: turn([tool("t1", "read", "a.ts"), tool("t2", "read", "b.ts"), tool("t3", "bash", "ls", "running")]), session: session(true) });

    expect(view.getByRole("button", { name: /^Collapse 3 steps/ })).toBeTruthy();
    expect(view.container.querySelectorAll(".tool-activity-name")).toHaveLength(3);
  });

  it("shows every step as its own row when focus view is off", () => {
    const view = render(AgentTurn, {
      turn: turn([tool("t1", "read", "a.ts"), tool("t2", "bash", "npm test", "running"), reply]),
      session: session(false),
    });
    expect(view.container.querySelector(".turn-step-group")).toBeNull();
    expect(view.container.querySelectorAll(".tool-activity-name")).toHaveLength(2);
  });

  it("hands a finished turn to the single completed-turn summary", () => {
    const done: AgentTurnItemView = { id: "r1", type: "response", blocks: [{ type: "text", text: "Visible reply" }], status: "complete", timestamp: 0 };
    const view = render(AgentTurn, { turn: turn([tool("t1", "read", "a.ts"), tool("t2", "bash", "ls"), done], "completed"), session: session(true) });
    expect(view.getByRole("button", { name: "Expand work trace: 2 steps · 5s" })).toBeTruthy();
    expect(view.container.querySelector(".turn-step-group")).toBeNull();
  });
});
