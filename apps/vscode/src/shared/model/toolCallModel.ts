export type ToolCallStatus = "queued" | "running" | "complete" | "error" | "cancelled";

interface ToolCallBase {
  status: ToolCallStatus;
  isError: boolean;
  startedAt: number;
  endedAt?: number;
  /**
   * Milliseconds Pi measured for this call's own execution. Absent when the session was recorded
   * before Pi reported durations, in which case `startedAt` and `endedAt` are the only clue.
   */
  durationMs?: number;
}

export interface PreparingToolCallView extends ToolCallBase {
  state: "preparing";
  rawArguments: string;
}

export interface RecognizedToolLocationView {
  path: string;
  line?: number;
}

/**
 * UI metadata recognized from conventional fields in otherwise tool-specific
 * arguments and result details. These are FrostPi interpretations, not raw Pi fields.
 */
export interface RecognizedToolCallView {
  /** File location recognized from path and line argument conventions. */
  location?: RecognizedToolLocationView;
  /** Display-oriented diff recognized from a result details.diff string. */
  diff?: string;
}

export interface BoundToolCallView extends ToolCallBase {
  state: "bound";
  id: string;
  name: string;
  label: string;
  args: Record<string, unknown>;
  output?: string;
  recognized?: RecognizedToolCallView;
}

export type ToolCallView = PreparingToolCallView | BoundToolCallView;
