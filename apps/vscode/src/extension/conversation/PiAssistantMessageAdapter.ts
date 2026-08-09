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

interface ActiveAssistantMessage {
  id?: string;
  timestamp?: number;
  stopReason?: unknown;
  errorMessage?: string;
  parts: Map<number, AdaptedAssistantPart>;
  closedTextPartIndexes: Set<number>;
}

/**
 * Adapts Pi assistant message events into one version-independent message.
 *
 * Pi 0.83 supplies cumulative message snapshots. Pi 0.84 supplies indexed
 * deltas. Assembly is the adapter's mechanism; turn placement, persisted
 * authority, tool execution, and Webview policy remain outside this class.
 */
export class PiAssistantMessageAdapter {
  #active: ActiveAssistantMessage | undefined;
  #updatesBlocked = false;

  adapt(event: RpcEvent): AdaptedAssistantMessage | undefined {
    if (event.type === "message_start") {
      const message = completeAssistantMessage(event.message);
      if (!message) return undefined;
      const active = activeMessage(message);
      if (!hasIdentity(active)) return undefined;
      this.#active = active;
      this.#updatesBlocked = false;
      return adaptedMessage(active, "streaming", legacyFailure(event));
    }

    const complete = completeAssistantMessage(event.message);
    if (complete) {
      const active = activeMessage(complete);
      if (event.type === "message_end") {
        if (this.#active && !sameIdentity(this.#active, active)) return undefined;
        this.#active = undefined;
        this.#updatesBlocked = true;
        return adaptedMessage(active, "final", legacyFailure(event));
      }
      if (
        event.type !== "message_update"
        || this.#updatesBlocked
        || !hasIdentity(active)
        || (this.#active !== undefined && !sameIdentity(this.#active, active))
      ) return undefined;
      this.#active = active;
      return adaptedMessage(active, "streaming", legacyFailure(event));
    }

    if (event.type === "message_end") {
      this.reset();
      return undefined;
    }
    if (event.type !== "message_update" || this.#updatesBlocked || !this.#active) return undefined;

    const delta = recordValue(event.assistantMessageEvent);
    const failure = legacyFailure(event);
    if (failure) return adaptedMessage(this.#active, "streaming", failure);
    if (!applyDelta(this.#active, delta)) return undefined;
    return adaptedMessage(this.#active, "streaming");
  }

  reset(): void {
    this.#active = undefined;
    this.#updatesBlocked = true;
  }
}

export function assistantPartsFromMessage(message: Record<string, unknown>): readonly AdaptedAssistantPart[] {
  return [...partsFromContent(message.content).values()].sort(byContentIndex);
}

function completeAssistantMessage(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || value.role !== "assistant") return undefined;
  if (typeof value.content !== "string" && !Array.isArray(value.content)) return undefined;
  return value;
}

function activeMessage(message: Record<string, unknown>): ActiveAssistantMessage {
  return {
    ...(typeof message.id === "string" ? { id: message.id } : {}),
    ...(isFiniteNumber(message.timestamp) ? { timestamp: message.timestamp } : {}),
    ...(message.stopReason !== undefined ? { stopReason: message.stopReason } : {}),
    ...(typeof message.errorMessage === "string" ? { errorMessage: message.errorMessage } : {}),
    parts: partsFromContent(message.content),
    closedTextPartIndexes: new Set(),
  };
}

function partsFromContent(content: unknown): Map<number, AdaptedAssistantPart> {
  const parts = new Map<number, AdaptedAssistantPart>();
  if (typeof content === "string") {
    parts.set(0, { type: "text", contentIndex: 0, text: content });
    return parts;
  }
  if (!Array.isArray(content)) return parts;

  for (const [contentIndex, value] of content.entries()) {
    if (!isRecord(value)) continue;
    if (value.type === "text" && typeof value.text === "string") {
      parts.set(contentIndex, { type: "text", contentIndex, text: value.text });
    } else if (value.type === "thinking" && typeof value.thinking === "string") {
      parts.set(contentIndex, { type: "thinking", contentIndex, text: value.thinking });
    } else if (value.type === "image") {
      parts.set(contentIndex, { type: "image", contentIndex, content: value });
    } else if (
      value.type === "toolCall"
      && typeof value.id === "string"
      && typeof value.name === "string"
      && isRecord(value.arguments)
    ) {
      parts.set(contentIndex, {
        type: "tool",
        contentIndex,
        tool: { state: "bound", id: value.id, name: value.name, arguments: value.arguments },
      });
    }
  }
  return parts;
}

function applyDelta(active: ActiveAssistantMessage, delta: Record<string, unknown>): boolean {
  const { parts, closedTextPartIndexes } = active;
  const contentIndex = nonNegativeInteger(delta.contentIndex);
  if (contentIndex === undefined || typeof delta.type !== "string") return false;

  switch (delta.type) {
    case "text_start":
      return startTextPart(parts, contentIndex, "text");
    case "thinking_start":
      return startTextPart(parts, contentIndex, "thinking");
    case "text_delta":
      return appendTextPart(parts, closedTextPartIndexes, contentIndex, "text", delta.delta);
    case "thinking_delta":
      return appendTextPart(parts, closedTextPartIndexes, contentIndex, "thinking", delta.delta);
    case "text_end":
      return endTextPart(parts, closedTextPartIndexes, contentIndex, "text", delta.content);
    case "thinking_end":
      return endTextPart(parts, closedTextPartIndexes, contentIndex, "thinking", delta.content);
    case "toolcall_start":
      if (parts.has(contentIndex)) return false;
      parts.set(contentIndex, { type: "tool", contentIndex, tool: { state: "preparing", rawArguments: "" } });
      return true;
    case "toolcall_delta": {
      const part = parts.get(contentIndex);
      if (part?.type !== "tool" || part.tool.state !== "preparing" || typeof delta.delta !== "string") return false;
      parts.set(contentIndex, {
        ...part,
        tool: { state: "preparing", rawArguments: part.tool.rawArguments + delta.delta },
      });
      return true;
    }
    case "toolcall_end": {
      const part = parts.get(contentIndex);
      const toolCall = recordValue(delta.toolCall);
      if (
        part?.type !== "tool"
        || part.tool.state !== "preparing"
        || typeof toolCall.id !== "string"
        || typeof toolCall.name !== "string"
        || !isRecord(toolCall.arguments)
      ) return false;
      parts.set(contentIndex, {
        type: "tool",
        contentIndex,
        tool: {
          state: "bound",
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        },
      });
      return true;
    }
    default:
      return false;
  }
}

function startTextPart(
  parts: Map<number, AdaptedAssistantPart>,
  contentIndex: number,
  type: "text" | "thinking",
): boolean {
  if (parts.has(contentIndex)) return false;
  parts.set(contentIndex, { type, contentIndex, text: "" });
  return true;
}

function appendTextPart(
  parts: Map<number, AdaptedAssistantPart>,
  closedIndexes: Set<number>,
  contentIndex: number,
  type: "text" | "thinking",
  delta: unknown,
): boolean {
  const part = parts.get(contentIndex);
  if (closedIndexes.has(contentIndex) || part?.type !== type || typeof delta !== "string") return false;
  parts.set(contentIndex, { ...part, text: part.text + delta });
  return true;
}

function endTextPart(
  parts: Map<number, AdaptedAssistantPart>,
  closedIndexes: Set<number>,
  contentIndex: number,
  type: "text" | "thinking",
  content: unknown,
): boolean {
  const part = parts.get(contentIndex);
  if (closedIndexes.has(contentIndex) || part?.type !== type || typeof content !== "string") return false;
  parts.set(contentIndex, { ...part, text: content });
  closedIndexes.add(contentIndex);
  return true;
}

function hasIdentity(active: ActiveAssistantMessage): boolean {
  return active.id !== undefined || active.timestamp !== undefined;
}

function sameIdentity(left: ActiveAssistantMessage, right: ActiveAssistantMessage): boolean {
  return left.id === right.id && left.timestamp === right.timestamp;
}

function adaptedMessage(
  active: ActiveAssistantMessage,
  phase: "streaming" | "final",
  failure?: "error" | "aborted",
): AdaptedAssistantMessage {
  return {
    phase,
    ...(active.id !== undefined ? { id: active.id } : {}),
    ...(active.timestamp !== undefined ? { timestamp: active.timestamp } : {}),
    ...(active.stopReason !== undefined ? { stopReason: active.stopReason } : {}),
    ...(active.errorMessage !== undefined ? { errorMessage: active.errorMessage } : {}),
    ...(failure ? { legacyFailure: failure } : {}),
    parts: [...active.parts.values()].sort(byContentIndex),
  };
}

function legacyFailure(event: RpcEvent): "error" | "aborted" | undefined {
  const delta = recordValue(event.assistantMessageEvent);
  if (delta.type !== "error") return undefined;
  return delta.reason === "aborted" ? "aborted" : "error";
}

function byContentIndex(left: AdaptedAssistantPart, right: AdaptedAssistantPart): number {
  return left.contentIndex - right.contentIndex;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
