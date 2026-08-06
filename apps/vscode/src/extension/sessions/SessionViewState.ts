import type { RpcEvent, RpcSessionState } from "@frostime/pi-rpc";

import type { ConversationProjectionSnapshot } from "../conversation/ConversationProjection.js";
import type {
  AttachmentLimitsView,
  SessionRuntimeStatus,
  SessionViewModel,
} from "../../shared/model/sessionViewModel.js";

type SessionScalarView = Omit<SessionViewModel, "conversationItems" | "queuedFollowUps">;

export class SessionViewState {
  readonly #view: SessionScalarView;

  constructor(
    id: string,
    cwd: string,
    title: string,
    attachmentLimits: AttachmentLimitsView = { maxImageBytes: 10 * 1024 * 1024, maxImages: 12 },
    initialUpdatedAt = Date.now(),
    collapseTurnTrace = true,
    isEphemeral = false,
  ) {
    this.#view = {
      id,
      title,
      cwd,
      status: "stopped",
      isEphemeral,
      isStreaming: false,
      isCompacting: false,
      isForking: false,
      historyStatus: "loaded",
      model: null,
      thinkingLevel: "off",
      availableModels: [],
      commands: [],
      attachmentLimits,
      collapseTurnTrace,
      networkProxy: { mode: "inherit", label: "Inherited", restartRequired: false },
      questionTool: { configuredEnabled: false, appliedEnabled: false, restartRequired: false },
      pendingExtensionUi: [],
      extensionStatuses: [],
      extensionWidgets: [],
      sessionTreeAvailable: false,
      isNavigatingTree: false,
      isSummarizingTree: false,
      updatedAt: initialUpdatedAt,
    };
  }

  read(conversation: ConversationProjectionSnapshot): SessionViewModel {
    return {
      ...this.#view,
      conversationItems: [...conversation.items],
      queuedFollowUps: [...conversation.queuedFollowUps],
      updatedAt: Math.max(this.#view.updatedAt, conversation.updatedAt),
    };
  }

  rebindSessionId(id: string): void {
    this.#view.id = id;
    this.#touch();
  }

  setStatus(status: SessionRuntimeStatus, error?: string): void {
    this.#view.status = status;
    if (error) this.#view.error = error;
    else delete this.#view.error;
    this.#touch();
  }

  applyState(state: RpcSessionState): void {
    this.#view.model = state.model;
    this.#view.thinkingLevel = state.thinkingLevel;
    this.#view.isStreaming = state.isStreaming;
    this.#view.isCompacting = state.isCompacting;
    if (state.sessionFile) this.#view.sessionFile = state.sessionFile;
    if (state.sessionId) this.#view.sessionId = state.sessionId;
    if (state.sessionName) this.#view.title = state.sessionName;
    this.#view.status = state.isStreaming ? "running" : "ready";
    this.#touch();
  }

  applyEvent(event: RpcEvent): void {
    switch (event.type) {
      case "agent_start":
        this.#view.status = "running";
        this.#view.isStreaming = true;
        break;
      case "agent_settled":
        this.#view.status = "ready";
        this.#view.isStreaming = false;
        break;
      case "compaction_start":
        this.#view.isCompacting = true;
        break;
      case "compaction_end":
        this.#view.isCompacting = false;
        break;
      default:
        return;
    }
    this.#touch();
  }

  setForking(isForking: boolean): void {
    this.#view.isForking = isForking;
    this.#touch();
  }

  setComposerSeed(seed: NonNullable<SessionViewModel["composerSeed"]>): void {
    this.#view.composerSeed = seed;
    this.#touch();
  }

  clearComposerSeed(): void {
    if (!this.#view.composerSeed) return;
    delete this.#view.composerSeed;
    this.#touch();
  }

  setSessionTreeAvailable(available: boolean): void {
    this.#view.sessionTreeAvailable = available;
    this.#touch();
  }

  setNavigatingTree(isNavigatingTree: boolean, isSummarizingTree = false): void {
    this.#view.isNavigatingTree = isNavigatingTree;
    this.#view.isSummarizingTree = isNavigatingTree && isSummarizingTree;
    this.#touch();
  }

  setHistoryStatus(status: SessionViewModel["historyStatus"]): void {
    this.#view.historyStatus = status;
    this.#touch();
  }

  setModels(models: SessionViewModel["availableModels"]): void {
    this.#view.availableModels = models;
    this.#touch();
  }

  setCommands(commands: SessionViewModel["commands"]): void {
    this.#view.commands = commands;
    this.#touch();
  }

  setStats(stats: NonNullable<SessionViewModel["stats"]>): void {
    this.#view.stats = stats;
    this.#touch();
  }

  setCacheHitPercent(cacheHitPercent: number | undefined): void {
    if (cacheHitPercent === undefined) delete this.#view.cacheHitPercent;
    else this.#view.cacheHitPercent = cacheHitPercent;
    this.#touch();
  }

  setTitle(title: string): void {
    this.#view.title = title || "Untitled session";
    this.#touch();
  }

  setNetworkProxy(networkProxy: SessionViewModel["networkProxy"]): void {
    this.#view.networkProxy = networkProxy;
    this.#touch();
  }

  setQuestionTool(questionTool: SessionViewModel["questionTool"]): void {
    this.#view.questionTool = questionTool;
    this.#touch();
  }

  setAttachmentLimits(attachmentLimits: AttachmentLimitsView): void {
    this.#view.attachmentLimits = attachmentLimits;
    this.#touch();
  }

  setCollapseTurnTrace(collapseTurnTrace: boolean): void {
    this.#view.collapseTurnTrace = collapseTurnTrace;
    this.#touch();
  }

  setExtensionUi(
    pending: SessionViewModel["pendingExtensionUi"],
    statuses: SessionViewModel["extensionStatuses"],
    widgets: SessionViewModel["extensionWidgets"],
  ): void {
    this.#view.pendingExtensionUi = pending;
    this.#view.extensionStatuses = statuses;
    this.#view.extensionWidgets = widgets;
    this.#touch();
  }

  #touch(): void {
    this.#view.updatedAt = Math.max(Date.now(), this.#view.updatedAt + 1);
  }
}
