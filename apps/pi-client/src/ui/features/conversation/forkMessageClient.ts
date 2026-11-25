import { writable } from "svelte/store";

import type { HostToWebviewMessage } from "$shared/bridge/hostToWebview";
import type { ConversationMessageView } from "$shared/model/conversationModel";
import type { SessionViewModel } from "$shared/model/sessionViewModel";

import { postToHost } from "../../bridge/hostBridge";
import { showToast } from "../../state/sessionViewStore.svelte";
import { createId } from "../../utils/createId";

const pending = new Set<string>();
/** View id of the user message being forked. */
export const pendingForkMessageId = writable<string | null>(null);

/**
 * Forks at a user message. A message of the running turn has no Pi entry id in the
 * conversation yet; the Host then finds its entry by the message's view id.
 */
export function requestMessageFork(session: SessionViewModel, message: ConversationMessageView): void {
  if (pending.size > 0) return;
  const target = message.sourceEntryId ? { entryId: message.sourceEntryId } : { messageId: message.id };

  const requestId = createId("fork");
  pending.add(requestId);
  pendingForkMessageId.set(message.id);
  postToHost({ type: "forkMessage", requestId, sessionId: session.id, ...target });
}

export function resolveForkResult(message: Extract<HostToWebviewMessage, { type: "forkResult" }>): void {
  if (!pending.delete(message.requestId)) return;
  pendingForkMessageId.set(null);
  if (!message.ok) showToast("error", message.error ?? "Unable to fork this message.");
}
