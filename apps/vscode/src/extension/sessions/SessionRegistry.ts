import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { basename, normalize, resolve } from "node:path";

import type { RpcExtensionUiResponse, StreamingBehavior, ThinkingLevel } from "@frostime/pi-rpc";
import * as vscode from "vscode";

import type { WebviewImageInput } from "../../shared/bridge/webviewToHost.js";
import type { QuestionDraftSubmission } from "../../shared/question-tool/questionToolProtocol.js";
import type { SessionRuntimeStatus, SessionSummaryView, SessionViewModel, WorkspaceViewModel } from "../../shared/model/sessionViewModel.js";
import { readConfiguration } from "../configuration/readConfiguration.js";
import { workspaceUriForPath } from "../configuration/workspaceScope.js";
import type { DiagnosticLogger } from "../diagnostics/DiagnosticLogger.js";
import { ProxySecretStore } from "../network/ProxySecretStore.js";
import { showWindowsToast } from "../notifications/showWindowsToast.js";
import { readPiSessionMetadata, type PiSessionCatalogEntry } from "./catalog/SessionCatalog.js";
import { pickPiSession } from "./catalog/SessionCatalogPicker.js";
import { SessionPersistence } from "./SessionPersistence.js";
import {
  discoverSessionWorkingDirectories,
  findSessionWorkingDirectory,
  type SessionWorkingDirectory,
} from "./SessionWorkingDirectories.js";
import { confirmDraftReplacement, pickBranchEnd, pickBranchSummary } from "./tree/SessionTreePicker.js";
import { normalizePiSlashPrompt } from "./normalizePiSlashPrompt.js";
import { SessionRuntime } from "./SessionRuntime.js";
import type { PersistedSessionRecord } from "./sessionTypes.js";

export interface RegistryToast {
  level: "info" | "warning" | "error";
  message: string;
}

type SystemNotificationEvent = "inputRequired" | "failed" | "completed";
type DiscoverSessionWorkingDirectories = typeof discoverSessionWorkingDirectories;

export type ForkResultSelection = "select-result" | "preserve-sidebar-selection";

interface ForkOperation {
  phase: "waiting-for-pi" | "reconciling";
  sourceId: string;
  forkId: string;
  runtime: SessionRuntime;
  resultSelection: ForkResultSelection;
  cancelRequested: boolean;
  stopPromise?: Promise<void>;
}

export class SessionRegistry implements vscode.Disposable {
  readonly #runtimes = new Map<string, SessionRuntime>();
  readonly #records = new Map<string, PersistedSessionRecord>();
  readonly #persistence: SessionPersistence;
  readonly #logger: DiagnosticLogger;
  readonly #proxySecrets: ProxySecretStore;
  readonly #changeEmitter = new vscode.EventEmitter<void>();
  readonly #toastEmitter = new vscode.EventEmitter<RegistryToast>();
  readonly #setComposerTextEmitter = new vscode.EventEmitter<{ sessionId: string; text: string }>();
  readonly #lastStatuses = new Map<string, SessionRuntimeStatus>();
  readonly #lastPendingUiCounts = new Map<string, number>();
  readonly #temporarySessionIds = new Set<string>();
  readonly #retainedProvisionalSessionIds = new Set<string>();
  readonly #startJobs = new Map<string, Promise<void>>();
  readonly #historyJobs = new Map<string, Promise<void>>();
  readonly #treeInteractionSessions = new Set<string>();
  readonly #workingDirectoriesByCwd = new Map<string, SessionWorkingDirectory>();
  readonly #discoverWorkingDirectories: DiscoverSessionWorkingDirectories;
  readonly #sessionTreeArtifactPath: string | undefined;
  readonly #questionToolArtifactPath: string | undefined;

  #activeSessionId: string | null = null;
  #forkOperation: ForkOperation | null = null;
  #startQueue: Promise<void> = Promise.resolve();
  #historyQueue: Promise<void> = Promise.resolve();
  #persistenceQueue: Promise<void> = Promise.resolve();
  #emitTimer: ReturnType<typeof setTimeout> | null = null;
  #disposed = false;

  readonly onDidChange = this.#changeEmitter.event;
  readonly onDidToast = this.#toastEmitter.event;
  readonly onDidSetComposerText = this.#setComposerTextEmitter.event;

  constructor(
    context: vscode.ExtensionContext,
    logger: DiagnosticLogger,
    discoverWorkingDirectories: DiscoverSessionWorkingDirectories = discoverSessionWorkingDirectories,
  ) {
    this.#persistence = new SessionPersistence(context.workspaceState);
    this.#logger = logger;
    this.#discoverWorkingDirectories = discoverWorkingDirectories;
    this.#sessionTreeArtifactPath = typeof context.asAbsolutePath === "function"
      ? context.asAbsolutePath("dist/pi-extensions/session-tree.js")
      : undefined;
    this.#questionToolArtifactPath = typeof context.asAbsolutePath === "function"
      ? context.asAbsolutePath("dist/pi-extensions/question-tool.js")
      : undefined;
    this.#proxySecrets = new ProxySecretStore(context.secrets);
    const stored = this.#persistence.load();
    for (const record of stored.sessions) this.#restoreRecord(record);
    this.#activeSessionId = stored.activeSessionId && this.#runtimes.has(stored.activeSessionId)
      ? stored.activeSessionId
      : stored.sessions[0]?.id ?? null;
  }

  get activeSessionId(): string | null {
    return this.#activeSessionId;
  }

  async ensureInitialSession(): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) return;
    await this.#reconcilePersistedWorkingDirectories();
    await this.#repairGeneratedTitles();
    // Never invent a new session on open. Empty workspaces stay on the onboarding home until
    // the user creates or resumes a session. Optionally start only an already-selected one.
    const active = this.#activeSessionId ? this.#runtimes.get(this.#activeSessionId) : undefined;
    if (active && readConfiguration(workspaceUriForPath(this.#configurationScopeCwd(active.cwd))).startSessionOnOpen) {
      await this.#startRuntime(active).catch(() => undefined);
    }
  }

  hasSession(sessionId: string): boolean {
    return this.#runtimes.has(sessionId);
  }

  sessionView(sessionId: string): SessionViewModel | null {
    const runtime = this.#runtimes.get(sessionId);
    return runtime ? this.#withWorkingDirectoryLabel(runtime.view) : null;
  }

  retainProvisionalSession(sessionId: string): void {
    this.#requireRuntime(sessionId);
    if (this.#temporarySessionIds.has(sessionId)) this.#retainedProvisionalSessionIds.add(sessionId);
  }

  snapshot(): WorkspaceViewModel {
    const folder = activeWorkspaceFolder();
    const active = this.#activeSessionId ? this.#runtimes.get(this.#activeSessionId) : undefined;
    const activeView = active ? this.#withWorkingDirectoryLabel(active.view) : null;
    const sessions: SessionSummaryView[] = [...this.#runtimes.values()]
      .map((runtime) => {
        const view = runtime.view;
        return {
          id: view.id,
          title: view.title,
          cwd: view.cwd,
          ...this.#workingDirectoryLabel(view.cwd),
          status: view.status,
          isActive: view.id === this.#activeSessionId,
          isEphemeral: view.isEphemeral,
          ...(view.model ? { modelLabel: view.model.name ?? `${view.model.provider}/${view.model.id}` } : {}),
          thinkingLevel: view.thinkingLevel,
          historyStatus: view.historyStatus,
          requiresUserInput: view.pendingExtensionUi.length > 0,
        };
      });
    const piError = activeView?.status === "failed" ? activeView.error : undefined;
    return {
      workspaceName: folder?.name ?? "No workspace",
      workspacePath: folder?.uri.fsPath ?? "",
      sessions,
      activeSessionId: this.#activeSessionId,
      activeSession: activeView,
      piAvailable: !piError,
      ...(piError ? { piError } : {}),
    };
  }

  async createSession(ephemeral = false): Promise<string | undefined> {
    this.#assertNoForkOperation();
    const cwd = activeWorkspaceFolder()?.uri.fsPath;
    if (!cwd) throw new Error("Open a workspace folder before creating a Pi session.");
    const discovery = await this.#discoverWorkingDirectories(cwd);
    const directory = await pickSessionWorkingDirectory(discovery.directories);
    if (!directory) return undefined;
    return this.#createSessionInDirectory(directory, ephemeral);
  }

  async resumeSession(): Promise<string | undefined> {
    this.#assertNoForkOperation();
    const cwd = activeWorkspaceFolder()?.uri.fsPath;
    if (!cwd) throw new Error("Open a workspace folder before resuming a Pi session.");
    const discovery = await this.#discoverWorkingDirectories(cwd);
    const configuration = readConfiguration(workspaceUriForPath(cwd));
    const entry = await pickPiSession(discovery.directories, configuration.piArguments);
    if (!entry) return undefined;
    const directory = findSessionWorkingDirectory(discovery.directories, entry.cwd);
    return this.#openSession(entry, true, directory);
  }

  async openSession(entry: PiSessionCatalogEntry): Promise<string> {
    return this.#openSession(entry, false);
  }

  async #openSession(
    entry: PiSessionCatalogEntry,
    workingDirectoryValidated: boolean,
    workingDirectory?: SessionWorkingDirectory,
  ): Promise<string> {
    this.#assertNoForkOperation();
    const existing = [...this.#records.values()].find((record) => record.sessionFile && samePath(record.sessionFile, entry.path));
    if (existing) {
      if (workingDirectory) this.#rememberWorkingDirectory(workingDirectory);
      if (existing.id !== this.#activeSessionId) await this.#discardActiveTemporarySession();
      await this.activateSession(existing.id);
      return existing.id;
    }

    await this.#discardActiveTemporarySession();
    const id = randomUUID();
    const record: PersistedSessionRecord = {
      id,
      title: entry.title,
      cwd: entry.cwd,
      sessionFile: entry.path,
      updatedAt: entry.updatedAt,
    };
    this.#records.set(id, record);
    if (workingDirectory) this.#rememberWorkingDirectory(workingDirectory);
    const runtime = this.#createRuntime(record);
    this.#runtimes.set(id, runtime);
    this.#activeSessionId = id;
    await this.#persist();
    this.#emitChange();
    await this.#startRuntime(runtime, workingDirectoryValidated);
    return id;
  }

  async #createSessionInDirectory(directory: SessionWorkingDirectory, ephemeral: boolean): Promise<string> {
    await this.#discardActiveTemporarySession();
    const id = randomUUID();
    const record: PersistedSessionRecord = {
      id,
      title: "New session",
      cwd: directory.cwd,
      ...(ephemeral ? { ephemeral: true } : {}),
      updatedAt: Date.now(),
    };
    this.#records.set(id, record);
    this.#rememberWorkingDirectory(directory);
    if (!ephemeral) this.#temporarySessionIds.add(id);
    const runtime = this.#createRuntime(record);
    this.#runtimes.set(id, runtime);
    this.#activeSessionId = id;
    await this.#persist();
    this.#emitChange();
    await this.#startRuntime(runtime, true);
    return id;
  }

  async activateSession(sessionId: string): Promise<void> {
    this.#assertNoForkOperation();
    const runtime = this.#requireRuntime(sessionId);
    if (sessionId !== this.#activeSessionId) await this.#discardActiveTemporarySession();
    this.#activeSessionId = sessionId;
    await this.#persist();
    this.#emitChange();
    if (runtime.view.status === "stopped" && !runtime.isEphemeral) await this.#startRuntime(runtime);
  }

  async closeSession(sessionId: string): Promise<void> {
    this.#assertSessionOutsideFork(sessionId);
    const runtime = this.#requireRuntime(sessionId);
    if (!await confirmClose(runtime)) return;
    await runtime.dispose();
    this.#removeSession(sessionId);
    if (this.#activeSessionId === sessionId) {
      // Stable open order: prefer the most recently opened remaining session.
      this.#activeSessionId = [...this.#runtimes.keys()].at(-1) ?? null;
    }
    await this.#persist();
    this.#emitChange();
  }

  async retrySession(sessionId?: string): Promise<void> {
    const targetId = sessionId ?? this.#requireActiveId();
    this.#assertSessionOutsideFork(targetId);
    const runtime = this.#requireRuntime(targetId);
    if (runtime.isEphemeral) throw new Error("Temporary sessions cannot be restarted.");
    if (!await confirmRestart([runtime])) return;
    await this.#restartRuntime(runtime);
  }

  async restartAllSessions(): Promise<void> {
    this.#assertNoForkOperation();
    const runtimes = [...this.#runtimes.values()];
    const restartable = runtimes.filter((runtime) => !runtime.isEphemeral);
    const skipped = runtimes.length - restartable.length;
    if (restartable.length === 0) {
      this.#toastEmitter.fire({ level: "info", message: "There are no sessions to restart." });
      return;
    }
    if (!await confirmRestart(restartable)) return;
    for (const runtime of restartable) await this.#restartRuntime(runtime);
    if (skipped > 0) {
      this.#toastEmitter.fire({
        level: "info",
        message: `Skipped ${skipped} temporary ${skipped === 1 ? "session" : "sessions"}.`,
      });
    }
  }

  refreshConfigurationState(forceRestartRequired = false): void {
    for (const runtime of this.#runtimes.values()) runtime.refreshConfigurationState(forceRestartRequired);
  }

  async sendPrompt(sessionId: string, text: string, images: WebviewImageInput[], streamingBehavior?: StreamingBehavior): Promise<void> {
    this.#assertSessionOutsideFork(sessionId);
    if (!text.trim() && images.length === 0) return;
    const runtime = this.#requireRuntime(sessionId);
    await this.#ensureRunning(runtime);
    if (runtime.view.historyStatus === "queued" || runtime.view.historyStatus === "loading") {
      throw new Error("Wait for conversation history to finish loading before sending a prompt.");
    }
    if (runtime.view.isCompacting) throw new Error("Wait for context compaction to finish before sending a prompt.");
    const compactInstructions = compactCommandInstructions(text);
    if (compactInstructions !== null && images.length > 0) throw new Error("/compact does not support image attachments.");
    if (compactInstructions !== null) await runtime.compact(compactInstructions || undefined);
    else await runtime.sendPrompt(text, images, streamingBehavior);
    runtime.clearComposerSeed();
    if (compactInstructions === null && this.#temporarySessionIds.delete(sessionId)) {
      this.#retainedProvisionalSessionIds.delete(sessionId);
      await this.#persist();
    }
  }

  async abort(sessionId = this.#requireActiveId()): Promise<void> {
    this.#assertSessionOutsideFork(sessionId);
    await this.#requireRuntime(sessionId).abort();
  }

  async cancelFork(sessionId: string): Promise<void> {
    const operation = this.#forkOperation;
    if (!operation || (sessionId !== operation.sourceId && sessionId !== operation.forkId)) {
      throw new Error("No Fork operation is active for this session.");
    }
    operation.cancelRequested = true;
    operation.stopPromise ??= operation.runtime.stop();
    await operation.stopPromise;
  }

  async forkMessage(
    sessionId: string,
    entryId: string,
    resultSelection: ForkResultSelection = "select-result",
  ): Promise<{ cancelled: boolean; forkSessionId?: string }> {
    this.#assertNoForkOperation();
    if (resultSelection === "select-result" && sessionId !== this.#activeSessionId) {
      throw new Error("Activate the session before forking one of its messages.");
    }
    const runtime = this.#requireRuntime(sessionId);
    const original = this.#records.get(sessionId);
    if (original?.ephemeral) throw new Error("Temporary sessions do not support Fork.");
    if (!original?.sessionFile) throw new Error("Wait for Pi to save this session before forking.");
    await access(original.sessionFile).catch(() => {
      throw new Error("Wait for Pi to finish saving this session before forking.");
    });
    const operation: ForkOperation = {
      phase: "waiting-for-pi",
      sourceId: sessionId,
      forkId: randomUUID(),
      runtime,
      resultSelection,
      cancelRequested: false,
    };
    this.#forkOperation = operation;
    const forkName = forkSessionName(runtime.view.title);

    let result: Awaited<ReturnType<SessionRuntime["executeFork"]>>;
    try {
      result = await runtime.executeFork(entryId);
    } catch (error) {
      await this.#restoreOriginalAfterFork(operation);
      if (operation.cancelRequested) return { cancelled: true };
      throw error;
    }
    if (operation.cancelRequested) {
      await this.#restoreOriginalAfterFork(operation);
      return { cancelled: true };
    }
    if (result.cancelled) {
      this.#finishForkOperation(operation);
      this.#emitChange();
      return { cancelled: true };
    }

    try {
      if (this.#startJobs.has(operation.sourceId) || this.#historyJobs.has(operation.sourceId)) {
        throw new Error("Session lifecycle work was still pending when Pi committed the Fork.");
      }
      operation.phase = "reconciling";
      this.#replaceRuntimeWithFork(operation, original, forkName);
      await runtime.reconcileFork(forkName, {
        id: operation.forkId,
        text: result.text,
        images: result.images,
      });
    } catch (error) {
      await this.#restoreOriginalAfterFork(operation);
      if (operation.cancelRequested) return { cancelled: true };
      throw error;
    }

    const forkFile = runtime.view.sessionFile;
    this.#records.set(operation.forkId, {
      id: operation.forkId,
      title: forkName,
      cwd: runtime.cwd,
      ...(forkFile ? { sessionFile: forkFile } : {}),
      updatedAt: Date.now(),
    });
    this.#finishForkOperation(operation);
    await Promise.resolve(this.#persist()).catch((error: unknown) => this.#logger.error("Failed to persist session collection after Fork", error));
    this.#emitChange();
    return { cancelled: false, forkSessionId: operation.forkId };
  }

  async branchHere(sessionId: string, entryId: string, hasDraft: boolean): Promise<{ cancelled: boolean }> {
    return this.#withTreeInteraction(sessionId, async () => {
      this.#assertNoForkOperation();
      const runtime = this.#requireRuntime(sessionId);
      await this.#ensureRunning(runtime);
      if (hasDraft && !await confirmDraftReplacement()) return { cancelled: true };
      const summary = await pickBranchSummary();
      if (!summary) return { cancelled: true };
      const result = await runtime.navigateTree(entryId, summary);
      if (result.seed) runtime.setComposerSeed(result.seed);
      return { cancelled: result.cancelled };
    });
  }

  async switchBranch(
    sessionId: string,
    branchPointId: string | null,
    hasDraft: boolean,
  ): Promise<{ cancelled: boolean }> {
    return this.#withTreeInteraction(sessionId, async () => {
      this.#assertNoForkOperation();
      const runtime = this.#requireRuntime(sessionId);
      await this.#ensureRunning(runtime);
      const selected = await pickBranchEnd(await runtime.listBranchEnds(branchPointId));
      if (!selected || selected.isCurrent) return { cancelled: true };
      if (selected.isEditable && hasDraft && !await confirmDraftReplacement()) return { cancelled: true };
      const summary = await pickBranchSummary();
      if (!summary) return { cancelled: true };
      const result = await runtime.navigateTree(selected.targetId, summary);
      if (result.seed) runtime.setComposerSeed(result.seed);
      return { cancelled: result.cancelled };
    });
  }

  async rename(sessionId: string, name: string): Promise<void> {
    this.#assertSessionOutsideFork(sessionId);
    const runtime = this.#requireRuntime(sessionId);
    await this.#ensureRunning(runtime);
    await runtime.rename(name);
    if (this.#temporarySessionIds.delete(sessionId)) {
      this.#retainedProvisionalSessionIds.delete(sessionId);
      await this.#persist();
    }
  }

  async setModel(sessionId: string, provider: string, modelId: string): Promise<void> {
    this.#assertSessionOutsideFork(sessionId);
    const runtime = this.#requireRuntime(sessionId);
    await this.#ensureRunning(runtime);
    await runtime.setModel(provider, modelId);
  }

  async setThinkingLevel(sessionId: string, level: ThinkingLevel): Promise<void> {
    this.#assertSessionOutsideFork(sessionId);
    const runtime = this.#requireRuntime(sessionId);
    await this.#ensureRunning(runtime);
    await runtime.setThinkingLevel(level);
  }

  async refreshModels(sessionId: string): Promise<void> {
    this.#assertSessionOutsideFork(sessionId);
    const runtime = this.#requireRuntime(sessionId);
    await this.#ensureRunning(runtime);
    await runtime.refreshModels();
  }

  async refreshCommands(sessionId: string): Promise<void> {
    this.#assertSessionOutsideFork(sessionId);
    const runtime = this.#requireRuntime(sessionId);
    await this.#ensureRunning(runtime);
    await runtime.refreshCommands();
  }

  async checkPiIntegration(sessionId: string): Promise<void> {
    this.#assertSessionOutsideFork(sessionId);
    const runtime = this.#requireRuntime(sessionId);
    await this.#ensureRunning(runtime);
    const result = await runtime.probePiIntegration();
    if (result.available) {
      await vscode.window.showInformationMessage(
        `Pi integration connected. Session tree adapter is available as /${result.commandName}.`,
      );
      return;
    }
    await vscode.window.showWarningMessage(
      "Pi integration unavailable. Restart the session or export diagnostics to inspect the bundled adapter.",
    );
  }

  async loadHistory(sessionId: string): Promise<void> {
    this.#assertSessionOutsideFork(sessionId);
    const runtime = this.#requireRuntime(sessionId);
    await this.#ensureRunning(runtime);
    await this.#queueHistory(runtime, true);
  }

  async respondExtensionUi(sessionId: string, requestId: string, response: RpcExtensionUiResponse): Promise<void> {
    await this.#requireRuntime(sessionId).respondExtensionUi(requestId, response);
  }

  async respondQuestion(sessionId: string, requestId: string, response: QuestionDraftSubmission | { cancelled: true }): Promise<void> {
    await this.#requireRuntime(sessionId).respondQuestion(requestId, response);
  }

  diagnosticsSummary(): string {
    const sessions = [...this.#runtimes.values()];
    const operation = this.#forkOperation;
    return [
      `Registry active session: ${this.#activeSessionId ?? "<none>"}`,
      `Registry session count: ${sessions.length}`,
      `Fork operation: ${operation ? `${operation.phase} source=${operation.sourceId} target=${operation.forkId}` : "<none>"}`,
      "",
      ...sessions.flatMap((runtime) => [runtime.diagnosticsSummary(), ""]),
    ].join("\n");
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#emitTimer) clearTimeout(this.#emitTimer);
    await Promise.allSettled([...this.#runtimes.values()].map((runtime) => runtime.dispose()));
    this.#changeEmitter.dispose();
    this.#toastEmitter.dispose();
    this.#setComposerTextEmitter.dispose();
  }

  #restoreRecord(record: PersistedSessionRecord): void {
    this.#records.set(record.id, record);
    this.#runtimes.set(record.id, this.#createRuntime(record));
  }

  #discoverOpenWorkspaceDirectories() {
    return Promise.all((vscode.workspace.workspaceFolders ?? []).map((folder) => this.#discoverWorkingDirectories(folder.uri.fsPath)));
  }

  async #reconcilePersistedWorkingDirectories(): Promise<void> {
    const externalRecords = [...this.#records.values()].filter((record) => !isOpenWorkspaceFolder(record.cwd));
    if (!externalRecords.length) return;
    const discoveries = await this.#discoverOpenWorkspaceDirectories();
    if (!discoveries.length || discoveries.some((discovery) => !discovery.authoritative)) return;
    const allowed = discoveries.flatMap((discovery) => discovery.directories);
    const stale: PersistedSessionRecord[] = [];
    for (const record of externalRecords) {
      const directory = findSessionWorkingDirectory(allowed, record.cwd);
      if (!directory) {
        stale.push(record);
        continue;
      }
      this.#rememberWorkingDirectory(directory);
      this.#runtimes.get(record.id)?.refreshConfigurationState();
    }
    if (!stale.length) return;

    await Promise.all(stale.map(async (record) => {
      const runtime = this.#runtimes.get(record.id);
      if (runtime) await runtime.dispose();
    }));
    for (const record of stale) this.#removeSession(record.id);
    if (this.#activeSessionId && !this.#runtimes.has(this.#activeSessionId)) {
      this.#activeSessionId = [...this.#runtimes.keys()].at(-1) ?? null;
    }
    await this.#persist();
    this.#logger.info(`Removed ${stale.length} FrostPi session record(s) for deleted worktrees.`);
    this.#emitChange();
  }

  async #validateRuntimeWorkingDirectory(runtime: SessionRuntime): Promise<boolean> {
    if (isOpenWorkspaceFolder(runtime.cwd)) return true;
    const discoveries = await this.#discoverOpenWorkspaceDirectories();
    const allowed = discoveries.flatMap((discovery) => discovery.directories);
    const directory = findSessionWorkingDirectory(allowed, runtime.cwd);
    if (directory) {
      this.#rememberWorkingDirectory(directory);
      runtime.refreshConfigurationState();
      return true;
    }
    if (!discoveries.length || discoveries.some((discovery) => !discovery.authoritative)) {
      throw new Error(`Unable to verify ${runtime.cwd} because Git worktree discovery failed.`);
    }

    await runtime.dispose();
    this.#removeSession(runtime.id);
    if (this.#activeSessionId === runtime.id) this.#activeSessionId = [...this.#runtimes.keys()].at(-1) ?? null;
    await this.#persist();
    this.#logger.info("Removed a FrostPi session record for a deleted worktree before process start.");
    this.#toastEmitter.fire({ level: "warning", message: "The session was removed because its worktree no longer exists." });
    this.#emitChange();
    return false;
  }

  async #repairGeneratedTitles(): Promise<void> {
    let changed = false;
    for (const record of this.#records.values()) {
      if (!record.sessionFile || !looksLikeGeneratedSessionName(record.title)) continue;
      const metadata = await readPiSessionMetadata(record.sessionFile);
      const title = metadata?.title && !looksLikeGeneratedSessionName(metadata.title) ? metadata.title : "New session";
      record.title = title;
      this.#runtimes.get(record.id)?.setDisplayTitle(title);
      changed = true;
    }
    if (changed) await this.#persist();
  }

  #createRuntime(record: PersistedSessionRecord): SessionRuntime {
    return new SessionRuntime(
      record.id,
      record.cwd,
      record.title,
      () => readConfiguration(workspaceUriForPath(this.#configurationScopeCwd(record.cwd))),
      this.#proxySecrets,
      this.#logger,
      {
        onChange: (runtime) => this.#handleRuntimeChange(runtime),
        onAgentTurnCompleted: (runtime) => this.#showSystemNotification(runtime, "completed"),
        onExtensionCommandCompletionUnconfirmed: (_runtime, message) => this.#toastEmitter.fire({ level: "warning", message }),
        onEditorText: (runtime, text) => this.#setComposerTextEmitter.fire({ sessionId: runtime.id, text }),
      },
      this.#sessionTreeArtifactPath,
      this.#questionToolArtifactPath,
      record.ephemeral === true,
    );
  }

  async #startRuntime(runtime: SessionRuntime, workingDirectoryValidated = false): Promise<void> {
    const pending = this.#startJobs.get(runtime.id);
    if (pending) return pending;
    if (!workingDirectoryValidated && !await this.#validateRuntimeWorkingDirectory(runtime)) return;

    const sessionFile = this.#records.get(runtime.id)?.sessionFile;
    runtime.markWaitingToStart();
    const job = this.#startQueue.catch(() => undefined).then(async () => {
      if (this.#runtimes.get(runtime.id) !== runtime) return;
      try {
        await runtime.start(sessionFile);
        if (sessionFile) void this.#queueHistory(runtime, false).catch(() => undefined);
      } catch (error) {
        if (this.#runtimes.get(runtime.id) !== runtime) return;
        const message = error instanceof Error ? error.message : String(error);
        this.#toastEmitter.fire({ level: "error", message: `Unable to start Pi: ${message}` });
        throw error;
      }
    });
    this.#startQueue = job.catch(() => undefined);
    this.#startJobs.set(runtime.id, job);
    try {
      await job;
    } finally {
      if (this.#startJobs.get(runtime.id) === job) this.#startJobs.delete(runtime.id);
    }
  }

  #replaceRuntimeWithFork(
    operation: ForkOperation,
    original: PersistedSessionRecord,
    forkName: string,
  ): void {
    const originalRuntime = this.#createRuntime(original);
    const previousStatus = this.#lastStatuses.get(operation.sourceId) ?? operation.runtime.view.status;
    const pendingUiCount = operation.runtime.view.pendingExtensionUi.length;
    operation.runtime.rebindSessionId(operation.forkId);

    this.#runtimes.delete(operation.sourceId);
    this.#lastStatuses.delete(operation.sourceId);
    this.#lastPendingUiCounts.delete(operation.sourceId);

    this.#runtimes.set(operation.forkId, operation.runtime);
    this.#lastStatuses.set(operation.forkId, previousStatus);
    this.#lastPendingUiCounts.set(operation.forkId, pendingUiCount);
    this.#records.set(operation.forkId, {
      id: operation.forkId,
      title: forkName,
      cwd: original.cwd,
      updatedAt: Date.now(),
    });
    this.#temporarySessionIds.add(operation.forkId);

    this.#runtimes.set(operation.sourceId, originalRuntime);
    this.#lastStatuses.set(operation.sourceId, "stopped");
    this.#lastPendingUiCounts.set(operation.sourceId, 0);
    if (operation.resultSelection === "select-result") this.#activeSessionId = operation.forkId;
    else this.#ensureValidActiveSelection();
  }

  async #restoreOriginalAfterFork(operation: ForkOperation): Promise<void> {
    operation.stopPromise ??= operation.runtime.stop();
    await operation.stopPromise.catch(() => undefined);

    if (operation.phase === "reconciling") {
      await operation.runtime.dispose().catch(() => undefined);
      this.#removeSession(operation.forkId);
    }
    if (operation.resultSelection === "select-result") this.#activeSessionId = operation.sourceId;
    else this.#ensureValidActiveSelection();

    const originalRuntime = this.#requireRuntime(operation.sourceId);
    let restartError: unknown;
    try {
      await this.#startRuntime(originalRuntime);
    } catch (error) {
      restartError = error;
    }
    await Promise.resolve(this.#persist()).catch((error: unknown) => this.#logger.error("Failed to persist session collection after Fork recovery", error));
    this.#finishForkOperation(operation);
    this.#emitChange();
    if (restartError) throw restartError instanceof Error ? restartError : new Error("Unable to restart the original session after Fork recovery.", { cause: restartError });
  }

  #finishForkOperation(operation: ForkOperation): void {
    if (this.#forkOperation === operation) this.#forkOperation = null;
  }

  async #withTreeInteraction<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    if (this.#treeInteractionSessions.has(sessionId)) throw new Error("Finish the current session-tree interaction first.");
    this.#treeInteractionSessions.add(sessionId);
    try {
      return await operation();
    } finally {
      this.#treeInteractionSessions.delete(sessionId);
    }
  }

  #assertNoForkOperation(): void {
    if (this.#forkOperation) throw new Error("Wait for the current session Fork to finish or cancel it first.");
  }

  #assertSessionOutsideFork(sessionId: string): void {
    const operation = this.#forkOperation;
    if (operation && (sessionId === operation.sourceId || sessionId === operation.forkId)) {
      throw new Error("Wait for the current session Fork to finish or cancel it first.");
    }
  }

  async #restartRuntime(runtime: SessionRuntime): Promise<void> {
    if (runtime.isEphemeral) throw new Error("Temporary sessions cannot be restarted.");
    if (!await this.#validateRuntimeWorkingDirectory(runtime)) return;
    await runtime.stop().catch(() => undefined);
    await this.#startRuntime(runtime, true);
  }

  async #ensureRunning(runtime: SessionRuntime): Promise<void> {
    const status = runtime.view.status;
    if (runtime.isEphemeral && (status === "stopped" || status === "failed")) {
      throw new Error("This temporary session has stopped and cannot be restarted. Close it and create a new session.");
    }
    if (status === "queued" || status === "stopped" || status === "failed") await this.#startRuntime(runtime);
    if (!this.#runtimes.has(runtime.id)) throw new Error("The session's worktree is no longer available.");
  }

  async #queueHistory(runtime: SessionRuntime, force: boolean): Promise<void> {
    const pending = this.#historyJobs.get(runtime.id);
    if (pending) return pending;
    runtime.markHistoryWaiting();
    const job = this.#historyQueue.catch(() => undefined).then(async () => {
      if (this.#runtimes.get(runtime.id) !== runtime) return;
      await runtime.loadHistory(force);
    });
    this.#historyQueue = job.catch(() => undefined);
    this.#historyJobs.set(runtime.id, job);
    try {
      await job;
    } finally {
      if (this.#historyJobs.get(runtime.id) === job) this.#historyJobs.delete(runtime.id);
    }
  }

  #handleRuntimeChange(runtime: SessionRuntime): void {
    const view = runtime.view;
    const previous = this.#records.get(runtime.id);
    const previousStatus = this.#lastStatuses.get(runtime.id);
    this.#lastStatuses.set(runtime.id, view.status);
    const previousPendingUiCount = this.#lastPendingUiCounts.get(runtime.id) ?? 0;
    this.#lastPendingUiCounts.set(runtime.id, view.pendingExtensionUi.length);
    const inputRequired = previousPendingUiCount === 0 && view.pendingExtensionUi.length > 0;
    if (runtime.id !== this.#activeSessionId && inputRequired) {
      this.#toastEmitter.fire({ level: "info", message: "A background FrostPi session is waiting for input." });
    }
    if (inputRequired) this.#showSystemNotification(runtime, "inputRequired");
    if (previousStatus && previousStatus !== "failed" && view.status === "failed") {
      this.#showSystemNotification(runtime, "failed");
    }
    const metadataChanged = Boolean(previous && (
      previous.title !== view.title ||
      (view.sessionFile !== undefined && previous.sessionFile !== view.sessionFile) ||
      previous.cwd !== view.cwd
    ));
    const runSettled = Boolean(
      previousStatus && ["starting", "running", "stopping"].includes(previousStatus)
      && ["ready", "failed", "stopped"].includes(view.status),
    );
    if (previous && (metadataChanged || runSettled)) {
      const sessionFile = view.sessionFile ?? previous.sessionFile;
      this.#records.set(runtime.id, {
        id: runtime.id,
        title: view.title,
        cwd: view.cwd,
        ...(previous.ephemeral ? { ephemeral: true } : {}),
        ...(sessionFile && !previous.ephemeral ? { sessionFile } : {}),
        updatedAt: Date.now(),
      });
      void this.#persist();
    }
    if (runtime.id === this.#activeSessionId) {
      void vscode.commands.executeCommand("setContext", "frostpi.sessionRunning", view.isStreaming);
    }
    this.#scheduleChange();
  }

  #showSystemNotification(runtime: SessionRuntime, event: SystemNotificationEvent): void {
    if (vscode.window.state.focused) return;
    const scope = workspaceUriForPath(this.#configurationScopeCwd(runtime.view.cwd));
    if (!readConfiguration(scope).experimentalNotificationsEnabled) return;
    const backgroundSession = runtime.id !== this.#activeSessionId;
    const message = event === "inputRequired"
      ? backgroundSession ? "A background FrostPi session is waiting for input." : "FrostPi is waiting for your input."
      : event === "completed"
        ? backgroundSession ? "A background FrostPi session completed an agent turn." : "FrostPi completed an agent turn."
        : "A FrostPi session failed. Open VS Code for details.";
    const title = event === "completed" ? "FrostPi turn completed" : "FrostPi needs your attention";
    const nativeOptions = vscode.env.remoteName === undefined ? {} : { remoteName: vscode.env.remoteName };
    void showWindowsToast(title, message, nativeOptions).then((shown) => {
      if (!shown && !vscode.window.state.focused) this.#showVsCodeNotification(event, message);
    });
  }

  #showVsCodeNotification(event: SystemNotificationEvent, message: string): void {
    if (event === "failed") void vscode.window.showErrorMessage(message);
    else void vscode.window.showInformationMessage(message);
  }

  #scheduleChange(): void {
    if (this.#emitTimer) return;
    this.#emitTimer = setTimeout(() => {
      this.#emitTimer = null;
      this.#emitChange();
    }, 24);
  }

  #emitChange(): void {
    this.#changeEmitter.fire();
  }

  #persist(): Thenable<void> {
    const sessions = [...this.#records.values()].filter((record) => !record.ephemeral && !this.#temporarySessionIds.has(record.id));
    const activeRecord = this.#activeSessionId ? this.#records.get(this.#activeSessionId) : undefined;
    const activeSessionId = this.#activeSessionId && !activeRecord?.ephemeral && !this.#temporarySessionIds.has(this.#activeSessionId)
      ? this.#activeSessionId
      : null;
    const job = this.#persistenceQueue.catch(() => undefined).then(() => this.#persistence.save(activeSessionId, sessions));
    this.#persistenceQueue = job;
    return job;
  }

  async #discardActiveTemporarySession(): Promise<void> {
    const sessionId = this.#activeSessionId;
    if (
      !sessionId
      || !this.#temporarySessionIds.has(sessionId)
      || this.#retainedProvisionalSessionIds.has(sessionId)
    ) return;
    const runtime = this.#runtimes.get(sessionId);
    if (runtime) await runtime.dispose();
    this.#removeSession(sessionId);
    this.#activeSessionId = null;
  }

  #removeSession(sessionId: string): void {
    this.#runtimes.delete(sessionId);
    this.#records.delete(sessionId);
    this.#temporarySessionIds.delete(sessionId);
    this.#retainedProvisionalSessionIds.delete(sessionId);
    this.#lastStatuses.delete(sessionId);
    this.#lastPendingUiCounts.delete(sessionId);
    this.#startJobs.delete(sessionId);
    this.#historyJobs.delete(sessionId);
    this.#treeInteractionSessions.delete(sessionId);
  }

  #rememberWorkingDirectory(directory: SessionWorkingDirectory): void {
    this.#workingDirectoriesByCwd.set(normalizedPath(directory.cwd), directory);
  }

  #configurationScopeCwd(cwd: string): string {
    return this.#workingDirectoriesByCwd.get(normalizedPath(cwd))?.workspaceFolderCwd ?? cwd;
  }

  #withWorkingDirectoryLabel(view: SessionRuntime["view"]): SessionRuntime["view"] {
    const label = this.#workingDirectoryLabel(view.cwd);
    return label.workingDirectoryLabel ? { ...view, ...label } : view;
  }

  #workingDirectoryLabel(cwd: string): { workingDirectoryLabel?: string } {
    if (isOpenWorkspaceFolder(cwd)) return {};
    return { workingDirectoryLabel: this.#workingDirectoriesByCwd.get(normalizedPath(cwd))?.directoryName ?? basename(cwd) };
  }

  #ensureValidActiveSelection(): void {
    if (this.#activeSessionId && this.#runtimes.has(this.#activeSessionId)) return;
    this.#activeSessionId = [...this.#runtimes.keys()].at(-1) ?? null;
  }

  #requireRuntime(sessionId: string): SessionRuntime {
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime) throw new Error(`Unknown FrostPi session: ${sessionId}`);
    return runtime;
  }

  #requireActiveId(): string {
    if (!this.#activeSessionId) throw new Error("No active FrostPi session");
    return this.#activeSessionId;
  }
}

async function pickSessionWorkingDirectory(
  directories: readonly SessionWorkingDirectory[],
): Promise<SessionWorkingDirectory | undefined> {
  if (directories.length <= 1) return directories[0];
  const items = directories.map((directory) => ({
    label: directory.isCurrent
      ? "$(folder-active) Current workspace"
      : `$(git-branch) ${directory.branch ?? (directory.detached ? "Detached HEAD" : directory.directoryName)}`,
    description: directory.branch && directory.isCurrent
      ? `${directory.branch} · ${directory.directoryName}`
      : directory.directoryName,
    detail: directory.cwd,
    directory,
  }));
  const selected = await vscode.window.showQuickPick(items, {
    title: `New Pi session · ${directories[0]?.directoryName ?? "workspace"}`,
    placeHolder: "Choose where Pi should run",
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true,
  });
  return selected?.directory;
}

function isOpenWorkspaceFolder(cwd: string): boolean {
  return Boolean(vscode.workspace.workspaceFolders?.some((folder) => samePath(folder.uri.fsPath, cwd)));
}

function forkSessionName(title: string): string {
  const source = title.trim();
  return (source ? `Fork: ${source}` : "Fork session").slice(0, 160);
}

function compactCommandInstructions(text: string): string | null {
  const normalized = normalizePiSlashPrompt(text);
  if (normalized === "/compact") return "";
  return normalized.startsWith("/compact ") ? normalized.slice("/compact ".length).trim() : null;
}

async function confirmClose(runtime: SessionRuntime): Promise<boolean> {
  const view = runtime.view;
  const ephemeralWithPrompt = view.isEphemeral
    && view.conversationItems.some((item) => item.type === "turn" && item.userMessage?.role === "user");
  if (!ephemeralWithPrompt && !view.isStreaming && view.pendingExtensionUi.length === 0) return true;
  const choice = await vscode.window.showWarningMessage(
    ephemeralWithPrompt
      ? "Closing this temporary session will permanently discard its conversation. This cannot be undone."
      : view.pendingExtensionUi.length > 0
        ? "Closing this FrostPi session will cancel its pending user interaction and stop its Pi process. Persisted Pi history is retained."
        : "Closing this FrostPi session will stop its active response and tools. Persisted Pi history is retained.",
    { modal: true },
    "Close session",
  );
  return choice === "Close session";
}

async function confirmRestart(runtimes: readonly SessionRuntime[]): Promise<boolean> {
  const disruptive = runtimes.some((runtime) => runtime.view.isStreaming || runtime.view.pendingExtensionUi.length > 0);
  if (!disruptive) return true;
  const choice = await vscode.window.showWarningMessage(
    runtimes.length > 1
      ? "Restarting all FrostPi sessions will stop active responses, tools, and pending extension UI requests. Persisted Pi history is retained."
      : "Restarting this FrostPi session will stop its active response, tools, and pending extension UI requests. Persisted Pi history is retained.",
    { modal: true },
    runtimes.length > 1 ? "Restart all sessions" : "Restart session",
  );
  return Boolean(choice);
}

function activeWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const editorUri = vscode.window.activeTextEditor?.document.uri;
  return (editorUri ? vscode.workspace.getWorkspaceFolder(editorUri) : undefined) ?? vscode.workspace.workspaceFolders?.[0];
}

function samePath(left: string, right: string): boolean {
  return normalizedPath(left) === normalizedPath(right);
}

function normalizedPath(path: string): string {
  const value = normalize(resolve(path));
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function looksLikeGeneratedSessionName(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d+)?Z?_[0-9a-f-]{8,}$/i.test(value);
}
