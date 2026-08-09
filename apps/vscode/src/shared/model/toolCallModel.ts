export type ToolCallStatus = "queued" | "running" | "complete" | "error" | "cancelled";

// pi-084-message-streaming::shape — replace this single shape with an explicit
// preparing/bound union; preparing tools must not carry a fabricated Pi tool ID.
export interface ToolCallView {
  id: string;
  name: string;
  label: string;
  status: ToolCallStatus;
  args: Record<string, unknown>;
  output?: string;
  isError: boolean;
  startedAt: number;
  endedAt?: number;
  filePath?: string;
  line?: number;
}
