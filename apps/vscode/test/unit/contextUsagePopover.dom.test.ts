import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import ContextUsagePopover from "$ui/features/usage/ContextUsagePopover.svelte";

function session(percent: number | null) {
  return {
    status: "idle", isCompacting: false,
    stats: {
      cost: 0.035, contextUsage: { percent, tokens: 500, contextWindow: 10_000 },
      tokens: { input: 400, output: 100, cacheRead: 0, cacheWrite: 0, total: 500 },
      userMessages: 1, assistantMessages: 1, toolCalls: 0,
    },
  } as never;
}

afterEach(() => cleanup());

describe("context metrics trigger", () => {
  it("uses a ring and label without duplicating the number, keeping exact readings in the accessible name and popover", async () => {
    const view = render(ContextUsagePopover, { session: session(5) });
    const trigger = view.getByRole("button", { name: "Context usage: 5%" });
    expect(trigger.textContent?.trim()).toBe("Context");
    expect(trigger.querySelector(".context-ring-progress")?.getAttribute("stroke-dasharray")).toBe("5 100");
    expect(view.queryByText("$0.035")).toBeNull();
    await fireEvent.focus(trigger);
    expect(view.getByRole("dialog", { name: "Context and session usage" })).not.toBeNull();
    expect(view.getByText("5%")).not.toBeNull();
    expect(view.getByText("$0.035")).not.toBeNull();
  });

  it("does not present unavailable context as zero and bounds only the visual ring", () => {
    const unavailable = render(ContextUsagePopover, { session: session(null) });
    const missingTrigger = unavailable.getByRole("button", { name: "Context usage unavailable" });
    expect(missingTrigger.querySelector(".context-ring-track")?.getAttribute("stroke-dasharray")).toBe("2 2");
    expect(missingTrigger.querySelector(".context-ring-progress")).toBeNull();
    unavailable.unmount();
    const zero = render(ContextUsagePopover, { session: session(0) });
    expect(zero.getByRole("button", { name: "Context usage: 0%" }).querySelector(".context-ring-track")?.hasAttribute("stroke-dasharray")).toBe(false);
    zero.unmount();
    const overflow = render(ContextUsagePopover, { session: session(125) });
    const overflowTrigger = overflow.getByRole("button", { name: "Context usage: 125%" });
    expect(overflowTrigger.querySelector(".context-ring-progress")?.getAttribute("stroke-dasharray")).toBe("100 100");
  });
});
