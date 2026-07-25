import type { AgentActivityView, AgentTurnView, AgentTurnStatus } from "$shared/model/agentTurnModel";

export interface TurnTraceSummary {
  steps: number;
  errors: number;
  durationLabel: string | null;
}

export type TurnTraceStateLabel = "Worked" | "Stopped" | "Failed";

export type TurnActivityPlan =
  | { mode: "flat"; activities: readonly AgentActivityView[] }
  | {
      mode: "collapsed";
      stateLabel: TurnTraceStateLabel;
      collapsed: readonly AgentActivityView[];
      visible: readonly AgentActivityView[];
      summary: TurnTraceSummary;
    };

/** Codex-style: once a turn settles, hide the work trace before the final reply or the interrupted step. */
export function planTurnActivities(
  turn: Pick<AgentTurnView, "status" | "activities" | "startedAt" | "endedAt">,
  collapseTurnTrace: boolean,
): TurnActivityPlan {
  const { activities, status } = turn;
  if (!collapseTurnTrace || status === "running" || activities.length === 0) {
    return { mode: "flat", activities };
  }

  let lastResponseIndex = -1;
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    if (activities[index]!.type === "response") {
      lastResponseIndex = index;
      break;
    }
  }

  const anchorIndex = traceAnchorIndex(status, activities.length, lastResponseIndex);
  if (anchorIndex <= 0) return { mode: "flat", activities };

  const collapsed = activities.slice(0, anchorIndex);
  return {
    mode: "collapsed",
    stateLabel: turnStateLabel(status),
    collapsed,
    visible: activities.slice(anchorIndex),
    summary: {
      steps: collapsed.length,
      errors: countTraceErrors(collapsed),
      durationLabel: formatTurnDuration(turn.startedAt, turn.endedAt),
    },
  };
}

function traceAnchorIndex(status: AgentTurnStatus, activityCount: number, lastResponseIndex: number): number {
  // Completed turns keep the existing behavior: anchor on the last response. If there is no
  // response, the turn is malformed and we leave it flat.
  if (status === "completed") {
    return lastResponseIndex > 0 ? lastResponseIndex : -1;
  }

  // Aborted/error turns may end before the assistant produces a final response. Anchor on the
  // last response when available, otherwise on the last activity so the interrupted step stays
  // visible.
  if (lastResponseIndex > 0) return lastResponseIndex;
  return activityCount > 1 ? activityCount - 1 : -1;
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

function countTraceErrors(activities: readonly AgentActivityView[]): number {
  let errors = 0;
  for (const activity of activities) {
    if (activity.type === "tool" && (activity.tool.isError || activity.tool.status === "error")) errors += 1;
  }
  return errors;
}
