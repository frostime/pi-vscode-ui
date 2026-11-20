import type { QuestionItem } from "../question-tool/questionToolProtocol.js";

export type StandardExtensionUiRequestKind = "select" | "confirm" | "input" | "editor";

export interface PendingStandardExtensionUiView {
  id: string;
  method: StandardExtensionUiRequestKind;
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  receivedAt: number;
}

export interface PendingQuestionUiView {
  id: string;
  method: "question";
  title: string;
  requestId: string;
  questions: QuestionItem[];
  receivedAt: number;
}

export type PendingExtensionUiView = PendingStandardExtensionUiView | PendingQuestionUiView;

export interface ExtensionStatusView {
  key: string;
  text: string;
}

export interface ExtensionWidgetView {
  key: string;
  lines: string[];
  placement: "above" | "below";
  subagents?: SubagentRowView[];
  scheduledTasks?: ScheduledTaskView[];
}

export interface ScheduledTaskView {
  id: string;
  name: string;
  state: string;
  timing: string;
  nextRun?: string;
}

export interface SubagentTarget {
  runId: string;
  childId?: string;
}

export const subagentStopPickerCommand = "subagents-stop-picker-rpc";

export function hasActiveBackgroundWorkers(widgets: readonly ExtensionWidgetView[]): boolean {
  return widgets.some(widget => widget.subagents?.some(row => row.state === "queued" || row.state === "running"));
}

export interface SubagentRowView {
  name: string;
  state: string;
  depth: number;
  startedAt?: number;
  endedAt?: number;
  target?: SubagentTarget;
}

export type SubagentTranscriptView =
  | { error: string }
  | {
    finished: boolean;
    state: string;
    messages: { role: string; kind: string; text: string; name?: string }[];
    finalOutput?: string;
    truncated: boolean;
  };
