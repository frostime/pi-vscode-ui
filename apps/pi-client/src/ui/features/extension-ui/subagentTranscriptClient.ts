import type { HostToWebviewMessage } from "$shared/bridge/hostToWebview";
import type { SubagentTarget, SubagentTranscriptView } from "$shared/model/extensionUiModel";
import { postToHost } from "../../bridge/hostBridge";
import { createId } from "../../utils/createId";

const pending = new Map<string, { sessionId: string; accept(result: SubagentTranscriptView): void }>();

export function requestSubagentTranscript(
  sessionId: string,
  target: SubagentTarget,
  accept: (result: SubagentTranscriptView) => void,
): () => void {
  const requestId = createId("worker");
  pending.set(requestId, { sessionId, accept });
  const { runId, childId } = target;
  postToHost({ type: "inspectSubagent", requestId, sessionId, target: { runId, ...(childId ? { childId } : {}) } });
  return () => { pending.delete(requestId); };
}

export function deliverSubagentTranscript(message: Extract<HostToWebviewMessage, { type: "subagentTranscriptResult" }>): void {
  const request = pending.get(message.requestId);
  if (request?.sessionId !== message.sessionId) return;
  pending.delete(message.requestId);
  request.accept(message.result);
}
