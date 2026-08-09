import type { RpcEvent } from "@frostime/pi-rpc";

export type AdaptedAssistantPart =
  | { type: "text"; contentIndex: number; text: string }
  | { type: "thinking"; contentIndex: number; text: string }
  | { type: "image"; contentIndex: number; content: Record<string, unknown> }
  | {
      type: "tool";
      contentIndex: number;
      tool:
        | { state: "preparing"; rawArguments: string }
        | { state: "bound"; id: string; name: string; arguments: Record<string, unknown> };
    };

export interface AdaptedAssistantMessage {
  phase: "streaming" | "final";
  id?: string;
  timestamp?: number;
  stopReason?: unknown;
  errorMessage?: string;
  legacyFailure?: "error" | "aborted";
  parts: readonly AdaptedAssistantPart[];
}

/**
 * Adapts Pi assistant message events into one version-independent message.
 *
 * Pi 0.83 supplies cumulative message snapshots. Pi 0.84 supplies indexed
 * deltas. Assembly is the adapter's mechanism; turn placement, persisted
 * authority, tool execution, and Webview policy remain outside this class.
 */
export class PiAssistantMessageAdapter {
  adapt(_event: RpcEvent): AdaptedAssistantMessage | undefined {
    // pi-084-message-streaming::shape — implement the reviewed version adapter here.
    throw new Error("PiAssistantMessageAdapter has not been implemented");
  }

  reset(): void {
    // pi-084-message-streaming::shape — clear the single active assistant message.
  }
}
