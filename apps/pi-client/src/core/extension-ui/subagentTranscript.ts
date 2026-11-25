import type { SubagentTarget, SubagentTranscriptView } from "../../shared/model/extensionUiModel.js";
import { sanitizeExtensionUiText } from "./sanitizeExtensionUiText.js";

export const subagentInspector = "subagents-inspect-rpc";
export const subagentInspectWidget = "subagent-inspect";
const replyPrefix = "PI_SUBAGENT_INSPECT_JSON:";
const activeStates = new Set(["queued", "pending", "running"]);
const finishedStates = new Set(["complete", "completed", "failed", "partial", "paused", "stopped", "rejected"]);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readSubagentTranscript(
  lines: string[] | undefined,
  requestId: string,
  target: SubagentTarget,
): SubagentTranscriptView | undefined {
  const line = lines?.[0];
  if (!line?.startsWith(replyPrefix)) return;
  const json = line.slice(replyPrefix.length);
  if (Buffer.byteLength(json, "utf8") > 64 * 1024) return;
  let reply: unknown;
  try {
    reply = JSON.parse(json);
  } catch {
    return;
  }
  if (!record(reply) || reply.kind !== "pi-subagents.inspect-reply" || reply.version !== 1 ||
      reply.requestId !== requestId || reply.asyncId !== target.runId || reply.childId !== target.childId) return;
  if (record(reply.error)) {
    return { error: reply.error.code === "not_found" ? "Pi has no recorded transcript for this worker yet." : "Pi could not read this worker’s transcript." };
  }
  if (typeof reply.status !== "string" || (!activeStates.has(reply.status) && !finishedStates.has(reply.status))) return;
  const messages = Array.isArray(reply.messages) ? reply.messages.slice(-200).flatMap((message: unknown) => {
    if (!record(message) || typeof message.role !== "string" || typeof message.kind !== "string" || typeof message.text !== "string") return [];
    return [{
      role: message.role,
      kind: message.kind,
      text: sanitizeExtensionUiText(message.text),
      ...(typeof message.name === "string" ? { name: sanitizeExtensionUiText(message.name) } : {}),
    }];
  }) : [];
  const finalOutput = typeof reply.finalOutput === "string" ? sanitizeExtensionUiText(reply.finalOutput) : undefined;
  return {
    finished: finishedStates.has(reply.status),
    state: reply.status === "pending" ? "queued" : reply.status === "completed" ? "complete" : reply.status,
    messages,
    ...(finalOutput && !messages.some((message) => message.role === "assistant" && message.text === finalOutput) ? { finalOutput } : {}),
    truncated: record(reply.truncated) && (
      reply.truncated.task === true || reply.truncated.finalOutput === true ||
      (typeof reply.truncated.messages === "number" && reply.truncated.messages > 0)
    ),
  };
}
