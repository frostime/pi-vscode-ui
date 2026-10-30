import { writable } from "svelte/store";

import type { HostToWebviewMessage } from "$shared/bridge/hostToWebview";
import type { ConversationMessageView } from "$shared/model/conversationModel";
import type { SessionViewModel } from "$shared/model/sessionViewModel";

import { postToHost } from "../../bridge/hostBridge";
import { showToast } from "../../state/sessionViewStore.svelte";
import { createId } from "../../utils/createId";

const pending = new Set<string>();
export const pendingForkEntryId = writable<string | null>(null);

export function requestMessageFork(session: SessionViewModel, message: ConversationMessageView): void {
  const entryId = message.sourceEntryId;
  if (!entryId || pending.size > 0) return;

  const requestId = createId("fork");
  pending.add(requestId);
  pendingForkEntryId.set(entryId);
  postToHost({ type: "forkMessage", requestId, sessionId: session.id, entryId });
}

export function resolveForkResult(message: Extract<HostToWebviewMessage, { type: "forkResult" }>): void {
  if (!pending.delete(message.requestId)) return;
  pendingForkEntryId.set(null);
  if (!message.ok) showToast("error", message.error ?? "Unable to fork this message.");
}
