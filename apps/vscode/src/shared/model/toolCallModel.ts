export type ToolCallStatus = "queued" | "running" | "complete" | "error" | "cancelled";

interface ToolCallBase {
  status: ToolCallStatus;
  isError: boolean;
  startedAt: number;
  endedAt?: number;
}

export interface PreparingToolCallView extends ToolCallBase {
  state: "preparing";
  rawArguments: string;
}

export interface BoundToolCallView extends ToolCallBase {
  state: "bound";
  id: string;
  name: string;
  label: string;
  args: Record<string, unknown>;
  output?: string;
  filePath?: string;
  line?: number;
}

export type ToolCallView = PreparingToolCallView | BoundToolCallView;
