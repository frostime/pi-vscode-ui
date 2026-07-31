import type { ConversationMessageView } from "$shared/model/conversationModel";
import type { SessionViewModel } from "$shared/model/sessionViewModel";

import { postToHost } from "../../bridge/vscodeBridge";
import { getDraft } from "../../features/composer/composerDraftStore.svelte";

export function requestBranchHere(session: SessionViewModel, message: ConversationMessageView): void {
  if (!message.sourceEntryId) return;
  postToHost({
    type: "branchHere",
    sessionId: session.id,
    entryId: message.sourceEntryId,
    hasDraft: hasComposerDraft(session.id),
  });
}

export function requestBranchSwitch(session: SessionViewModel, branchPointId: string | null): void {
  postToHost({
    type: "switchBranch",
    sessionId: session.id,
    branchPointId,
    hasDraft: hasComposerDraft(session.id),
  });
}

function hasComposerDraft(sessionId: string): boolean {
  const draft = getDraft(sessionId);
  return draft.text.length > 0 || draft.images.length > 0;
}
