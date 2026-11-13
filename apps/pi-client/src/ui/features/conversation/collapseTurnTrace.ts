import type {
  AgentActivityView,
  AgentTurnItemView,
  AgentTurnStatus,
  AgentTurnView,
  ReasoningActivityView,
  SessionNoticeView,
  ToolActivityView,
} from "$shared/model/conversationModel";

export interface TurnTraceSummary {
  steps: number;
  errors: number;
  durationLabel: string | null;
}

export type TurnTraceStateLabel = "Worked" | "Stopped" | "Failed";

/** One folded run of consecutive tool calls and reasoning in the focus view. */
export interface TurnStepGroup {
  /** The first step's id: stable while the run grows, so an opened group stays open. */
  id: string;
  steps: number;
  errors: number;
  /** The run still has a step in progress. */
  active: boolean;
  /** What the run did, or is doing right now when active. */
  detail: string;
}

export type TurnItemPlan =
  | { mode: "flat" }
  | {
      mode: "collapsed";
      stateLabel: TurnTraceStateLabel;
      collapsedItemIds: ReadonlySet<string>;
      firstCollapsedItemId: string;
      anchorItemId: string;
      anchorLabel: "Reply" | "Last step";
      summary: TurnTraceSummary;
    }
  | {
      mode: "grouped";
      /** Group shown in front of the item with this id. */
      groupsByFirstItemId: ReadonlyMap<string, TurnStepGroup>;
      /** Group id of every folded item. */
      groupIdByItemId: ReadonlyMap<string, string>;
    };

/** A lone step is already a single collapsed row; folding it would only hide its name. */
const MIN_GROUP_STEPS = 2;
const MAX_GROUP_DETAIL_KINDS = 4;
const MAX_STEP_LABEL_LENGTH = 72;

/**
 * Completed turns keep their single "Worked" summary when `collapseTurnTrace` is on.
 * The focus view covers the rest: while a turn runs, and in finished turns that are not
 * collapsed, each run of tool calls and reasoning between replies folds into one row.
 */
export function planTurnItems(
  turn: Pick<AgentTurnView, "status" | "items" | "startedAt" | "endedAt">,
  collapseTurnTrace: boolean,
  focusView = false,
): TurnItemPlan {
  const collapsed = planCollapsedTrace(turn, collapseTurnTrace);
  if (collapsed.mode !== "flat" || !focusView) return collapsed;
  return planStepGroups(turn);
}

function planStepGroups(turn: Pick<AgentTurnView, "status" | "items">): TurnItemPlan {
  const groupsByFirstItemId = new Map<string, TurnStepGroup>();
  const groupIdByItemId = new Map<string, string>();
  let run: Array<ReasoningActivityView | ToolActivityView> = [];

  const closeRun = (): void => {
    const steps = run;
    run = [];
    const first = steps[0];
    if (!first || steps.length < MIN_GROUP_STEPS) return;
    const active = turn.status === "running" && steps.some(isStepInProgress);
    groupsByFirstItemId.set(first.id, {
      id: first.id,
      steps: steps.length,
      errors: countTraceErrors(steps),
      active,
      detail: active ? currentStepLabel(steps) : stepKindSummary(steps),
    });
    for (const step of steps) groupIdByItemId.set(step.id, first.id);
  };

  for (const item of turn.items) {
    // Replies, notices and structural markers stay visible and end the run before them.
    if (item.type === "reasoning" || item.type === "tool") run.push(item);
    else closeRun();
  }
  closeRun();
  return groupsByFirstItemId.size === 0 ? { mode: "flat" } : { mode: "grouped", groupsByFirstItemId, groupIdByItemId };
}

function isStepInProgress(step: ReasoningActivityView | ToolActivityView): boolean {
  return step.type === "reasoning"
    ? step.status === "streaming"
    : step.tool.state === "preparing" || step.tool.status === "running" || step.tool.status === "queued";
}

function currentStepLabel(steps: ReadonlyArray<ReasoningActivityView | ToolActivityView>): string {
  const current = [...steps].reverse().find(isStepInProgress) ?? steps.at(-1);
  if (!current) return "";
  if (current.type === "reasoning") return "Thinking";
  if (current.tool.state === "preparing") return "Preparing tool call";
  const label = current.tool.label.replace(/\s+/g, " ").trim();
  const text = label ? `${current.tool.name} ${label}` : current.tool.name;
  return text.length <= MAX_STEP_LABEL_LENGTH ? text : `${text.slice(0, MAX_STEP_LABEL_LENGTH - 1).trimEnd()}…`;
}

/** "read ×3, bash ×2, reasoning" in order of first use. */
function stepKindSummary(steps: ReadonlyArray<ReasoningActivityView | ToolActivityView>): string {
  const counts = new Map<string, number>();
  for (const step of steps) {
    const kind = step.type === "reasoning" ? "reasoning" : step.tool.state === "bound" ? step.tool.name : "tool call";
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const kinds = [...counts].map(([kind, count]) => count > 1 ? `${kind} ×${count}` : kind);
  const shown = kinds.slice(0, MAX_GROUP_DETAIL_KINDS);
  if (kinds.length > shown.length) shown.push(`+${kinds.length - shown.length} more`);
  return shown.join(", ");
}

export function formatStepGroupLabel(group: Pick<TurnStepGroup, "steps" | "errors">): string {
  const parts = [`${group.steps} steps`];
  if (group.errors > 0) parts.push(group.errors === 1 ? "1 error" : `${group.errors} errors`);
  return parts.join(" · ");
}

function planCollapsedTrace(
  turn: Pick<AgentTurnView, "status" | "items" | "startedAt" | "endedAt">,
  collapseTurnTrace: boolean,
): TurnItemPlan {
  if (!collapseTurnTrace || turn.status === "running" || turn.items.length === 0) return { mode: "flat" };

  const activityLocations = turn.items.flatMap((item, itemIndex) => isAgentActivity(item) ? [{ item, itemIndex }] : []);
  if (activityLocations.length === 0) return { mode: "flat" };

  let lastResponseIndex: number | undefined;
  for (let index = activityLocations.length - 1; index >= 0; index -= 1) {
    const location = activityLocations[index];
    if (location?.item.type === "response") {
      lastResponseIndex = location.itemIndex;
      break;
    }
  }
  const anchorIndex = traceAnchorIndex(turn.status, activityLocations, lastResponseIndex);
  if (anchorIndex === undefined) return { mode: "flat" };

  const collapsed = turn.items.slice(0, anchorIndex).filter(isTraceItem);
  const anchor = turn.items[anchorIndex];
  if (collapsed.length === 0 || !anchor || !isAgentActivity(anchor)) return { mode: "flat" };

  return {
    mode: "collapsed",
    stateLabel: turnStateLabel(turn.status),
    collapsedItemIds: new Set(collapsed.map((item) => item.id)),
    firstCollapsedItemId: collapsed[0]!.id,
    anchorItemId: anchor.id,
    anchorLabel: anchor.type === "response" ? "Reply" : "Last step",
    summary: {
      steps: collapsed.length,
      errors: countTraceErrors(collapsed),
      durationLabel: formatTurnDuration(turn.startedAt, turn.endedAt),
    },
  };
}

function traceAnchorIndex(
  status: AgentTurnStatus,
  activities: readonly { item: AgentActivityView; itemIndex: number }[],
  lastResponseIndex: number | undefined,
): number | undefined {
  if (status === "completed") return lastResponseIndex;
  if (lastResponseIndex !== undefined) return lastResponseIndex;
  return activities.length > 1 ? activities.at(-1)?.itemIndex : undefined;
}

export function turnStateLabel(status: AgentTurnStatus): TurnTraceStateLabel {
  switch (status) {
    case "completed":
      return "Worked";
    case "aborted":
      return "Stopped";
    case "error":
      return "Failed";
    case "running":
      return "Worked";
  }
}

export function formatTraceSummaryLabel(summary: TurnTraceSummary): string {
  const parts = [summary.steps === 1 ? "1 step" : `${summary.steps} steps`];
  if (summary.errors > 0) parts.push(summary.errors === 1 ? "1 error" : `${summary.errors} errors`);
  if (summary.durationLabel) parts.push(summary.durationLabel);
  return parts.join(" · ");
}

/**
 * Duration label shared by turn traces and tool cards. Coarse on purpose — this reading reassures
 * the reader that work is progressing, it is not a stopwatch.
 */
export function formatDurationMs(durationMs: number): string {
  const totalSeconds = Math.round(Math.max(0, durationMs) / 1000);
  if (totalSeconds < 1) return "<1s";
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return seconds > 0 ? `${hours}h ${minutes}m ${seconds}s` : minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return seconds > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${minutes}m`;
}

/** Timestamp-span form, used where no measured duration exists. `null` when the span is unknown. */
export function formatTurnDuration(startedAt: number, endedAt?: number): string | null {
  if (endedAt === undefined || endedAt < startedAt) return null;
  return formatDurationMs(endedAt - startedAt);
}

function isAgentActivity(item: AgentTurnView["items"][number]): item is AgentActivityView {
  return item.type === "reasoning" || item.type === "response" || item.type === "tool";
}

function isTraceItem(item: AgentTurnItemView): item is AgentActivityView | SessionNoticeView {
  return isAgentActivity(item) || item.type === "notice";
}

function countTraceErrors(items: readonly (AgentActivityView | SessionNoticeView)[]): number {
  return items.filter((item) => {
    if (item.type === "notice") return item.level === "error";
    if (item.type === "tool") return item.tool.isError || item.tool.status === "error";
    return item.status === "error";
  }).length;
}
