import { describe, expect, it } from "vitest";

import type { BoundToolCallView, PreparingToolCallView } from "../../src/shared/model/toolCallModel.js";
import {
  planToolSections,
  sectionToShow,
  type ToolSectionPlan,
} from "../../src/webview/features/conversation/toolSectionPlan.js";

describe("planToolSections", () => {
  it("shows only the streamed arguments while the call is still being prepared", () => {
    expect(planToolSections(preparing("part { \"path\": \"a.ts\""))).toEqual({
      sections: [{ id: "input", label: "Input" }],
      defaultSectionId: "input",
    });
  });

  it("reports every section a completed edit can show and keeps them in display order", () => {
    const plan = planToolSections(bound({ diff: "--- a\n+++ b", args: { path: "a.ts" }, output: "ok" }));

    expect(plan.sections.map((entry) => entry.id)).toEqual(["changes", "input", "output"]);
    expect(plan.openFile).toBeUndefined();
  });

  it("omits a section for an empty result instead of showing an empty panel", () => {
    const plan = planToolSections(bound({ args: { command: "ls" }, output: "" }));

    expect(plan.sections.map((entry) => entry.id)).toEqual(["input"]);
  });

  it("has nothing to show for a bound call without arguments, result, or diff", () => {
    expect(planToolSections(bound({}))).toEqual({ sections: [], defaultSectionId: null });
  });

  it("exposes the recognized file location as an open action", () => {
    const plan = planToolSections(bound({ args: { path: "a.ts" }, location: { path: "a.ts", line: 12 } }));

    expect(plan.openFile).toEqual({ path: "a.ts", line: 12 });
  });
});

describe("planToolSections default section", () => {
  it("opens a successful change on its diff", () => {
    const plan = planToolSections(bound({ diff: "d", args: { path: "a.ts" }, output: "ok" }));

    expect(plan.defaultSectionId).toBe("changes");
  });

  it("opens every other successful call on its result", () => {
    const plan = planToolSections(bound({ args: { command: "ls" }, output: "a.ts" }));

    expect(plan.defaultSectionId).toBe("output");
  });

  it("opens a failed call on its result even when it also reports a diff", () => {
    for (const status of ["error", "cancelled"] as const) {
      const plan = planToolSections(bound({ status, diff: "d", args: { path: "a.ts" }, output: "boom" }));

      expect(plan.defaultSectionId).toBe("output");
    }
  });

  it("falls back to the arguments when a call has no result yet", () => {
    const plan = planToolSections(bound({ args: { command: "pnpm build" } }));

    expect(plan.defaultSectionId).toBe("input");
  });

  it("opens a successful write on the content it wrote", () => {
    const plan = planToolSections(bound({
      name: "write",
      args: { path: "a.ts", content: "export const a = 1;\n" },
      output: "Wrote 20 bytes to a.ts",
    }));

    expect(plan.defaultSectionId).toBe("input");
  });

  it("still opens a successful write on its content when it also reports a diff", () => {
    const plan = planToolSections(bound({
      name: "write",
      args: { path: "a.ts", content: "b" },
      diff: "--- a\n+++ b",
      output: "ok",
    }));

    expect(plan.defaultSectionId).toBe("input");
  });

  it("opens a failed write on its result like any other failure", () => {
    const plan = planToolSections(bound({
      status: "error",
      name: "write",
      args: { path: "a.ts", content: "b" },
      output: "boom",
    }));

    expect(plan.defaultSectionId).toBe("output");
  });
});

describe("sectionToShow", () => {
  const plan: ToolSectionPlan = {
    sections: [
      { id: "changes", label: "Changes" },
      { id: "input", label: "Input" },
      { id: "output", label: "Output" },
    ],
    defaultSectionId: "changes",
  };

  it("keeps the section the reader picked", () => {
    expect(sectionToShow(plan, "input")).toBe("input");
  });

  it("falls back to the default before the reader has picked one", () => {
    expect(sectionToShow(plan, null)).toBe("changes");
  });

  it("falls back to the default when the picked section is no longer offered", () => {
    expect(sectionToShow({ sections: plan.sections.slice(1), defaultSectionId: "output" }, "changes"))
      .toBe("output");
  });

  it("reports no section for a plan that has none", () => {
    expect(sectionToShow({ sections: [], defaultSectionId: null }, null)).toBeNull();
  });
});

function preparing(rawArguments: string): PreparingToolCallView {
  return { state: "preparing", rawArguments, status: "running", isError: false, startedAt: 0 };
}

function bound(options: {
  status?: BoundToolCallView["status"];
  name?: string;
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
    name: options.name ?? "edit",
    label: "a.ts",
    args: options.args ?? {},
    ...(options.output !== undefined ? { output: options.output } : {}),
    ...(recognized ? { recognized } : {}),
    status: options.status ?? "complete",
    isError: options.status === "error",
    startedAt: 0,
  };
}
