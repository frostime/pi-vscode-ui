import type { BoundToolCallView, ToolCallView } from "$shared/model/toolCallModel";

/** A tool card shows one section at a time; every section is derived from the tool view. */
export type ToolSectionId = "changes" | "input" | "output";

export interface ToolSection {
  id: ToolSectionId;
  label: string;
}

export interface ToolSectionPlan {
  /** Sections this call can show, in stable display order. Empty while it has nothing to show. */
  sections: ToolSection[];
  /** Section to select on first expansion. */
  defaultSectionId: ToolSectionId | null;
  /** Set when the call names a file the user can open. */
  openFile?: { path: string; line?: number };
}

const SECTION_LABELS: Record<ToolSectionId, string> = {
  changes: "Changes",
  input: "Input",
  output: "Output",
};

export function isToolSectionId(value: string): value is ToolSectionId {
  return Object.hasOwn(SECTION_LABELS, value);
}

export function planToolSections(tool: ToolCallView): ToolSectionPlan {
  if (tool.state === "preparing") {
    // Only the streamed arguments exist yet. The header already marks them as provisional,
    // so the section needs no "raw" qualifier of its own.
    return { sections: [section("input")], defaultSectionId: "input" };
  }

  const available = availableSectionIds(tool);
  const location = tool.recognized?.location;
  return {
    sections: available.map(section),
    defaultSectionId: defaultSectionId(tool, available),
    ...(location ? { openFile: { path: location.path, ...(location.line ? { line: location.line } : {}) } } : {}),
  };
}

/**
 * Resolves what the card shows for a stored choice: the user's selection while it still
 * exists, otherwise the plan default.
 */
export function sectionToShow(plan: ToolSectionPlan, chosen: ToolSectionId | null): ToolSectionId | null {
  return chosen !== null && plan.sections.some((entry) => entry.id === chosen)
    ? chosen
    : plan.defaultSectionId;
}


function availableSectionIds(tool: BoundToolCallView): ToolSectionId[] {
  const ids: ToolSectionId[] = [];
  if (tool.recognized?.diff) ids.push("changes");
  if (Object.keys(tool.args).length > 0) ids.push("input");
  if (tool.output) ids.push("output");
  return ids;
}

/**
 * A failed call is explained by its result, a successful change by its diff, anything else by
 * its result. Input normally comes last because it repeats what the header already labels.
 *
 * A successful `write` is the exception: its arguments carry the file content, so they say what
 * the file now holds without the diff's addition marker on every written line.
 */
function defaultSectionId(tool: BoundToolCallView, available: ToolSectionId[]): ToolSectionId | null {
  if (tool.status === "error" || tool.status === "cancelled") {
    return preferred(available, ["output", "changes", "input"]);
  }
  if (tool.name === "write") return preferred(available, ["input", "changes", "output"]);
  return preferred(available, ["changes", "output", "input"]);
}

function preferred(available: ToolSectionId[], priority: ToolSectionId[]): ToolSectionId | null {
  return priority.find((id) => available.includes(id)) ?? null;
}

function section(id: ToolSectionId): ToolSection {
  return { id, label: SECTION_LABELS[id] };
}
