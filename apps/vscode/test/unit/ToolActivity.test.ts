import { render } from "svelte/server";
import { describe, expect, it } from "vitest";

import type {
  BoundToolCallView,
  PreparingToolCallView,
  ToolCallView,
} from "../../src/shared/model/toolCallModel.js";
import ToolActivity from "../../src/webview/features/conversation/ToolActivity.svelte";

/**
 * The card is pinned through its rendered markup instead of a mounted tree: the section set and
 * the section a card opens on are the whole of what a first render decides. The reader's own
 * section choice, and the latch that fixes it when the card is first expanded, are component
 * state and are not covered here.
 */
describe("ToolActivity sections", () => {
  it("offers every section the call has content for", () => {
    const card = renderCard(bound({ diff: "--- a\n+++ b", args: { path: "a.ts" }, output: "ok" }));

    expect(tabLabels(card)).toEqual(["Changes", "Input", "Output"]);
  });

  it("presents one section at a time", () => {
    const card = renderCard(bound({ diff: "--- a\n+++ b", args: { path: "a.ts" }, output: "ok" }));

    expect(panels(card).filter((panel) => !panel.hidden)).toHaveLength(1);
  });

  it("opens a change on the diff it produced", () => {
    const card = renderCard(bound({ diff: "--- a\n+++ b", args: { path: "a.ts" }, output: "ok" }));

    expect(selectedTab(card)).toBe("Changes");
    expect(card.indexOf("--- a")).toBeGreaterThan(panels(card)[0]!.index);
  });

  it("opens a failed call on its result rather than its diff", () => {
    const card = renderCard(bound({
      status: "error",
      diff: "--- a\n+++ b",
      args: { path: "a.ts" },
      output: "boom",
    }));

    expect(selectedTab(card)).toBe("Output");
    expect(panels(card).map((panel) => panel.hidden)).toEqual([true, true, false]);
    expect(card.indexOf("tool-output")).toBeGreaterThan(panels(card)[2]!.index);
  });

  it("shows a lone section without offering a choice", () => {
    const card = renderCard(bound({ status: "error", output: "boom" }));

    expect(tabLabels(card)).toEqual([]);
    expect(card).toContain('class="tool-tab-static');
    expect(staticLabel(card)).toBe("Output");
  });

  it("falls back to the arguments while a call has no result yet", () => {
    const card = renderCard(bound({ args: { command: "pnpm build" } }));

    expect(staticLabel(card)).toBe("Input");
  });

  it("labels an argument by its name inside the input section", () => {
    const card = renderCard(bound({ args: { edits: [{ oldText: "a", newText: "b" }] } }));

    expect(card).toContain('class="tool-arg-key');
    expect(argumentKeys(card)).toEqual(["edits"]);
  });

  it("shows a call that is still streaming its arguments as input", () => {
    const card = renderCard(preparing('{ "command": "pnpm build"'));

    expect(card).toContain("Preparing tool call");
    expect(tabLabels(card)).toEqual([]);
    expect(staticLabel(card)).toBe("Input");
    expect(card).toContain("pnpm build");
  });

  it("offers the recognized file as an action", () => {
    const card = renderCard(bound({ args: { path: "a.ts" }, location: { path: "a.ts", line: 4 } }));

    expect(card).toContain("Open file");
  });

  it("offers no action for a call that names no file", () => {
    const card = renderCard(bound({ args: { command: "pnpm build" } }));

    expect(card).not.toContain("tool-action");
  });
});

function renderCard(tool: ToolCallView): string {
  return render(ToolActivity, { props: { activity: activity(tool) } }).body;
}

function tabLabels(card: string): string[] {
  return matches(card, /role="tab"[^>]*>([\s\S]*?)<\/button>/g).map(stripMarkers);
}

function selectedTab(card: string): string | null {
  const selected = card.match(/aria-selected="true"[^>]*>([\s\S]*?)<\/button>/);
  return selected ? stripMarkers(selected[1]!) : null;
}

function staticLabel(card: string): string | null {
  const label = card.match(/class="tool-tab-static[^"]*"[^>]*>([\s\S]*?)<\/span>/);
  return label ? stripMarkers(label[1]!) : null;
}

function argumentKeys(card: string): string[] {
  return matches(card, /class="tool-arg-key[^"]*"[^>]*>([\s\S]*?)<\/div>/g).map(stripMarkers);
}

/** Section panels keep their markup while hidden, so the assertions need their positions. */
function panels(card: string): { hidden: boolean; index: number }[] {
  return [...card.matchAll(/role="tabpanel"([^>]*)>/g)].map((match) => ({
    hidden: match[1]!.includes("hidden"),
    index: match.index,
  }));
}

function matches(card: string, pattern: RegExp): string[] {
  return [...card.matchAll(pattern)].map((match) => match[1]!);
}

/** Svelte leaves block markers between static and dynamic content. */
function stripMarkers(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "").trim();
}

function activity(tool: ToolCallView) {
  return { id: "a1", type: "tool" as const, tool, timestamp: 0 };
}

function preparing(rawArguments: string): PreparingToolCallView {
  return { state: "preparing", rawArguments, status: "running", isError: false, startedAt: 0 };
}

function bound(options: {
  status?: BoundToolCallView["status"];
  args?: Record<string, unknown>;
  output?: string;
  diff?: string;
  location?: { path: string; line?: number };
}): BoundToolCallView {
  const recognized = options.diff !== undefined || options.location !== undefined
    ? {
      ...(options.diff !== undefined ? { diff: options.diff } : {}),
      ...(options.location !== undefined ? { location: options.location } : {}),
    }
    : undefined;
  return {
    state: "bound",
    id: "tool-1",
    name: "edit",
    label: "a.ts",
    args: options.args ?? {},
    ...(options.output !== undefined ? { output: options.output } : {}),
    ...(recognized ? { recognized } : {}),
    status: options.status ?? "complete",
    isError: options.status === "error",
    startedAt: 0,
  };
}
