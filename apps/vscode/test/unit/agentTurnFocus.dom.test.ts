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

  it("folds a finished turn per run, with its replies visible, even when focus view is off", () => {
    const interim: AgentTurnItemView = { id: "r0", type: "response", blocks: [{ type: "text", text: "Interim note" }], status: "complete", timestamp: 0 };
    const done: AgentTurnItemView = { id: "r1", type: "response", blocks: [{ type: "text", text: "Visible reply" }], status: "complete", timestamp: 0 };
    const view = render(AgentTurn, {
      turn: turn([tool("t1", "read", "a.ts"), tool("t2", "bash", "ls"), interim, tool("t3", "read", "c.ts"), tool("t4", "edit", "c.ts"), done], "completed"),
      session: session(false),
    });
    expect(view.getAllByRole("button", { name: /^Expand 2 steps/ })).toHaveLength(2);
    expect(view.container.textContent).toContain("Interim note");
    expect(view.container.textContent).toContain("Visible reply");
    expect(view.container.querySelectorAll(".tool-activity-name")).toHaveLength(0);
  });

  it("keeps an opened reasoning row open when its run folds into a group", async () => {
    const thinking: AgentTurnItemView = { id: "think", type: "reasoning", text: "**Plan**\nRead the parser first", status: "streaming", timestamp: 0 };
    const view = render(AgentTurn, { turn: turn([thinking]), session: session(true) });
    // Collapsed, the row already says what the model is thinking about.
    expect(view.container.querySelector(".reasoning-preview")?.textContent).toBe("Read the parser first");
    await fireEvent.click(view.getByRole("button", { name: /Thinking/ }));

    const done = { ...thinking, status: "complete" as const };
    await view.rerender({ turn: turn([done, tool("t1", "read", "parser.ts", "running")]), session: session(true) });
    await fireEvent.click(view.getByRole("button", { name: /^Expand 2 steps/ }));

    expect(view.container.querySelector(".reasoning-content")?.textContent).toContain("Read the parser first");
  });
});
