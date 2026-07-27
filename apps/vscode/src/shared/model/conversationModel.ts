import type { ToolCallView } from "./toolCallModel.js";

export type MessageRole = "user" | "assistant" | "system";
export type MessageStatus = "streaming" | "complete" | "error" | "aborted";
export type AgentTurnStatus = "running" | "completed" | "aborted" | "error";
export type SessionNoticeLevel = "info" | "warning" | "error";

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

export interface ConversationMessageView {
  id: string;
  sourceEntryId?: string;
  role: MessageRole;
  blocks: MessageBlockView[];
  status: MessageStatus;
  timestamp: number;
}

export interface ReasoningActivityView {
  id: string;
  type: "reasoning";
  text: string;
  status: MessageStatus;
  timestamp: number;
}

export interface ResponseActivityView {
  id: string;
  type: "response";
  blocks: MessageBlockView[];
  status: MessageStatus;
  timestamp: number;
}

export interface ToolActivityView {
  id: string;
  type: "tool";
  tool: ToolCallView;
  timestamp: number;
}

export type AgentActivityView = ReasoningActivityView | ResponseActivityView | ToolActivityView;

export interface SessionNoticeView {
  id: string;
  type: "notice";
  text: string;
  level: SessionNoticeLevel;
  timestamp: number;
}

export interface CompactionView {
  id: string;
  type: "compaction";
  summary: string;
  tokensBefore: number;
  timestamp: number;
}

export interface BranchSummaryView {
  id: string;
  type: "branchSummary";
  summary: string;
  timestamp: number;
}

export interface CustomMessageView {
  id: string;
  type: "customMessage";
  customType: string;
  blocks: MessageBlockView[];
  timestamp: number;
}

export interface BranchControlView {
  id: string;
  type: "branchControl";
  branchPointId: string | null;
  activeChildEntryId: string;
  pathCount: number;
}

export type ConversationAnnotationView =
  | SessionNoticeView
  | CompactionView
  | BranchSummaryView
  | CustomMessageView;

export type AgentTurnItemView = AgentActivityView | ConversationAnnotationView | BranchControlView;

export interface AgentTurnView {
  id: string;
  type: "turn";
  userMessage?: ConversationMessageView;
  items: AgentTurnItemView[];
  status: AgentTurnStatus;
  startedAt: number;
  endedAt?: number;
}

export type ConversationItemView = AgentTurnView | ConversationAnnotationView | BranchControlView;

/** Local follow-up waiting for the current agent run to settle. It is not part of persisted conversation order. */
export interface QueuedFollowUpView {
  id: string;
  text: string;
  images: ImageAttachmentView[];
  timestamp: number;
}
