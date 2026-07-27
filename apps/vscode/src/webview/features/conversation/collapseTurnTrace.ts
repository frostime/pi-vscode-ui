import type { AgentActivityView, AgentTurnStatus, AgentTurnView } from "$shared/model/conversationModel";

export interface TurnTraceSummary {
  steps: number;
  errors: number;
  durationLabel: string | null;
}

export type TurnTraceStateLabel = "Worked" | "Stopped" | "Failed";

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
    };

export function planTurnItems(
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

  const collapsed = activityLocations.filter(({ itemIndex }) => itemIndex < anchorIndex).map(({ item }) => item);
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

export function formatTurnDuration(startedAt: number, endedAt?: number): string | null {
  if (endedAt === undefined || endedAt < startedAt) return null;
  const totalSeconds = Math.round((endedAt - startedAt) / 1000);
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

function isAgentActivity(item: AgentTurnView["items"][number]): item is AgentActivityView {
  return item.type === "reasoning" || item.type === "response" || item.type === "tool";
}

function countTraceErrors(activities: readonly AgentActivityView[]): number {
  return activities.filter((activity) => activity.type === "tool" && (activity.tool.isError || activity.tool.status === "error")).length;
}
