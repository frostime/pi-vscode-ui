export type MessageRole = "user" | "assistant" | "system";
export type MessageStatus = "streaming" | "complete" | "error" | "aborted";

export interface ImageAttachmentView {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  size: number;
}

export type MessageBlockView =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "images"; images: ImageAttachmentView[] }
  | { type: "error"; text: string };

export interface CompactionView {
  id: string;
  summary: string;
  tokensBefore: number;
  timestamp: number;
}

export interface BranchSummaryView {
  id: string;
  summary: string;
  fromId: string;
  timestamp: number;
}

export interface CustomMessageView {
  id: string;
  customType: string;
  content: string;
  display: boolean;
  details?: Record<string, unknown>;
  timestamp: number;
}

/** Local follow-up waiting for the current agent run to settle. Not part of the durable turn timeline. */
export interface QueuedFollowUpView {
  id: string;
  text: string;
  images: ImageAttachmentView[];
  timestamp: number;
}

export interface ConversationMessageView {
  id: string;
  /** Stable Pi session entry backing an operation such as Fork. */
  sourceEntryId?: string;
  role: MessageRole;
  blocks: MessageBlockView[];
  status: MessageStatus;
  timestamp: number;
}
