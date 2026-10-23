import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import ContextUsagePopover from "$ui/features/usage/ContextUsagePopover.svelte";

// Apply the default locale before the component creates its module-level formatters.
vi.hoisted(() => {
  const NativeNumberFormat = Intl.NumberFormat;
  const chineseIntl = Object.create(Intl) as typeof Intl;
  chineseIntl.NumberFormat = class extends NativeNumberFormat {
    constructor(locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions) {
      super(locales ?? "zh-CN", options);
    }
  };
  vi.stubGlobal("Intl", chineseIntl);
});

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
afterAll(() => vi.unstubAllGlobals());

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

  it("keeps K/M token units when the default Intl locale is Chinese", async () => {
    expect(new Intl.NumberFormat().resolvedOptions().locale).toBe("zh-CN");
    expect(new Intl.NumberFormat(undefined, { notation: "compact" }).format(1_000_000)).toBe("100万");
    const value = {
      status: "idle", isCompacting: false,
      stats: {
        cost: 0, contextUsage: { percent: 29.2, tokens: 292_000, contextWindow: 1_000_000 },
        tokens: { input: 292_000, output: 500, cacheRead: 10_000, cacheWrite: 0, total: 302_500 },
        userMessages: 1, assistantMessages: 1, toolCalls: 0,
      },
    } as never;
    const view = render(ContextUsagePopover, { session: value });
    await fireEvent.focus(view.getByRole("button", { name: "Context usage: 29%" }));
    expect(view.getByText("292K / 1M")).not.toBeNull();
    expect(view.getByText("302.5K")).not.toBeNull();
    expect(view.getByText("10K")).not.toBeNull();
    expect(view.getByText("500")).not.toBeNull();
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
