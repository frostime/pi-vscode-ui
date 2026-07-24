import { stat } from "node:fs/promises";

import {
  PiRpcApi,
  PiRpcConnection,
  isExtensionUiRequest,
  type RpcEvent,
  type RpcExtensionUiResponse,
  type RpcModel,
  type ThinkingLevel,
} from "@frostime/pi-rpc";
import * as vscode from "vscode";

import type { WebviewImageInput } from "../../shared/bridge/webviewToHost.js";
import type { ImageAttachmentView } from "../../shared/model/conversationModel.js";
import type { ComposerSeedView, SessionViewModel } from "../../shared/model/sessionViewModel.js";
import { normalizeImageAttachments, validateProjectedImageAttachments } from "../attachments/normalizeImageAttachment.js";
import type { FrostPiConfiguration } from "../configuration/configurationTypes.js";
import { workspaceUriForPath } from "../configuration/workspaceScope.js";
import { SessionProjection } from "../conversation/SessionProjection.js";
import { activeLeafContinues, activeUserEntryReferences, userEntryReferences } from "../conversation/userEntryReferences.js";
import { redactDiagnosticText, type DiagnosticLogger } from "../diagnostics/DiagnosticLogger.js";
import { ExtensionUiCoordinator } from "../extension-ui/ExtensionUiCoordinator.js";
import { commandName, normalizePiSlashPrompt } from "./normalizePiSlashPrompt.js";
import { configuredPiInvocation } from "../pi-runtime/resolvePiExecutable.js";
import { buildPiProcessEnvironment, proxyFingerprint, proxyModeLabel } from "../network/buildPiProcessEnvironment.js";
import type { ProxySecretStore } from "../network/ProxySecretStore.js";
import { SessionTreeExtensionBridge, type SessionTreeSummaryOptions } from "../session-tree/SessionTreeExtensionBridge.js";
import {
  buildSessionTreeIndex,
  compactSessionTreeEntries,
  projectBranchEndChoices,
  projectBranchPointControls,
  projectEditableTarget,
  type BranchEndChoiceProjection,
} from "../session-tree/sessionTreeProjection.js";

export interface SessionRuntimeHooks {
  onChange(runtime: SessionRuntime): void;
  onEditorText(runtime: SessionRuntime, text: string): void;
}

export type ForkExecutionResult =
  | { cancelled: true }
  | { cancelled: false; text: string; images: ImageAttachmentView[] };

export class SessionRuntime {
  readonly #projection: SessionProjection;
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
  #entriesCursor: string | null = null;
  #entriesLeafId: string | null = null;
  readonly #treeEntriesById = new Map<string, Awaited<ReturnType<PiRpcApi["getEntries"]>>["entries"][number]>();
  #entryTrackingReady = false;
  #disposed = false;
  #lifecycleVersion = 0;
  #liveStatsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  #liveStatsRefreshVersion = 0;
  #appliedProxyFingerprint: string | null = null;
  #proxyRestartForced = false;
  readonly #sessionTreeBridge: SessionTreeExtensionBridge | null;

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
  ) {
    this.#id = id;
    const initialConfiguration = configurationProvider();
    this.#projection = new SessionProjection(id, cwd, title, {
      maxImageBytes: initialConfiguration.maxImageBytes,
      maxImages: 12,
    }, updatedAt, initialConfiguration.collapseTurnTrace);
    this.#configurationProvider = configurationProvider;
    this.#proxySecrets = proxySecrets;
    this.#logger = logger;
    this.#hooks = hooks;
    this.#sessionTreeBridge = sessionTreeArtifactPath ? new SessionTreeExtensionBridge(sessionTreeArtifactPath) : null;
  }

  get id(): string {
    return this.#id;
  }

  get view(): Readonly<SessionViewModel> {
    return this.#projection.read();
  }

  get snapshot(): SessionViewModel {
    return structuredClone(this.view);
  }

  get sessionFile(): string | undefined {
    return this.view.sessionFile;
  }

  markWaitingToStart(): void {
    if (this.#disposed || this.#connection?.started || this.#starting) return;
    this.#projection.setStatus("queued");
    this.#notifyChange();
  }

  async start(sessionFile?: string): Promise<void> {
    if (this.#disposed) throw new Error("Session runtime is disposed");
    if (this.#starting) return this.#starting;
    if (this.#connection?.started) return;

    const lifecycleVersion = ++this.#lifecycleVersion;
    this.#projection.setHistoryStatus(sessionFile ? "queued" : "loaded");
    this.#entryTrackingReady = !sessionFile;
    this.#starting = this.#startInternal(sessionFile, lifecycleVersion).finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  async stop(): Promise<void> {
    this.#lifecycleVersion += 1;
    this.#projection.setStatus("stopping");
    this.#stopLiveStatsRefresh();
    this.#notifyChange();
    await this.#extensionUi?.cancelAll();
    await this.#connection?.stop();
    await this.#sessionTreeBridge?.dispose();
    this.#connection = null;
    this.#api = null;
    this.#extensionUi = null;
    this.#historyEventBuffer = null;
    this.#entriesCursor = null;
    this.#entriesLeafId = null;
    this.#treeEntriesById.clear();
    this.#entryTrackingReady = false;
    this.#appliedProxyFingerprint = null;
    this.#proxyRestartForced = false;
    // Local follow-up bubbles are ephemeral; a dead process cannot promote them.
    this.#projection.clearQueuedFollowUps();
    this.#projection.setForking(false);
    this.#projection.setStatus("stopped");
    this.refreshConfigurationState(false);
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    await this.stop();
  }

  async sendPrompt(text: string, images: WebviewImageInput[]): Promise<void> {
    if (this.view.isForking) throw new Error("Wait for the session fork to finish before sending a prompt.");
    const api = this.#requireApi();
    const configuration = this.#configurationProvider();
    const normalizedImages = normalizeImageAttachments(images, configuration.maxImageBytes);
    // Pi extension matching requires a leading "/" and splits the name only on ASCII space (indexOf(" ")).
    // Normalize so composer/completion/paste whitespace cannot turn "/cmd args" into a model prompt.
    const message = normalizePiSlashPrompt(text);
    if (!message && normalizedImages.length === 0) return;

    const extensionCommand = await this.#resolveImmediateExtensionCommand(message);
    // Park while streaming or while earlier follow-ups still await promotion; otherwise an idle-gap
    // appendUserPrompt steals the next agent_start and leaves Queued bubbles stuck.
    const queueAsFollowUp = !extensionCommand
      && configuration.streamingBehavior === "followUp"
      && (this.view.isStreaming || this.view.queuedFollowUps.length > 0);

    if (queueAsFollowUp) {
      const queuedId = this.#projection.enqueueFollowUp(message, images);
      this.#notifyChange();
      try {
        await api.prompt(message, {
          ...(normalizedImages.length ? { images: normalizedImages } : {}),
          streamingBehavior: "followUp",
        });
      } catch (error) {
        this.#projection.removeQueuedFollowUp(queuedId);
        this.#projection.appendNotice(errorMessage(error), "error");
        this.#notifyChange();
        throw error;
      }
      return;
    }

    const turnId = this.#projection.appendUserPrompt(message, images);
    this.#notifyChange();

    try {
      await api.prompt(message, {
        ...(normalizedImages.length ? { images: normalizedImages } : {}),
        ...(this.view.isStreaming && !extensionCommand
          ? { streamingBehavior: configuration.streamingBehavior }
          : {}),
      });
      if (extensionCommand) await this.#finishImmediateExtensionCommand(turnId);
    } catch (error) {
      const messageText = errorMessage(error);
      this.#projection.appendNotice(messageText, "error");
      if (!this.view.isStreaming) this.#projection.completeTurn(turnId, "error");
      this.#notifyChange();
      throw error;
    }
  }

  async compact(customInstructions?: string): Promise<void> {
    await this.#requireApi().compact(customInstructions);
  }

  async abort(): Promise<void> {
    await this.#requireApi().abort();
    // Abort cancels the active run; pending local follow-up UI is no longer trustworthy.
    this.#projection.clearQueuedFollowUps();
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
    if (this.view.pendingExtensionUi.length > 0 || this.view.queuedFollowUps.length > 0) throw new Error("Wait for the current Pi interaction to finish before switching branches.");

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
    this.#projection.setNavigatingTree(true, summary.summarize);
    this.#notifyChange();
    try {
      const result = await this.#sessionTreeBridge.navigate(api, targetId, summary);
      if (result.status === "cancelled") return { cancelled: true };
      committed = true;
      const entryData = await api.getEntries();
      const [state, messages, stats] = await Promise.all([
        api.getState(),
        api.getMessages(),
        api.getSessionStats().catch(() => undefined),
      ]);
      this.#entriesCursor = lastEntryId(entryData.entries);
      this.#entriesLeafId = entryData.leafId;
      this.#entryTrackingReady = true;
      this.#projection.applyState(state);
      this.#projection.hydrateMessages(messages, activeUserEntryReferences(entryData.entries, entryData.leafId));
      if (stats) this.#projection.setStats(stats);
      this.#applyTreeEntries(entryData.entries, entryData.leafId);
      return seed ? { cancelled: false, seed } : { cancelled: false };
    } catch (error) {
      if (committed) {
        this.#projection.setHistoryStatus("failed");
        this.#projection.appendNotice(`Unable to reload the committed session branch: ${errorMessage(error)}`, "error");
      }
      throw error;
    } finally {
      this.#projection.setNavigatingTree(false);
      this.#notifyChange();
    }
  }

  async executeFork(entryId: string): Promise<ForkExecutionResult> {
    if (this.view.status !== "ready" || this.view.isStreaming || this.view.isCompacting) {
      throw new Error("Wait for the current Pi operation to finish before forking.");
    }
    if (this.view.historyStatus !== "loaded") throw new Error("Load conversation history before forking a message.");
    if (this.view.pendingExtensionUi.length > 0) throw new Error("Answer the pending Pi request before forking.");
    if (this.view.queuedFollowUps.length > 0) throw new Error("Wait for queued follow-ups to settle before forking.");
    const selectedMessage = this.view.turns.find((turn) => turn.userMessage?.sourceEntryId === entryId)?.userMessage;
    if (!selectedMessage) throw new Error("The selected message is no longer available for forking.");
    const projectedImages = selectedMessage.blocks.flatMap((block) => block.type === "images" ? block.images : []);
    const images = validateProjectedImageAttachments(
      projectedImages,
      this.view.attachmentLimits.maxImages,
      this.#configurationProvider().maxImageBytes,
    );

    const previousExtensionUi = this.#extensionUi?.snapshot();
    this.#extensionUi?.clearSessionDecorations();
    this.#projection.setForking(true);
    this.#notifyChange();
    try {
      const result = await this.#requireApi().fork(entryId);
      if (result.cancelled) {
        if (previousExtensionUi) this.#restoreForkDecorations(previousExtensionUi);
        this.#projection.setForking(false);
        this.#notifyChange();
        return { cancelled: true };
      }
      return { cancelled: false, text: result.text, images };
    } catch (error) {
      if (previousExtensionUi) this.#restoreForkDecorations(previousExtensionUi);
      this.#projection.setForking(false);
      this.#notifyChange();
      throw error;
    }
  }

  async reconcileFork(name: string, composerSeed: ComposerSeedView): Promise<void> {
    const api = this.#requireApi();
    await api.setSessionName(name);
    const state = await api.getState();
    const [messages, entryData, stats, commands] = await Promise.all([
      api.getMessages(),
      api.getEntries(),
      api.getSessionStats().catch(() => undefined),
      api.getCommands().catch(() => undefined),
    ]);
    this.#projection.applyState(state);
    this.#entriesCursor = lastEntryId(entryData.entries);
    this.#entriesLeafId = entryData.leafId;
    this.#entryTrackingReady = true;
    this.#projection.hydrateMessages(messages, activeUserEntryReferences(entryData.entries, entryData.leafId));
    if (stats) this.#projection.setStats(stats);
    if (commands) this.#projection.setCommands(this.#sessionTreeBridge?.discover(commands) ?? commands);
    this.#projection.setComposerSeed(composerSeed);
    this.#projection.setForking(false);
    this.#notifyChange();
  }

  rebindSessionId(id: string): void {
    if (this.#starting || this.#historyLoading) throw new Error("Cannot replace a session identity while lifecycle work is pending.");
    // Registry rekeys its maps around this call; emitting midway would expose mismatched identities.
    this.#id = id;
    this.#projection.rebindSessionId(id);
  }

  setComposerSeed(seed: ComposerSeedView): void {
    this.#projection.setComposerSeed(seed);
    this.#notifyChange();
  }

  clearComposerSeed(): void {
    this.#projection.clearComposerSeed();
    this.#notifyChange();
  }

  setDisplayTitle(title: string): void {
    this.#projection.setTitle(title);
    this.#notifyChange();
  }

  async rename(name: string): Promise<void> {
    const normalized = name.trim();
    await this.#requireApi().setSessionName(normalized);
    this.#projection.setTitle(normalized || "Untitled session");
    this.#notifyChange();
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    const model = await this.#requireApi().setModel(provider, modelId);
    const state = await this.#requireApi().getState();
    this.#projection.applyState({ ...state, model });
    this.#notifyChange();
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    await this.#requireApi().setThinkingLevel(level);
    const state = await this.#requireApi().getState();
    this.#projection.applyState(state);
    this.#notifyChange();
  }

  async refreshModels(): Promise<RpcModel[]> {
    const models = await this.#requireApi().getAvailableModels();
    this.#projection.setModels(models);
    this.#notifyChange();
    return models;
  }

  async refreshCommands(): Promise<void> {
    const commands = await this.#requireApi().getCommands();
    this.#projection.setCommands(this.#sessionTreeBridge?.discover(commands) ?? commands);
    this.#notifyChange();
  }

  async probePiIntegration(): Promise<{ available: boolean; commandName: string | null }> {
    const commands = await this.#requireApi().getCommands();
    this.#projection.setCommands(this.#sessionTreeBridge?.discover(commands) ?? commands);
    this.#projection.setSessionTreeState(
      this.#sessionTreeBridge?.available ?? false,
      this.view.branchControls,
    );
    this.#notifyChange();
    return {
      available: this.#sessionTreeBridge?.available ?? false,
      commandName: this.#sessionTreeBridge?.commandName ?? null,
    };
  }

  markHistoryWaiting(): void {
    this.#projection.setHistoryStatus("queued");
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
      this.#projection.setHistoryStatus("loaded");
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

  refreshConfigurationState(forceRestartRequired = false): void {
    const configuration = this.#configurationProvider();
    const vscodeProxy = readVsCodeProxy(this.cwd);
    const fingerprint = proxyFingerprint(configuration.proxy, vscodeProxy);
    const running = Boolean(this.#connection?.started);
    if (running && forceRestartRequired) this.#proxyRestartForced = true;
    const restartRequired = running && (this.#proxyRestartForced || (this.#appliedProxyFingerprint !== null && fingerprint !== this.#appliedProxyFingerprint));
    const configuredLabel = proxyModeLabel(configuration.proxy.mode);
    const appliedLabel = running ? this.view.networkProxy.label : configuredLabel;
    this.#projection.setAttachmentLimits({ maxImageBytes: configuration.maxImageBytes, maxImages: 12 });
    this.#projection.setCollapseTurnTrace(configuration.collapseTurnTrace);
    this.#projection.setNetworkProxy({
      mode: configuration.proxy.mode,
      label: appliedLabel,
      ...(restartRequired ? { pendingLabel: configuredLabel } : {}),
      restartRequired,
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
      `Turns: ${view.turns.length}`,
      `Tool calls: ${view.turns.reduce((count, turn) => count + turn.activities.filter((activity) => activity.type === "tool").length, 0)}`,
      `Pending extension UI: ${view.pendingExtensionUi.length}`,
      `Last error: ${view.error ?? "<none>"}`,
      `Pi stderr tail: ${redactDiagnosticText(this.#connection?.getStderr() || "<empty>")}`,
    ].join("\n");
  }

  async #startInternal(sessionFile: string | undefined, lifecycleVersion: number): Promise<void> {
    this.#projection.setStatus("starting");
    this.#notifyChange();

    const configuration = this.#configurationProvider();
    const invocation = configuredPiInvocation(configuration.piExecutable);
    await this.#sessionTreeBridge?.prepare();
    const args = [
      ...configuration.piArguments,
      ...(sessionFile ? ["--session", sessionFile] : []),
      ...(this.#sessionTreeBridge?.launchArguments() ?? []),
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
      onNotify: (level, message) => this.#projection.appendNotice(message, level),
      onTitle: (title) => {
        this.#projection.setTitle(title);
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
      this.#projection.clearQueuedFollowUps();
      this.#projection.setStatus("failed", errorMessage(error));
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
      this.#projection.setNetworkProxy({ mode: configuration.proxy.mode, label: proxyEnvironment.label, restartRequired: false });
      this.#projection.applyState(state);
      this.#logger.info(`Started Pi session ${this.id} in ${this.cwd}`);
      this.#notifyChange();
      void this.#loadSessionInformation(api);
    } catch (error) {
      if (this.#disposed || lifecycleVersion !== this.#lifecycleVersion) return;
      const message = errorMessage(error);
      this.#projection.setStatus("failed", message);
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
    this.#projection.setModels(models);
    this.#projection.setCommands(this.#sessionTreeBridge?.discover(commands) ?? commands);
    if (stats) this.#projection.setStats(stats);
    if (this.#sessionTreeBridge) {
      await this.#refreshTreeProjection(api).catch((error: unknown) => {
        this.#logger.error("Failed to load session tree", error);
      });
    }
    this.#notifyChange();
  }

  async #loadHistoryInternal(api: PiRpcApi, sessionFile: string, force: boolean): Promise<void> {
    if (this.view.isStreaming) {
      this.#projection.setHistoryStatus("deferred");
      this.#notifyChange();
      throw new Error("Stop the running session before loading its conversation history.");
    }

    try {
      if (!force && (await stat(sessionFile)).size > MAX_AUTO_HISTORY_LOAD_BYTES) {
        this.#projection.setHistoryStatus("deferred");
        this.#projection.appendNotice("Conversation history is large and was not loaded automatically.", "info");
        this.#notifyChange();
        return;
      }
      this.#projection.setHistoryStatus("loading");
      this.#historyEventBuffer = [];
      this.#notifyChange();
      const [messages, entryData] = await Promise.all([api.getMessages(), api.getEntries()]);
      const bufferedEvents = this.#takeHistoryEvents();
      if (this.#disposed || api !== this.#api) return;
      this.#entriesCursor = lastEntryId(entryData.entries);
      this.#entriesLeafId = entryData.leafId;
      this.#entryTrackingReady = true;
      this.#projection.hydrateMessages(
        messages,
        activeUserEntryReferences(entryData.entries, entryData.leafId),
      );
      this.#applyTreeEntries(entryData.entries, entryData.leafId);
      for (const event of bufferedEvents) this.#applyConnectionEvent(event);
      this.#notifyChange();
    } catch (error) {
      const bufferedEvents = this.#takeHistoryEvents();
      if (this.#disposed || api !== this.#api) return;
      for (const event of bufferedEvents) this.#applyConnectionEvent(event);
      this.#logger.error("Failed to load Pi messages", error);
      this.#projection.setHistoryStatus("failed");
      this.#projection.appendNotice(`Unable to load conversation history: ${errorMessage(error)}`, "error");
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
    if (isExtensionUiRequest(event)) this.#extensionUi?.handle(event);
    else this.#projection.applyEvent(event);
    if (event.type === "agent_start") this.#startLiveStatsRefresh();
    if (event.type === "agent_settled") {
      this.#stopLiveStatsRefresh();
      void this.#refreshAfterSettled();
    }
    if (event.type === "compaction_end") void this.#refreshAfterCompaction();
  }

  async #refreshAfterCompaction(): Promise<void> {
    const api = this.#api;
    if (!api) return;
    const stats = await api.getSessionStats().catch(() => undefined);
    if (this.#disposed || api !== this.#api) return;
    if (stats) this.#projection.setStats(stats);
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
      this.#projection.setStats(stats);
      this.#notifyChange();
    }
    this.#scheduleLiveStatsRefresh();
  }

  async #refreshAfterSettled(): Promise<void> {
    const api = this.#api;
    if (!api) return;
    const [state, stats, commands, entryData] = await Promise.all([
      api.getState().catch(() => undefined),
      api.getSessionStats().catch(() => undefined),
      api.getCommands().catch(() => undefined),
      this.#entryTrackingReady
        ? api.getEntries(this.#entriesCursor ?? undefined).catch(() => undefined)
        : Promise.resolve(undefined),
    ]);
    if (state) this.#projection.applyState(state);
    if (stats) this.#projection.setStats(stats);
    if (commands) this.#projection.setCommands(this.#sessionTreeBridge?.discover(commands) ?? commands);
    if (entryData) {
      await this.#reconcileIncrementalEntries(api, entryData.entries, entryData.leafId).catch((error) => {
        this.#logger.error("Failed to reconcile Pi session entries", error);
      });
    }
    this.#notifyChange();
  }

  async #reconcileIncrementalEntries(
    api: PiRpcApi,
    entries: Awaited<ReturnType<PiRpcApi["getEntries"]>>["entries"],
    leafId: string | null,
  ): Promise<void> {
    if (activeLeafContinues(this.#entriesLeafId, entries, leafId)) {
      this.#entriesCursor = lastEntryId(entries) ?? this.#entriesCursor;
      this.#entriesLeafId = leafId;
      this.#projection.attachUserEntryReferences(userEntryReferences(entries));
      this.#applyTreeEntries(entries, leafId, false);
      return;
    }

    const [messages, entryData] = await Promise.all([api.getMessages(), api.getEntries()]);
    if (this.#disposed || api !== this.#api) return;
    this.#entriesCursor = lastEntryId(entryData.entries);
    this.#entriesLeafId = entryData.leafId;
    this.#projection.hydrateMessages(messages, activeUserEntryReferences(entryData.entries, entryData.leafId));
    this.#applyTreeEntries(entryData.entries, entryData.leafId);
  }

  #applyTreeEntries(
    entries: Awaited<ReturnType<PiRpcApi["getEntries"]>>["entries"],
    leafId: string | null,
    replace = true,
  ): void {
    if (replace) this.#treeEntriesById.clear();
    for (const entry of compactSessionTreeEntries(entries)) this.#treeEntriesById.set(entry.id, entry);
    const index = buildSessionTreeIndex([...this.#treeEntriesById.values()], leafId);
    this.#projection.setSessionTreeState(this.#sessionTreeBridge?.available ?? false, projectBranchPointControls(index));
  }

  async #refreshTreeProjection(api: PiRpcApi): Promise<void> {
    const entryData = await api.getEntries();
    if (this.#disposed || api !== this.#api) return;
    this.#entriesCursor = lastEntryId(entryData.entries);
    this.#entriesLeafId = entryData.leafId;
    this.#entryTrackingReady = true;
    this.#applyTreeEntries(entryData.entries, entryData.leafId);
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
      this.#projection.setCommands(visibleCommands);
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
      this.#projection.completeTurn(turnId, "completed");
      this.#notifyChange();
      return;
    }
    if (!idleState) return;

    this.#projection.completeTurn(turnId, "completed");
    this.#projection.applyState(idleState);
    this.#notifyChange();
  }

  #turnStillRunning(turnId: string): boolean {
    return this.view.turns.some((turn) => turn.id === turnId && turn.status === "running");
  }

  #requireApi(): PiRpcApi {
    if (!this.#api || !this.#connection?.started) throw new Error("Pi session is not running");
    return this.#api;
  }

  #syncExtensionUiSnapshot(): void {
    const snapshot = this.#extensionUi?.snapshot();
    if (!snapshot) return;
    this.#projection.setExtensionUi(snapshot.pending, snapshot.statuses, snapshot.widgets);
  }

  #restoreForkDecorations(snapshot: ReturnType<ExtensionUiCoordinator["snapshot"]>): void {
    if (this.#extensionUi) {
      this.#extensionUi.restoreSessionDecorations(snapshot.statuses, snapshot.widgets);
      return;
    }
    this.#projection.setExtensionUi([], snapshot.statuses, snapshot.widgets);
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lastEntryId(entries: readonly { id: string }[]): string | null {
  return entries.at(-1)?.id ?? null;
}

function readVsCodeProxy(cwd: string): string | undefined {
  const value = vscode.workspace.getConfiguration("http", workspaceUriForPath(cwd)).get<string>("proxy", "").trim();
  return value || undefined;
}
