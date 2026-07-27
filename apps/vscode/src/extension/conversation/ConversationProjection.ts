import type { ConversationItemView, QueuedFollowUpView } from "../../shared/model/conversationModel.js";

export interface ConversationProjectionSnapshot {
  items: readonly ConversationItemView[];
  queuedFollowUps: readonly QueuedFollowUpView[];
  updatedAt: number;
}

/** Owns persisted and live conversation identity, grouping, reconciliation, and final presentation order. */
export class ConversationProjection {
  read(): ConversationProjectionSnapshot {
    throw new Error("TODO: implement entry-backed conversation projection");
  }
}
