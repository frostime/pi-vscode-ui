import { stat } from "node:fs/promises";

import {
  PiRpcApi,
  PiRpcCommandError,
  PiRpcConnection,
  isExtensionUiRequest,
  type RpcEvent,
  type RpcExtensionUiRequest,
  type RpcExtensionUiResponse,
  type RpcModel,
  type RpcSessionEntry,
  type StreamingBehavior,
  type ThinkingLevel,
} from "@frostime/pi-rpc";
import * as vscode from "vscode";

import type { WebviewImageInput } from "../../shared/bridge/webviewToHost.js";
import type { QuestionDraftSubmission } from "../../shared/question-tool/questionToolProtocol.js";
import type { AgentTurnView, ImageAttachmentView } from "../../shared/model/conversationModel.js";
import type { ComposerSeedView, SessionViewModel } from "../../shared/model/sessionViewModel.js";
import { normalizeImageAttachments, validateProjectedImageAttachments } from "../attachments/normalizeImageAttachment.js";
import type { FrostPiConfiguration } from "../configuration/configurationTypes.js";
import { workspaceUriForPath } from "../configuration/workspaceScope.js";
import { ConversationProjection } from "../conversation/ConversationProjection.js";
import { redactDiagnosticText, type DiagnosticLogger } from "../diagnostics/DiagnosticLogger.js";
import { ExtensionUiCoordinator } from "../extension-ui/ExtensionUiCoordinator.js";
import { QuestionToolExtensionBridge } from "../question-tool/QuestionToolExtensionBridge.js";
import { commandName, normalizePiSlashPrompt } from "./normalizePiSlashPrompt.js";
import { configuredPiInvocation } from "../configuration/configuredPiInvocation.js";
import { buildPiProcessEnvironment, proxyFingerprint, proxyModeLabel } from "../network/buildPiProcessEnvironment.js";
import type { ProxySecretStore } from "../network/ProxySecretStore.js";
import { SessionTreeExtensionBridge, type SessionTreeSummaryOptions } from "./tree/SessionTreeExtensionBridge.js";
import {
  buildSessionTreeIndex,
  projectActiveBranchEdges,
  projectBranchEndChoices,
  projectEditableTarget,
  type BranchEndChoiceProjection,
} from "./tree/sessionTreeProjection.js";
import { SessionEntryState } from "./SessionEntryState.js";
import { resolvePiModelScope } from "../models/resolvePiModelScope.js";
import { SessionViewState } from "./SessionViewState.js";

export interface SessionRuntimeHooks {
  onChange(runtime: SessionRuntime): void;
  onEditorText(runtime: SessionRuntime, text: string): void;
  onAgentTurnCompleted?(runtime: SessionRuntime): void;
  onExtensionCommandCompletionUnconfirmed?(runtime: SessionRuntime, message: string): void;
}

export type ForkExecutionResult =
  | { cancelled: true }
  | { cancelled: false; text: string; images: ImageAttachmentView[] };

export class SessionRuntime {
  readonly #conversation: ConversationProjection;
  readonly #entries = new SessionEntryState();
  readonly #viewState: SessionViewState;
  readonly #configurationProvider: () => FrostPiConfiguration;
  readonly #proxySecrets: ProxySecretStore;
  readonly #logger: DiagnosticLogger;
  readonly #hooks: SessionRuntimeHooks;

  #id: string;
  #connection: PiRpcConnection | null = null;
  #api: PiRpcApi | null = null;
  #extensionUi: ExtensionUiCoordinator | null = null;
  #starting: Promise<void> | null = null;
  #historyLoading: Promise<void> | null = null;
  #historyEventBuffer: RpcEvent[] | null = null;
  #disposed = false;
  #lifecycleVersion = 0;
  #liveStatsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  #liveStatsRefreshVersion = 0;
  #appliedProxyFingerprint: string | null = null;
  #proxyRestartForced = false;
  #appliedQuestionToolEnabled: boolean | null = null;
  #abortRequested = false;
  readonly #sessionTreeBridge: SessionTreeExtensionBridge | null;
  readonly #questionToolBridge: QuestionToolExtensionBridge | null;

  constructor(
    id: string,
    readonly cwd: string,
    title: string,
    updatedAt: number,
    configurationProvider: () => FrostPiConfiguration,
    proxySecrets: ProxySecretStore,
    logger: DiagnosticLogger,
    hooks: SessionRuntimeHooks,
    sessionTreeArtifactPath?: string,
    questionToolArtifactPath?: string,
    readonly isEphemeral = false,
  ) {
    this.#id = id;
    const initialConfiguration = configurationProvider();
    this.#conversation = new ConversationProjection(initialConfiguration.maxImageBytes, 12);
    this.#viewState = new SessionViewState(id, cwd, title, {
      maxImageBytes: initialConfiguration.maxImageBytes,
      maxImages: 12,
    }, updatedAt, initialConfiguration.collapseTurnTrace, isEphemeral);
    this.#viewState.setComposerStreamingBehavior(initialConfiguration.streamingBehavior);
    this.#viewState.setQuestionTool({
      configuredEnabled: initialConfiguration.questionToolEnabled,
      appliedEnabled: initialConfiguration.questionToolEnabled,
      restartRequired: false,
    });
    this.#configurationProvider = configurationProvider;
    this.#proxySecrets = proxySecrets;
    this.#logger = logger;
    this.#hooks = hooks;
    this.#sessionTreeBridge = sessionTreeArtifactPath ? new SessionTreeExtensionBridge(sessionTreeArtifactPath) : null;
    this.#questionToolBridge = questionToolArtifactPath ? new QuestionToolExtensionBridge(questionToolArtifactPath) : null;
  }

  get id(): string {
    return this.#id;
  }

  get view(): Readonly<SessionViewModel> {
    return this.#viewState.read(this.#conversation.read());
  }

  get snapshot(): SessionViewModel {
    return structuredClone(this.view);
  }

  get sessionFile(): string | undefined {
    return this.view.sessionFile;
  }

  markWaitingToStart(): void {
    if (this.#disposed || this.#connection?.started || this.#starting) return;
    this.#viewState.setStatus("queued");
    this.#notifyChange();
  }

  async start(sessionFile?: string): Promise<void> {
    if (this.#disposed) throw new Error("Session runtime is disposed");
    if (this.#starting) return this.#starting;
    if (this.#connection?.started) return;

    const lifecycleVersion = ++this.#lifecycleVersion;
    this.#viewState.setHistoryStatus(sessionFile ? "queued" : "loaded");
    if (sessionFile) this.#entries.reset();
    else this.#entries.replace([], null);
    this.#starting = this.#startInternal(sessionFile, lifecycleVersion).finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  async stop(): Promise<void> {
    this.#lifecycleVersion += 1;
    this.#conversation.finalizeLiveState();
    this.#viewState.setStatus("stopping");
    this.#stopLiveStatsRefresh();
    this.#notifyChange();
    await this.#extensionUi?.cancelAll();
    await this.#connection?.stop();
    await Promise.all([
      this.#sessionTreeBridge?.dispose(),
      this.#questionToolBridge?.dispose(),
    ]);
    this.#connection = null;
    this.#api = null;
    this.#extensionUi = null;
    this.#historyEventBuffer = null;
    this.#entries.reset();
    this.#appliedProxyFingerprint = null;
    this.#proxyRestartForced = false;
    this.#appliedQuestionToolEnabled = null;
    // Local queue bubbles are ephemeral; a dead process cannot promote them.
    this.#conversation.clearQueuedPrompts();
    this.#viewState.setForking(false);
    this.#viewState.setStatus("stopped");
    this.refreshConfigurationState(false);
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    await this.stop();
  }

  async sendPrompt(text: string, images: WebviewImageInput[], requestedStreamingBehavior?: StreamingBehavior): Promise<void> {
    if (this.view.isForking) throw new Error("Wait for the session fork to finish before sending a prompt.");
    const api = this.#requireApi();
    const configuration = this.#configurationProvider();
    const normalizedImages = normalizeImageAttachments(images, configuration.maxImageBytes);
    // Pi extension matching requires a leading "/" and splits the name only on ASCII space (indexOf(" ")).
    // Normalize so composer/completion/paste whitespace cannot turn "/cmd args" into a model prompt.
    const message = normalizePiSlashPrompt(text);
    if (!message && normalizedImages.length === 0) return;

    const extensionCommand = await this.#resolveImmediateExtensionCommand(message);
    // Park while streaming or while an earlier prompt still awaits promotion; otherwise an idle-gap
    // appendUserPrompt can steal the next agent_start and leave queue bubbles stuck.
    const hasQueuedPrompts = this.view.queuedSteers.length > 0 || this.view.queuedFollowUps.length > 0;
    const queuePrompt = !extensionCommand && (this.view.isStreaming || hasQueuedPrompts);

    if (queuePrompt) {
      const streamingBehavior = requestedStreamingBehavior ?? configuration.streamingBehavior;
      const queuedId = streamingBehavior === "steer"
        ? this.#conversation.enqueueSteer(message, images)
        : this.#conversation.enqueueFollowUp(message, images);
      this.#notifyChange();
      try {
        await api.prompt(message, {
          ...(normalizedImages.length ? { images: normalizedImages } : {}),
          streamingBehavior,
        });
      } catch (error) {
        this.#conversation.removeQueuedPrompt(queuedId);
        this.#conversation.appendNotice(errorMessage(error), "error");
        this.#notifyChange();
        throw error;
      }
      return;
    }

    const turnId = this.#conversation.appendUserPrompt(message, images);
    this.#notifyChange();

    try {
      await api.prompt(message, {
        ...(normalizedImages.length ? { images: normalizedImages } : {}),
      });
      if (extensionCommand) await this.#finishImmediateExtensionCommand(turnId);
    } catch (error) {
      if (extensionCommand && isExtensionCommandCompletionUnconfirmed(error)) {
        const warning = extensionCommandCompletionUnconfirmedMessage(extensionCommand);
        this.#conversation.appendNotice(warning, "warning");
        this.#conversation.completeTurn(turnId);
        this.#hooks.onExtensionCommandCompletionUnconfirmed?.(this, warning);
        this.#notifyChange();
        return;
      }
      const messageText = errorMessage(error);
      this.#conversation.appendNotice(messageText, "error");
      if (!this.view.isStreaming) this.#conversation.completeTurn(turnId, "error");
      this.#notifyChange();
      throw error;
    }
  }

  async compact(customInstructions?: string): Promise<void> {
    await this.#requireApi().compact(customInstructions);
  }

  async abort(): Promise<void> {
    await this.#extensionUi?.cancelAll();
    this.#abortRequested = true;
    try {
      await this.#requireApi().abort();
    } catch (error) {
      this.#abortRequested = false;
      throw error;
    }
    // Abort cancels the active run; pending local queue UI is no longer trustworthy.
    this.#conversation.clearQueuedPrompts();
    this.#notifyChange();
  }

  async listBranchEnds(branchPointId: string | null): Promise<BranchEndChoiceProjection[]> {
    if (!this.#sessionTreeBridge?.available) throw new Error("Session tree navigation is unavailable in this Pi process. Update Pi, restart the session, and check FrostPi diagnostics.");
    if (this.view.historyStatus !== "loaded") throw new Error("Load conversation history before switching branches.");
    const entryData = await this.#requireApi().getEntries();
    return projectBranchEndChoices(buildSessionTreeIndex(entryData.entries, entryData.leafId), branchPointId);
  }

  async navigateTree(targetId: string, summary: SessionTreeSummaryOptions): Promise<{ cancelled: boolean; seed?: ComposerSeedView }> {
    if (!this.#sessionTreeBridge?.available) throw new Error("Session tree navigation is unavailable in this Pi process. Update Pi, restart the session, and check FrostPi diagnostics.");
    if (this.view.status !== "ready" || this.view.isStreaming || this.view.isCompacting) throw new Error("Wait for the current Pi operation to finish before switching branches.");
    if (this.view.historyStatus !== "loaded") throw new Error("Load conversation history before switching branches.");
    if (this.view.pendingExtensionUi.length > 0 || this.view.queuedSteers.length > 0 || this.view.queuedFollowUps.length > 0) throw new Error("Wait for the current Pi interaction to finish before switching branches.");

    const api = this.#requireApi();
    const beforeNavigation = await api.getEntries();
    const target = beforeNavigation.entries.find((entry) => entry.id === targetId);
    if (!target) throw new Error("The selected session-tree entry is no longer available.");
    const projected = projectEditableTarget(target);
    const seed = projected ? {
      id: `tree-${targetId}`,
      text: projected.text,
      images: validateProjectedImageAttachments(projected.images, this.view.attachmentLimits.maxImages, this.#configurationProvider().maxImageBytes),
    } : undefined;

    let committed = false;
    this.#viewState.setNavigatingTree(true, summary.summarize);
    this.#notifyChange();
    try {
      const result = await this.#sessionTreeBridge.navigate(api, targetId, summary);
      if (result.status === "cancelled") return { cancelled: true };
      committed = true;
      const entryData = await api.getEntries();
      const [state, stats] = await Promise.all([
        api.getState(),
        api.getSessionStats().catch(() => undefined),
      ]);
      this.#viewState.applyState(state);
      this.#replacePersistedEntries(entryData.entries, entryData.leafId);
      if (stats) this.#viewState.setStats(stats);
      return seed ? { cancelled: false, seed } : { cancelled: false };
    } catch (error) {
      if (committed) {
        this.#viewState.setHistoryStatus("failed");
        this.#conversation.appendNotice(`Unable to reload the committed session branch: ${errorMessage(error)}`, "error");
      }
      throw error;
    } finally {
      this.#viewState.setNavigatingTree(false);
      this.#notifyChange();
    }
  }

  async executeFork(entryId: string): Promise<ForkExecutionResult> {
    if (this.view.status !== "ready" || this.view.isStreaming || this.view.isCompacting) {
      throw new Error("Wait for the current Pi operation to finish before forking.");
    }
    if (this.view.historyStatus !== "loaded") throw new Error("Load conversation history before forking a message.");
    if (this.view.pendingExtensionUi.length > 0) throw new Error("Answer the pending Pi request before forking.");
    if (this.view.queuedSteers.length > 0 || this.view.queuedFollowUps.length > 0) throw new Error("Wait for queued prompts to settle before forking.");
    const selectedMessage = this.#conversation.userMessage(entryId);
    if (!selectedMessage) throw new Error("The selected message is no longer available for forking.");
    const projectedImages = selectedMessage.blocks.flatMap((block) => block.type === "images" ? block.images : []);
    const images = validateProjectedImageAttachments(
      projectedImages,
      this.view.attachmentLimits.maxImages,
      this.#configurationProvider().maxImageBytes,
    );

    const previousExtensionUi = this.#extensionUi?.snapshot();
    this.#extensionUi?.clearSessionDecorations();
    this.#viewState.setForking(true);
    this.#notifyChange();
    try {
      const result = await this.#requireApi().fork(entryId);
      if (result.cancelled) {
        if (previousExtensionUi) this.#restoreForkDecorations(previousExtensionUi);
        this.#viewState.setForking(false);
        this.#notifyChange();
        return { cancelled: true };
      }
      return { cancelled: false, text: result.text, images };
    } catch (error) {
      if (previousExtensionUi) this.#restoreForkDecorations(previousExtensionUi);
      this.#viewState.setForking(false);
      this.#notifyChange();
      throw error;
    }
  }

  async reconcileFork(name: string, composerSeed: ComposerSeedView): Promise<void> {
    const api = this.#requireApi();
    await api.setSessionName(name);
    const state = await api.getState();
    const [entryData, stats, commands] = await Promise.all([
      api.getEntries(),
      api.getSessionStats().catch(() => undefined),
      api.getCommands().catch(() => undefined),
    ]);
    this.#viewState.applyState(state);
    this.#replacePersistedEntries(entryData.entries, entryData.leafId);
    if (stats) this.#viewState.setStats(stats);
    if (commands) this.#viewState.setCommands(this.#sessionTreeBridge?.discover(commands) ?? commands);
    this.#viewState.setComposerSeed(composerSeed);
    this.#viewState.setForking(false);
    this.#notifyChange();
  }

  rebindSessionId(id: string): void {
    if (this.#starting || this.#historyLoading) throw new Error("Cannot replace a session identity while lifecycle work is pending.");
    // Registry rekeys its maps around this call; emitting midway would expose mismatched identities.
    this.#id = id;
    this.#viewState.rebindSessionId(id);
  }

  setComposerSeed(seed: ComposerSeedView): void {
    this.#viewState.setComposerSeed(seed);
    this.#notifyChange();
  }

  clearComposerSeed(): void {
    this.#viewState.clearComposerSeed();
    this.#notifyChange();
  }

  setDisplayTitle(title: string): void {
    this.#viewState.setTitle(title);
    this.#notifyChange();
  }

  async rename(name: string): Promise<void> {
    const normalized = name.trim();
    await this.#requireApi().setSessionName(normalized);
    this.#viewState.setTitle(normalized || "Untitled session");
    this.#notifyChange();
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    const model = await this.#requireApi().setModel(provider, modelId);
    const state = await this.#requireApi().getState();
    this.#viewState.applyState({ ...state, model });
    this.#notifyChange();
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    await this.#requireApi().setThinkingLevel(level);
    const state = await this.#requireApi().getState();
    this.#viewState.applyState(state);
    this.#notifyChange();
  }

  async refreshModels(): Promise<RpcModel[]> {
    const models = await this.#requireApi().getAvailableModels();
    const scopedModelIds = await resolvePiModelScope(this.cwd, this.#configurationProvider().piArguments, models);
    this.#viewState.setModels(models);
    this.#viewState.setScopedModelIds(scopedModelIds);
    this.#notifyChange();
    return models;
  }

  async refreshCommands(): Promise<void> {
    const commands = await this.#requireApi().getCommands();
    this.#viewState.setCommands(this.#sessionTreeBridge?.discover(commands) ?? commands);
    this.#notifyChange();
  }

  async probePiIntegration(): Promise<{ available: boolean; commandName: string | null }> {
    const commands = await this.#requireApi().getCommands();
    this.#viewState.setCommands(this.#sessionTreeBridge?.discover(commands) ?? commands);
    this.#viewState.setSessionTreeAvailable(this.#sessionTreeBridge?.available ?? false);
    this.#notifyChange();
    return {
      available: this.#sessionTreeBridge?.available ?? false,
      commandName: this.#sessionTreeBridge?.commandName ?? null,
    };
  }

  markHistoryWaiting(): void {
    this.#viewState.setHistoryStatus("queued");
    this.#notifyChange();
  }

  async loadHistory(force = false): Promise<void> {
    const activeLoad = this.#historyLoading;
    if (activeLoad) {
      try {
        await activeLoad;
      } catch (error) {
        if (!force) throw error;
      }
      if (!force || this.view.historyStatus === "loaded") return;
      return this.loadHistory(true);
    }
    const api = this.#requireApi();
    const sessionFile = this.view.sessionFile;
    if (!sessionFile) {
      this.#viewState.setHistoryStatus("loaded");
      this.#notifyChange();
      return;
    }

    this.#historyLoading = this.#loadHistoryInternal(api, sessionFile, force).finally(() => {
      this.#historyLoading = null;
    });
    return this.#historyLoading;
  }

  async respondExtensionUi(requestId: string, response: RpcExtensionUiResponse): Promise<void> {
    await this.#extensionUi?.respond(requestId, response);
  }

  async respondQuestion(requestId: string, response: QuestionDraftSubmission | { cancelled: true }): Promise<void> {
    const coordinator = this.#extensionUi;
    if (!coordinator) throw new Error("Question request is no longer pending.");
    const pending = coordinator.pending(requestId);
    if (!pending || pending.method !== "question") throw new Error("Question request is no longer pending.");
    if ("cancelled" in response) {
      await coordinator.respond(requestId, { cancelled: true });
      return;
    }
    if (!this.#questionToolBridge) throw new Error("FrostPi Question tool is unavailable.");
    await coordinator.respond(requestId, { value: this.#questionToolBridge.responseValue(pending, response) });
  }

  refreshConfigurationState(forceRestartRequired = false): void {
    const configuration = this.#configurationProvider();
    const vscodeProxy = readVsCodeProxy(this.cwd);
    const fingerprint = proxyFingerprint(configuration.proxy, vscodeProxy);
    const running = Boolean(this.#connection?.started);
    if (running && forceRestartRequired) this.#proxyRestartForced = true;
    const restartRequired = running && (this.#proxyRestartForced || (this.#appliedProxyFingerprint !== null && fingerprint !== this.#appliedProxyFingerprint));
    const configuredLabel = proxyModeLabel(configuration.proxy.mode);
    const appliedLabel = running ? this.view.networkProxy.label : configuredLabel;
    this.#conversation.setImageLimits(configuration.maxImageBytes, 12);
    this.#viewState.setAttachmentLimits({ maxImageBytes: configuration.maxImageBytes, maxImages: 12 });
    this.#viewState.setCollapseTurnTrace(configuration.collapseTurnTrace);
    this.#viewState.setComposerStreamingBehavior(configuration.streamingBehavior);
    this.#viewState.setNetworkProxy({
      mode: configuration.proxy.mode,
      label: appliedLabel,
      ...(restartRequired ? { pendingLabel: configuredLabel } : {}),
      restartRequired,
    });
    const appliedQuestionToolEnabled = running
      ? this.#appliedQuestionToolEnabled ?? false
      : configuration.questionToolEnabled;
    this.#viewState.setQuestionTool({
      configuredEnabled: configuration.questionToolEnabled,
      appliedEnabled: appliedQuestionToolEnabled,
      restartRequired: running && appliedQuestionToolEnabled !== configuration.questionToolEnabled,
    });
    this.#notifyChange();
  }

  diagnosticsSummary(): string {
    const view = this.view;
    return [
      `Session ${view.id}`,
      `Title: ${view.title}`,
      `CWD: ${view.cwd}`,
      `Status: ${view.status}`,
      `Streaming: ${view.isStreaming}`,
      `Session file: ${view.sessionFile ?? "<none>"}`,
      `Model: ${view.model ? `${view.model.provider}/${view.model.id}` : "<none>"}`,
      `Thinking: ${view.thinkingLevel}`,
      `Proxy: ${view.networkProxy.label}${view.networkProxy.restartRequired ? ` → ${view.networkProxy.pendingLabel ?? proxyModeLabel(view.networkProxy.mode)} after restart` : ""}`,
      `Question tool: ${view.questionTool.appliedEnabled ? "enabled" : "disabled"}${view.questionTool.restartRequired ? ` → ${view.questionTool.configuredEnabled ? "enabled" : "disabled"} after restart` : ""}`,
      `Turns: ${conversationTurns(view).length}`,
      `Tool calls: ${conversationTurns(view).reduce((count, turn) => count + turn.items.filter((item) => item.type === "tool").length, 0)}`,
      `Pending extension UI: ${view.pendingExtensionUi.length}`,
      `Last error: ${view.error ?? "<none>"}`,
      `Pi stderr tail: ${redactDiagnosticText(this.#connection?.getStderr() || "<empty>")}`,
    ].join("\n");
  }

  async #startInternal(sessionFile: string | undefined, lifecycleVersion: number): Promise<void> {
    this.#viewState.setStatus("starting");
    this.#notifyChange();

    const configuration = this.#configurationProvider();
    const invocation = configuredPiInvocation(configuration.piExecutable);
    await this.#sessionTreeBridge?.prepare();
    if (configuration.questionToolEnabled) await this.#questionToolBridge?.prepare();
    const args = [
      ...configuration.piArguments,
      ...(this.isEphemeral ? ["--no-session"] : sessionFile ? ["--session", sessionFile] : []),
      ...(this.#sessionTreeBridge?.launchArguments() ?? []),
      ...(configuration.questionToolEnabled ? this.#questionToolBridge?.launchArguments() ?? [] : []),
    ];
    const vscodeProxy = readVsCodeProxy(this.cwd);
    const credentials = await this.#proxySecrets.get();
    if (this.#disposed || lifecycleVersion !== this.#lifecycleVersion) return;
    const proxyEnvironment = buildPiProcessEnvironment(configuration.proxy, credentials, vscodeProxy);
    const frostpiExtension = vscode.extensions.getExtension("frostime.frostpi");
    const frostpiVersion = (frostpiExtension?.packageJSON as { version?: string } | undefined)?.version ?? "unknown";
    const connection = new PiRpcConnection({
      cwd: this.cwd,
      args,
      env: {
        PI_INSIDE_FROSTPI: "1",
        PI_INSIDE_FROSTPI_VERSION: frostpiVersion,
        ...proxyEnvironment.env,
        ...(this.#sessionTreeBridge?.launchEnvironment() ?? {}),
        ...(configuration.questionToolEnabled ? this.#questionToolBridge?.launchEnvironment() ?? {} : {}),
      },
      ...invocation,
      requestTimeoutMs: 30_000,
      startupTimeoutMs: 45_000,
      stopTimeoutMs: 1_500,
    });
    const api = new PiRpcApi(connection);
    this.#connection = connection;
    this.#api = api;
    this.#extensionUi = new ExtensionUiCoordinator(api, {
      onChange: () => {
        this.#syncExtensionUiSnapshot();
        this.#notifyChange();
      },
      onNotify: (level, message) => this.#conversation.appendNotice(message, level),
      onTitle: (title) => {
        this.#viewState.setTitle(title);
        this.#notifyChange();
      },
      onEditorText: (text) => this.#hooks.onEditorText(this, text),
    });

    connection.onEvent((event) => {
      if (this.#historyEventBuffer && shouldBufferDuringHistoryLoad(event)) {
        this.#historyEventBuffer.push(event);
        return;
      }
      this.#applyConnectionEvent(event);
      this.#notifyChange();
    });
    connection.onFailure((error) => {
      this.#logger.error(`Session ${this.id} failed`, error);
      this.#stopLiveStatsRefresh();
      this.#conversation.finalizeLiveState();
      this.#conversation.clearQueuedPrompts();
      this.#viewState.setStatus("failed", errorMessage(error));
      this.#notifyChange();
    });
    connection.onExit(({ code, signal }) => {
      this.#logger.info(`Session ${this.id} Pi process exited (code=${code} signal=${signal})`);
    });

    try {
      const state = await connection.start();
      if (this.#disposed || lifecycleVersion !== this.#lifecycleVersion) {
        await connection.stop();
        return;
      }
      this.#appliedProxyFingerprint = proxyFingerprint(configuration.proxy, vscodeProxy);
      this.#proxyRestartForced = false;
      this.#appliedQuestionToolEnabled = configuration.questionToolEnabled;
      this.#viewState.setNetworkProxy({ mode: configuration.proxy.mode, label: proxyEnvironment.label, restartRequired: false });
      this.#viewState.applyState(state);
      this.#logger.info(`Started Pi session ${this.id} in ${this.cwd}`);
      this.#notifyChange();
      void this.#loadSessionInformation(api);
    } catch (error) {
      if (this.#disposed || lifecycleVersion !== this.#lifecycleVersion) return;
      const message = errorMessage(error);
      this.#viewState.setStatus("failed", message);
      this.#logger.error(`Failed to start Pi session ${this.id}`, error);
      this.#notifyChange();
      throw error;
    }
  }

  async #loadSessionInformation(api: PiRpcApi): Promise<void> {
    const [models, commands, stats] = await Promise.all([
      api.getAvailableModels().catch((error) => {
        this.#logger.error("Failed to load Pi models", error);
        return [];
      }),
      api.getCommands().catch((error) => {
        this.#logger.error("Failed to load Pi commands", error);
        return [];
      }),
      api.getSessionStats().catch(() => undefined),
    ]);
    if (this.#disposed || api !== this.#api) return;
    const scopedModelIds = await resolvePiModelScope(this.cwd, this.#configurationProvider().piArguments, models);
    if (this.#disposed || api !== this.#api) return;
    this.#viewState.setModels(models);
    this.#viewState.setScopedModelIds(scopedModelIds);
    this.#viewState.setCommands(this.#sessionTreeBridge?.discover(commands) ?? commands);
    if (stats) this.#viewState.setStats(stats);
    this.#viewState.setSessionTreeAvailable(this.#sessionTreeBridge?.available ?? false);
    if (this.#entries.initialized) {
      await this.#refreshPersistedEntries(api).catch((error) => {
        this.#logger.error("Failed to initialize Pi session entries", error);
      });
    }
    this.#notifyChange();
  }

  async #loadHistoryInternal(api: PiRpcApi, sessionFile: string, force: boolean): Promise<void> {
    if (this.view.isStreaming) {
      this.#viewState.setHistoryStatus("deferred");
      this.#notifyChange();
      throw new Error("Stop the running session before loading its conversation history.");
    }

    try {
      if (!force && (await stat(sessionFile)).size > MAX_AUTO_HISTORY_LOAD_BYTES) {
        this.#viewState.setHistoryStatus("deferred");
        this.#conversation.appendNotice("Conversation history is large and was not loaded automatically.", "info");
        this.#notifyChange();
        return;
      }
      this.#viewState.setHistoryStatus("loading");
      this.#historyEventBuffer = [];
      this.#notifyChange();
      const entryData = await api.getEntries();
      const bufferedEvents = this.#takeHistoryEvents();
      if (this.#disposed || api !== this.#api) return;
      this.#replacePersistedEntries(entryData.entries, entryData.leafId);
      for (const event of bufferedEvents) this.#applyConnectionEvent(event);
      this.#notifyChange();
    } catch (error) {
      const bufferedEvents = this.#takeHistoryEvents();
      if (this.#disposed || api !== this.#api) return;
      for (const event of bufferedEvents) this.#applyConnectionEvent(event);
      this.#logger.error("Failed to load Pi session entries", error);
      this.#viewState.setHistoryStatus("failed");
      this.#conversation.appendNotice(`Unable to load conversation history: ${errorMessage(error)}`, "error");
      this.#notifyChange();
      throw error;
    }
  }

  #takeHistoryEvents(): RpcEvent[] {
    const events = this.#historyEventBuffer ?? [];
    this.#historyEventBuffer = null;
    return events;
  }

  #applyConnectionEvent(event: RpcEvent): void {
    const latestTurn = event.type === "agent_settled" ? conversationTurns(this.view).at(-1) : undefined;
    const settlingTurnId = this.view.isStreaming ? latestTurn?.id : undefined;
    const abortRequested = this.#abortRequested;
    if (isExtensionUiRequest(event)) {
      if (this.#questionToolBridge?.recognizes(event)) void this.#handleQuestionUiRequest(event);
      else this.#extensionUi?.handle(event);
    } else {
      this.#viewState.applyEvent(event);
      this.#conversation.applyEvent(event);
      if (event.type === "compaction_end" && typeof event.errorMessage === "string") {
        this.#conversation.appendNotice(event.errorMessage, "error");
      }
    }
    if (event.type === "agent_start") {
      this.#abortRequested = false;
      this.#startLiveStatsRefresh();
    }
    if (event.type === "agent_settled") {
      this.#abortRequested = false;
      this.#stopLiveStatsRefresh();
      const settledTurn = settlingTurnId ? conversationTurns(this.view).find((turn) => turn.id === settlingTurnId) : undefined;
      if (!abortRequested && settledTurn?.status === "completed") this.#hooks.onAgentTurnCompleted?.(this);
      void this.#refreshAfterSettled();
    }
    if (event.type === "compaction_end") void this.#refreshAfterCompaction();
  }

  async #handleQuestionUiRequest(request: RpcExtensionUiRequest): Promise<void> {
    const bridge = this.#questionToolBridge;
    const coordinator = this.#extensionUi;
    const api = this.#api;
    if (!bridge || !coordinator || !api) return;
    try {
      const pending = await bridge.resolve(request);
      if (bridge !== this.#questionToolBridge || coordinator !== this.#extensionUi || api !== this.#api) return;
      coordinator.addPending(pending, request.timeout);
    } catch (error) {
      this.#logger.error("Rejected FrostPi Question request", error);
      this.#conversation.appendNotice(`Unable to open FrostPi Question UI: ${errorMessage(error)}`, "error");
      this.#notifyChange();
      await api.sendExtensionUiResponse(request.id, { cancelled: true }).catch(() => undefined);
    }
  }

  async #refreshAfterCompaction(): Promise<void> {
    const api = this.#api;
    if (!api) return;
    const stats = await api.getSessionStats().catch(() => undefined);
    if (this.#disposed || api !== this.#api) return;
    if (stats) this.#viewState.setStats(stats);
    await this.#refreshPersistedEntries(api).catch((error) => {
      this.#reportEntryRefreshFailure("Failed to reconcile Pi entries after compaction", error);
    });
    this.#notifyChange();
  }

  #startLiveStatsRefresh(): void {
    if (this.#liveStatsRefreshTimer) return;
    this.#scheduleLiveStatsRefresh();
  }

  #stopLiveStatsRefresh(): void {
    this.#liveStatsRefreshVersion += 1;
    if (this.#liveStatsRefreshTimer) clearTimeout(this.#liveStatsRefreshTimer);
    this.#liveStatsRefreshTimer = null;
  }

  #scheduleLiveStatsRefresh(): void {
    const version = this.#liveStatsRefreshVersion;
    this.#liveStatsRefreshTimer = setTimeout(() => {
      this.#liveStatsRefreshTimer = null;
      void this.#refreshLiveStats(version);
    }, LIVE_STATS_REFRESH_INTERVAL_MS);
  }

  async #refreshLiveStats(version: number): Promise<void> {
    const api = this.#api;
    if (!api || this.#disposed || version !== this.#liveStatsRefreshVersion || !this.view.isStreaming) return;
    const stats = await api.getSessionStats().catch(() => undefined);
    if (this.#disposed || api !== this.#api || version !== this.#liveStatsRefreshVersion || !this.view.isStreaming) return;
    if (stats) {
      this.#viewState.setStats(stats);
      this.#notifyChange();
    }
    this.#scheduleLiveStatsRefresh();
  }

  async #refreshAfterSettled(): Promise<void> {
    const api = this.#api;
    if (!api) return;
    const [state, stats, commands] = await Promise.all([
      api.getState().catch(() => undefined),
      api.getSessionStats().catch(() => undefined),
      api.getCommands().catch(() => undefined),
    ]);
    if (state) this.#viewState.applyState(state);
    if (stats) this.#viewState.setStats(stats);
    if (commands) this.#viewState.setCommands(this.#sessionTreeBridge?.discover(commands) ?? commands);
    await this.#refreshPersistedEntries(api).catch((error) => {
      this.#reportEntryRefreshFailure("Failed to reconcile Pi session entries", error);
    });
    this.#notifyChange();
  }

  async #refreshPersistedEntries(api: PiRpcApi): Promise<void> {
    if (!this.#entries.initialized) return;
    const incremental = await api.getEntries(this.#entries.cursor ?? undefined);
    if (this.#disposed || api !== this.#api) return;

    const update = this.#entries.applyIncrement(incremental.entries, incremental.leafId);
    if (update.kind === "append") {
      const edges = projectActiveBranchEdges(update.index);
      if (this.#conversation.reconcileEntries(update.activePathAppend, edges) === "applied") {
        const cacheHit = latestAssistantCacheHit(update.activePathAppend);
        if (cacheHit.found) this.#viewState.setCacheHitPercent(cacheHit.percent);
        return;
      }
    }

    const complete = await api.getEntries();
    if (this.#disposed || api !== this.#api) return;
    this.#replacePersistedEntries(complete.entries, complete.leafId);
  }

  #replacePersistedEntries(
    entries: Awaited<ReturnType<PiRpcApi["getEntries"]>>["entries"],
    leafId: string | null,
  ): void {
    const replacement = this.#entries.replace(entries, leafId);
    this.#conversation.replaceEntries(replacement.activePath, projectActiveBranchEdges(replacement.index));
    this.#viewState.setCacheHitPercent(latestAssistantCacheHit(replacement.activePath).percent);
    this.#viewState.setHistoryStatus("loaded");
    this.#viewState.setSessionTreeAvailable(this.#sessionTreeBridge?.available ?? false);
  }

  async #resolveImmediateExtensionCommand(message: string): Promise<string | undefined> {
    const name = commandName(message);
    if (!name) return undefined;

    const cached = this.view.commands.find((command) => command.name === name);
    if (cached) return cached.source === "extension" ? name : undefined;

    // Name miss only: command lists load asynchronously after startup; refresh once, then classify.
    try {
      const commands = await this.#requireApi().getCommands();
      const visibleCommands = this.#sessionTreeBridge?.discover(commands) ?? commands;
      this.#viewState.setCommands(visibleCommands);
      this.#notifyChange();
      const found = visibleCommands.find((command) => command.name === name);
      return found?.source === "extension" ? name : undefined;
    } catch {
      // Discovery is best-effort; Pi still receives the raw slash text.
    }
    return undefined;
  }

  /**
   * Extension commands execute inside prompt() and often never emit agent_start/agent_settled.
   * After the prompt RPC returns, close the turn opened for this command once Pi looks idle
   * (same pattern as pi-acp's multi-delay reconcile; PiDeck uses a single delayed get_state).
   */
  async #finishImmediateExtensionCommand(turnId: string): Promise<void> {
    if (this.#disposed || this.view.isStreaming) return;

    let idleState: Awaited<ReturnType<PiRpcApi["getState"]>> | undefined;
    let sawSuccessfulIdleState = false;

    for (const delayMs of EXTENSION_COMMAND_IDLE_CHECK_DELAYS_MS) {
      if (delayMs > 0) await delay(delayMs);
      if (this.#disposed || this.view.isStreaming) return;
      if (!this.#turnStillRunning(turnId)) return;

      const api = this.#api;
      if (!api) return;
      const state = await api.getState().catch(() => undefined);
      if (this.#disposed || api !== this.#api) return;
      if (this.view.isStreaming || !this.#turnStillRunning(turnId)) return;
      if (!state) continue;
      if (state.isStreaming || state.isCompacting || (state.pendingMessageCount ?? 0) > 0) return;

      idleState = state;
      sawSuccessfulIdleState = true;
      break;
    }

    if (this.#disposed || this.view.isStreaming || !this.#turnStillRunning(turnId)) return;
    // If every get_state failed but the local session never entered an agent run, still close the turn
    // so extension-command UX cannot stick on running forever.
    if (!sawSuccessfulIdleState && !this.view.isStreaming) {
      this.#conversation.completeTurn(turnId, "completed");
      const api = this.#api;
      if (api) await this.#refreshPersistedEntries(api).catch((error) => {
        this.#reportEntryRefreshFailure("Failed to reconcile entries after extension command", error);
      });
      this.#notifyChange();
      return;
    }
    if (!idleState) return;

    this.#conversation.completeTurn(turnId, "completed");
    this.#viewState.applyState(idleState);
    const api = this.#api;
    if (api) await this.#refreshPersistedEntries(api).catch((error) => {
      this.#reportEntryRefreshFailure("Failed to reconcile entries after extension command", error);
    });
    this.#notifyChange();
  }

  #reportEntryRefreshFailure(logMessage: string, error: unknown): void {
    this.#logger.error(logMessage, error);
    this.#viewState.setHistoryStatus("failed");
    this.#conversation.appendNotice(`Unable to reconcile conversation history: ${errorMessage(error)}`, "error");
  }

  #turnStillRunning(turnId: string): boolean {
    return conversationTurns(this.view).some((turn) => turn.id === turnId && turn.status === "running");
  }

  #requireApi(): PiRpcApi {
    if (!this.#api || !this.#connection?.started) throw new Error("Pi session is not running");
    return this.#api;
  }

  #syncExtensionUiSnapshot(): void {
    const snapshot = this.#extensionUi?.snapshot();
    if (!snapshot) return;
    this.#viewState.setExtensionUi(snapshot.pending, snapshot.statuses, snapshot.widgets);
  }

  #restoreForkDecorations(snapshot: ReturnType<ExtensionUiCoordinator["snapshot"]>): void {
    if (this.#extensionUi) {
      this.#extensionUi.restoreSessionDecorations(snapshot.statuses, snapshot.widgets);
      return;
    }
    this.#viewState.setExtensionUi([], snapshot.statuses, snapshot.widgets);
  }

  #notifyChange(): void {
    this.#hooks.onChange(this);
  }
}

const MAX_AUTO_HISTORY_LOAD_BYTES = 8 * 1024 * 1024;
const LIVE_STATS_REFRESH_INTERVAL_MS = 3_000;
/** Short multi-delay idle checks after extension commands (aligned with pi-acp). */
const EXTENSION_COMMAND_IDLE_CHECK_DELAYS_MS = [0, 25, 75] as const;
const IMMEDIATE_EXTENSION_UI_METHODS = new Set(["select", "confirm", "input", "editor"]);

function shouldBufferDuringHistoryLoad(event: RpcEvent): boolean {
  return !isExtensionUiRequest(event) || !IMMEDIATE_EXTENSION_UI_METHODS.has(event.method);
}

function latestAssistantCacheHit(entries: readonly RpcSessionEntry[]): { found: boolean; percent?: number } {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "assistant") continue;
    if (!isRecord(entry.message.usage)) return { found: true };

    const { input, cacheRead, cacheWrite } = entry.message.usage;
    if (
      typeof input !== "number" || !Number.isFinite(input) || input < 0
      || typeof cacheRead !== "number" || !Number.isFinite(cacheRead) || cacheRead < 0
      || typeof cacheWrite !== "number" || !Number.isFinite(cacheWrite) || cacheWrite < 0
    ) return { found: true };
    const promptTokens = input + cacheRead + cacheWrite;
    return promptTokens > 0
      ? { found: true, percent: (cacheRead / promptTokens) * 100 }
      : { found: true };
  }
  return { found: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isExtensionCommandCompletionUnconfirmed(error: unknown): boolean {
  return error instanceof PiRpcCommandError
    && error.command === "prompt"
    && /^Timed out waiting for prompt response after \d+ms$/.test(error.message);
}

function extensionCommandCompletionUnconfirmedMessage(commandName: string): string {
  return `FrostPi has not confirmed that /${commandName} completed. Pi may still be waiting for input or may finish later; the session is still running.`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function conversationTurns(view: SessionViewModel): AgentTurnView[] {
  return view.conversationItems.filter((item): item is AgentTurnView => item.type === "turn");
}

function readVsCodeProxy(cwd: string): string | undefined {
  const value = vscode.workspace.getConfiguration("http", workspaceUriForPath(cwd)).get<string>("proxy", "").trim();
  return value || undefined;
}
