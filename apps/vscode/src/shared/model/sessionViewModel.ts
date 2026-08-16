import type { RpcCommandDescriptor, RpcModel, RpcSessionStats, StreamingBehavior, ThinkingLevel } from "@frostime/pi-rpc";

import type { ConversationItemView, ImageAttachmentView, QueuedPromptView } from "./conversationModel.js";
import type { ExtensionStatusView, ExtensionWidgetView, PendingExtensionUiView } from "./extensionUiModel.js";

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
  lastViewStateChangeAt: number;
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
  /** Default streaming delivery selected for this session's Composer. */
  composerStreamingBehavior: StreamingBehavior;
  networkProxy: NetworkProxyView;
  questionTool: QuestionToolStateView;
  conversationItems: ConversationItemView[];
  /** Steering prompts accepted while streaming; shown at the conversation tail until injected. */
  queuedSteers: QueuedPromptView[];
  /** Follow-ups accepted while streaming; shown at the conversation tail until promoted. */
  queuedFollowUps: QueuedPromptView[];
  pendingExtensionUi: PendingExtensionUiView[];
  extensionStatuses: ExtensionStatusView[];
  extensionWidgets: ExtensionWidgetView[];
  composerSeed?: ComposerSeedView;
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
