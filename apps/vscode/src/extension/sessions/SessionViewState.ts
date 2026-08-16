import { isDeepStrictEqual } from "node:util";

import type { RpcEvent, RpcSessionState } from "@frostime/pi-rpc";

import type { ConversationProjectionSnapshot } from "../conversation/ConversationProjection.js";
import type {
  AttachmentLimitsView,
  SessionRuntimeStatus,
  SessionViewModel,
} from "../../shared/model/sessionViewModel.js";

type SessionScalarView = Omit<
  SessionViewModel,
  "conversationItems" | "queuedSteers" | "queuedFollowUps" | "conversationContentRevision"
>;

export class SessionViewState {
  readonly #view: SessionScalarView;
  #lastViewStateChangeAt: number;

  constructor(
    id: string,
    cwd: string,
    title: string,
    attachmentLimits: AttachmentLimitsView = { maxImageBytes: 10 * 1024 * 1024, maxImages: 12 },
    initialViewStateChangeAt = Date.now(),
    collapseTurnTrace = true,
    isEphemeral = false,
  ) {
    this.#lastViewStateChangeAt = initialViewStateChangeAt;
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
      scopedModelIds: [],
      commands: [],
      attachmentLimits,
      collapseTurnTrace,
      composerStreamingBehavior: "followUp",
      networkProxy: { mode: "inherit", label: "Inherited", restartRequired: false },
      questionTool: { configuredEnabled: false, appliedEnabled: false, restartRequired: false },
      pendingExtensionUi: [],
      extensionStatuses: [],
      extensionWidgets: [],
      sessionTreeAvailable: false,
      isNavigatingTree: false,
      isSummarizingTree: false,
    };
  }

  get lastViewStateChangeAt(): number {
    return this.#lastViewStateChangeAt;
  }

  read(conversation: ConversationProjectionSnapshot): SessionViewModel {
    return {
      ...this.#view,
      conversationItems: [...conversation.items],
      queuedSteers: [...conversation.queuedSteers],
      queuedFollowUps: [...conversation.queuedFollowUps],
      conversationContentRevision: conversation.contentRevision,
    };
  }

  rebindSessionId(id: string): void {
    this.#view.id = id;
    this.#markViewStateChanged();
  }

  setStatus(status: SessionRuntimeStatus, error?: string): void {
    this.#view.status = status;
    if (error) this.#view.error = error;
    else delete this.#view.error;
    this.#markViewStateChanged();
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
    this.#markViewStateChanged();
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
    this.#markViewStateChanged();
  }

  setForking(isForking: boolean): void {
    this.#view.isForking = isForking;
    this.#markViewStateChanged();
  }

  setComposerSeed(seed: NonNullable<SessionViewModel["composerSeed"]>): void {
    this.#view.composerSeed = seed;
    this.#markViewStateChanged();
  }

  clearComposerSeed(): void {
    if (!this.#view.composerSeed) return;
    delete this.#view.composerSeed;
    this.#markViewStateChanged();
  }

  setSessionTreeAvailable(available: boolean): void {
    this.#view.sessionTreeAvailable = available;
    this.#markViewStateChanged();
  }

  setNavigatingTree(isNavigatingTree: boolean, isSummarizingTree = false): void {
    this.#view.isNavigatingTree = isNavigatingTree;
    this.#view.isSummarizingTree = isNavigatingTree && isSummarizingTree;
    this.#markViewStateChanged();
  }

  setHistoryStatus(status: SessionViewModel["historyStatus"]): void {
    this.#view.historyStatus = status;
    this.#markViewStateChanged();
  }

  setModels(models: SessionViewModel["availableModels"]): void {
    this.#view.availableModels = models;
    this.#markViewStateChanged();
  }

  setScopedModelIds(scopedModelIds: SessionViewModel["scopedModelIds"]): void {
    this.#view.scopedModelIds = [...scopedModelIds];
    this.#markViewStateChanged();
  }

  setCommands(commands: SessionViewModel["commands"]): void {
    this.#view.commands = commands;
    this.#markViewStateChanged();
  }

  updateStats(stats: NonNullable<SessionViewModel["stats"]>): boolean {
    if (isDeepStrictEqual(this.#view.stats, stats)) return false;
    this.#view.stats = stats;
    this.#markViewStateChanged();
    return true;
  }

  setCacheHitPercent(cacheHitPercent: number | undefined): void {
    if (cacheHitPercent === undefined) delete this.#view.cacheHitPercent;
    else this.#view.cacheHitPercent = cacheHitPercent;
    this.#markViewStateChanged();
  }

  setTitle(title: string): void {
    this.#view.title = title || "Untitled session";
    this.#markViewStateChanged();
  }

  setNetworkProxy(networkProxy: SessionViewModel["networkProxy"]): void {
    this.#view.networkProxy = networkProxy;
    this.#markViewStateChanged();
  }

  setQuestionTool(questionTool: SessionViewModel["questionTool"]): void {
    this.#view.questionTool = questionTool;
    this.#markViewStateChanged();
  }

  setAttachmentLimits(attachmentLimits: AttachmentLimitsView): void {
    this.#view.attachmentLimits = attachmentLimits;
    this.#markViewStateChanged();
  }

  setCollapseTurnTrace(collapseTurnTrace: boolean): void {
    this.#view.collapseTurnTrace = collapseTurnTrace;
    this.#markViewStateChanged();
  }

  setComposerStreamingBehavior(streamingBehavior: SessionViewModel["composerStreamingBehavior"]): void {
    this.#view.composerStreamingBehavior = streamingBehavior;
    this.#markViewStateChanged();
  }

  setExtensionUi(
    pending: SessionViewModel["pendingExtensionUi"],
    statuses: SessionViewModel["extensionStatuses"],
    widgets: SessionViewModel["extensionWidgets"],
  ): void {
    this.#view.pendingExtensionUi = pending;
    this.#view.extensionStatuses = statuses;
    this.#view.extensionWidgets = widgets;
    this.#markViewStateChanged();
  }

  #markViewStateChanged(): void {
    this.#lastViewStateChangeAt = Math.max(Date.now(), this.#lastViewStateChangeAt + 1);
  }
}
