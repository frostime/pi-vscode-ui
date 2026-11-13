import type { RpcCommandDescriptor, RpcModel, RpcSessionStats, StreamingBehavior, ThinkingLevel } from "@frostime/pi-rpc";

import type { ConversationItemView, ImageAttachmentView, QueuedPromptView } from "./conversationModel.js";
import type { ExtensionStatusView, ExtensionWidgetView, PendingExtensionUiView } from "./extensionUiModel.js";
import type { QueuedPromptRecoveryView } from "./queuedPromptRecoveryModel.js";

export type SessionRuntimeStatus = "queued" | "starting" | "ready" | "running" | "stopping" | "stopped" | "failed";
export type SessionHistoryStatus = "loaded" | "queued" | "loading" | "deferred" | "failed";

export interface SessionSummaryView {
  id: string;
  title: string;
  cwd: string;
  workingDirectoryLabel?: string;
  status: SessionRuntimeStatus;
  isActive: boolean;
  isEphemeral: boolean;
  modelLabel?: string;
  thinkingLevel?: ThinkingLevel;
  historyStatus: SessionHistoryStatus;
  requiresUserInput: boolean;
}


export interface NetworkProxyView {
  mode: "inherit" | "vscode" | "custom" | "direct";
  /** Proxy environment currently applied to the running process, or the next process when stopped. */
  label: string;
  /** Configured target shown only when it differs from the running process. */
  pendingLabel?: string;
  restartRequired: boolean;
}

export interface AttachmentLimitsView {
  maxImageBytes: number;
  maxImages: number;
}

export interface QuestionToolStateView {
  configuredEnabled: boolean;
  appliedEnabled: boolean;
  restartRequired: boolean;
}

/**
 * One `/btw` exchange. It is answered from the conversation Pi holds but is never
 * written to it, so it lives only in the running Session's view.
 */
export interface SideQuestionView {
  id: string;
  question: string;
  status: "pending" | "answered" | "failed";
  /** Markdown answer; present once answered. */
  answer?: string;
  /** The answer exceeded the transfer bound and was cut. */
  truncated?: boolean;
  /** The reply may be partial: the model hit its output limit or tried to call a tool. */
  incomplete?: "length" | "tool-call";
  error?: string;
  /** `provider/model` that answered. */
  model?: string;
  usage?: { input: number; output: number; cacheRead: number };
  askedAt: number;
}

export interface ComposerSeedView {
  id: string;
  text: string;
  images: ImageAttachmentView[];
}

export interface SessionViewModel {
  id: string;
  title: string;
  cwd: string;
  workingDirectoryLabel?: string;
  status: SessionRuntimeStatus;
  isEphemeral: boolean;
  isStreaming: boolean;
  isCompacting: boolean;
  isForking: boolean;
  historyStatus: SessionHistoryStatus;
  /**
   * Set while a large session shows only its recent part: from its last compaction, or
   * from a recent prompt when there is none. Absent once the whole history is loaded.
   */
  partialHistory?: "compaction" | "recent";
  sessionFile?: string;
  sessionId?: string;
  model: RpcModel | null;
  thinkingLevel: ThinkingLevel;
  availableModels: RpcModel[];
  /** Models matched by Pi's enabledModels/--models scope; the full catalogue remains in availableModels. */
  scopedModelIds: string[];
  commands: RpcCommandDescriptor[];
  attachmentLimits: AttachmentLimitsView;
  /** When true, completed turns collapse tool/reasoning/interim replies into one summary above the final response. */
  collapseTurnTrace: boolean;
  /** When true, runs of tool calls and reasoning fold into one expandable row, also while a turn is running. */
  focusView: boolean;
  /** Default streaming delivery selected for this session's Composer. */
  composerStreamingBehavior: StreamingBehavior;
  networkProxy: NetworkProxyView;
  questionTool: QuestionToolStateView;
  conversationItems: ConversationItemView[];
  /** Steering prompts accepted while streaming; shown at the conversation tail until injected. */
  queuedSteers: QueuedPromptView[];
  /** Follow-ups accepted while streaming; shown at the conversation tail until promoted. */
  queuedFollowUps: QueuedPromptView[];
  queuedPromptRecovery: QueuedPromptRecoveryView;
  pendingExtensionUi: PendingExtensionUiView[];
  extensionStatuses: ExtensionStatusView[];
  extensionWidgets: ExtensionWidgetView[];
  composerSeed?: ComposerSeedView;
  sideQuestion?: SideQuestionView;
  sessionTreeAvailable: boolean;
  isNavigatingTree: boolean;
  isSummarizingTree: boolean;
  stats?: RpcSessionStats;
  /** Prompt-cache hit percentage for the latest assistant message on the active session path. */
  cacheHitPercent?: number;
  error?: string;
  conversationContentRevision: number;
}

export interface WorkspaceViewModel {
  workspaceName: string;
  workspacePath: string;
  sessions: SessionSummaryView[];
  activeSessionId: string | null;
  activeSession: SessionViewModel | null;
  piAvailable: boolean;
  piError?: string;
}
