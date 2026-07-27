import type { RpcCommandDescriptor, RpcModel, RpcSessionStats, ThinkingLevel } from "@frostime/pi-rpc";

import type { AgentTurnView, SessionNoticeView } from "./agentTurnModel.js";
import type { BranchSummaryView, CompactionView, CustomMessageView, ImageAttachmentView, QueuedFollowUpView } from "./conversationModel.js";
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
  modelLabel?: string;
  thinkingLevel?: ThinkingLevel;
  historyStatus: SessionHistoryStatus;
  requiresUserInput: boolean;
  updatedAt: number;
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

export interface BranchControlView {
  /** `null` represents Pi's virtual root before the first session entry. */
  branchPointId: string | null;
  anchorEntryId: string;
  anchorPosition: "before" | "after";
  pathCount: number;
  branchSummary?: BranchSummaryView;
}

export interface SessionViewModel {
  id: string;
  title: string;
  cwd: string;
  workingDirectoryLabel?: string;
  status: SessionRuntimeStatus;
  isStreaming: boolean;
  isCompacting: boolean;
  isForking: boolean;
  historyStatus: SessionHistoryStatus;
  sessionFile?: string;
  sessionId?: string;
  model: RpcModel | null;
  thinkingLevel: ThinkingLevel;
  availableModels: RpcModel[];
  commands: RpcCommandDescriptor[];
  attachmentLimits: AttachmentLimitsView;
  /** When true, completed turns collapse tool/reasoning/interim replies into one summary above the final response. */
  collapseTurnTrace: boolean;
  networkProxy: NetworkProxyView;
  questionTool: QuestionToolStateView;
  turns: AgentTurnView[];
  notices: SessionNoticeView[];
  compactions: CompactionView[];
  branchSummaries: BranchSummaryView[];
  customMessages: CustomMessageView[];
  /** Follow-ups accepted while streaming in followUp mode; shown at the conversation tail until promoted. */
  queuedFollowUps: QueuedFollowUpView[];
  pendingExtensionUi: PendingExtensionUiView[];
  extensionStatuses: ExtensionStatusView[];
  extensionWidgets: ExtensionWidgetView[];
  composerSeed?: ComposerSeedView;
  branchControls: BranchControlView[];
  sessionTreeAvailable: boolean;
  isNavigatingTree: boolean;
  isSummarizingTree: boolean;
  stats?: RpcSessionStats;
  error?: string;
  updatedAt: number;
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
