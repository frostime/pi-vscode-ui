import { randomUUID } from "node:crypto";
import { access, unlink } from "node:fs/promises";
import { basename, normalize, resolve } from "node:path";

import type { RpcExtensionUiResponse, StreamingBehavior, ThinkingLevel } from "@frostime/pi-rpc";

import type { WebviewImageInput } from "../shared/bridge/webviewToHost.js";
import type { QuestionDraftSubmission } from "../shared/question-tool/questionToolProtocol.js";
import type { SessionRuntimeStatus, SessionSummaryView, SessionViewModel, WorkspaceViewModel } from "../shared/model/sessionViewModel.js";
import { sameCanonicalPath } from "../core/_shared/canonicalPath.js";
import { parseHostCommand } from "../core/sessions/hostCommands.js";
import { SessionRuntime } from "../core/index.js";
import type { RuntimeLogger } from "../core/diagnostics/RuntimeLogger.js";
import { readConfiguration, readHostProxy } from "./readConfiguration.js";
import type { ClientHost, HostEventEmitter, HostQuickPickItem } from "./clientHost.js";
import { readPiSessionMetadata, type PiSessionCatalogEntry } from "./catalog/SessionCatalog.js";
import { pickPiSession } from "./catalog/SessionCatalogPicker.js";
import { parseLaunchArguments } from "./sessions/parseLaunchArguments.js";
import { SessionPersistence } from "./sessions/SessionPersistence.js";
import { confirmDraftReplacement, pickBranchEnd, pickBranchSummary } from "./pickers/SessionTreePicker.js";
import {
  discoverSessionWorkingDirectories,
  findSessionWorkingDirectory,
  type SessionWorkingDirectory,
} from "./sessions/SessionWorkingDirectories.js";
import type { PersistedSessionRecord } from "./sessions/sessionTypes.js";

export interface RegistryToast {
  level: "info" | "warning" | "error";
  message: string;
}

type SystemNotificationEvent = "inputRequired" | "failed" | "completed";
type DiscoverSessionWorkingDirectories = typeof discoverSessionWorkingDirectories;

/** Title FrostPi shows until Pi names the session; also the marker for an unnamed record. */
const NEW_SESSION_TITLE = "New session";

export type ForkResultSelection = "select-result" | "preserve-sidebar-selection";

export interface CreateSessionOptions {
  /**
   * `preserve-sidebar-selection` is for a Session that opens in its own presentation:
   * the sidebar keeps its Session, including an unretained Provisional one.
   */
  selection?: ForkResultSelection;
  /** Start in this Session's working directory without asking, while it is still an allowed directory. */
  workingDirectoryOf?: string;
  /** Runs once the entry exists and before its Pi process starts, so a presentation can show the startup. */
  onRegistered?: (sessionId: string) => void | Promise<void>;
}

interface ForkOperation {
  phase: "waiting-for-pi" | "reconciling";
  sourceId: string;
  forkId: string;
  runtime: SessionRuntime;
  resultSelection: ForkResultSelection;
  cancelRequested: boolean;
  stopPromise?: Promise<void>;
}

/** A Fork from a busy Session, running in a second Pi process that is not yet a Session. */
interface ProcessForkOperation {
  sourceId: string;
  forkId: string;
  runtime: SessionRuntime;
  /** Pi has forked; from here the Fork is completed rather than cancelled. */
  committed: boolean;
  cancelRequested: boolean;
  stopPromise?: Promise<void>;
}

export interface SessionRegistryOptions {
  logger: RuntimeLogger;
  discoverWorkingDirectories?: DiscoverSessionWorkingDirectories;
  /** Bundled session-tree adapter; hosts without one keep the tree command unavailable. */
  sessionTreeArtifactPath?: string;
  /** Bundled question-tool adapter; hosts without one keep the question tool unavailable. */
  questionToolArtifactPath?: string;
  /** Native VS Code keeps its historical fallback; Desktop restores only an explicitly saved selection. */
  restoreSelection?: "saved-or-first" | "saved-only";
  /** Host metadata may associate New/Resume identities before presentation; forks name their source. */
  onSessionOpened?: (sessionId: string, sourceSessionId?: string) => void;
}

export class SessionRegistry {
  readonly #host: ClientHost;
  readonly #runtimes = new Map<string, SessionRuntime>();
  readonly #records = new Map<string, PersistedSessionRecord>();
  readonly #persistence: SessionPersistence;
  readonly #logger: RuntimeLogger;
  readonly #changeEmitter: HostEventEmitter<void>;
  readonly #toastEmitter: HostEventEmitter<RegistryToast>;
  readonly #setComposerTextEmitter: HostEventEmitter<{ sessionId: string; text: string }>;
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
  readonly #restoreOnlySavedSelection: boolean;
  readonly #onSessionOpened: SessionRegistryOptions["onSessionOpened"];

  #activeSessionId: string | null = null;
  #forkOperation: ForkOperation | null = null;
  /**
   * Forks running in a second Pi process, by Fork id. Until Pi has written the Fork's own
   * file they are not Sessions: they are in neither `#runtimes` nor `#records`, so the
   * collection, its menus and commands cannot select, stop or delete them.
   */
  readonly #processForks = new Map<string, ProcessForkOperation>();
  #sessionCreationInProgress = 0;
  #startQueue: Promise<void> = Promise.resolve();
  #historyQueue: Promise<void> = Promise.resolve();
  #persistenceQueue: Promise<void> = Promise.resolve();
  #emitTimer: ReturnType<typeof setTimeout> | null = null;
  #disposed = false;

  readonly onDidChange: HostEventEmitter<void>["event"];
  readonly onDidToast: HostEventEmitter<RegistryToast>["event"];
  readonly onDidSetComposerText: HostEventEmitter<{ sessionId: string; text: string }>["event"];

  constructor(
    host: ClientHost,
    options: SessionRegistryOptions,
  ) {
    this.#host = host;
    this.#persistence = new SessionPersistence(host.storage);
    this.#logger = options.logger;
    this.#discoverWorkingDirectories = options.discoverWorkingDirectories ?? discoverSessionWorkingDirectories;
    this.#sessionTreeArtifactPath = options.sessionTreeArtifactPath;
    this.#questionToolArtifactPath = options.questionToolArtifactPath;
    this.#restoreOnlySavedSelection = options.restoreSelection === "saved-only";
    this.#onSessionOpened = options.onSessionOpened;
    this.#changeEmitter = host.createEventEmitter<void>();
    this.#toastEmitter = host.createEventEmitter<RegistryToast>();
    this.#setComposerTextEmitter = host.createEventEmitter<{ sessionId: string; text: string }>();
    this.onDidChange = this.#changeEmitter.event;
    this.onDidToast = this.#toastEmitter.event;
    this.onDidSetComposerText = this.#setComposerTextEmitter.event;
    const stored = this.#persistence.load();
    for (const record of stored.sessions) this.#restoreRecord(record);
    this.#activeSessionId = stored.activeSessionId && this.#runtimes.has(stored.activeSessionId)
      ? stored.activeSessionId
      : this.#restoreOnlySavedSelection ? null : stored.sessions[0]?.id ?? null;
  }

  get activeSessionId(): string | null {
    return this.#activeSessionId;
  }

  async ensureInitialSession(): Promise<void> {
    this.#assertOpen();
    if (!this.#host.workspace.getWorkspaceFolders().length) return;
    await this.#reconcilePersistedWorkingDirectories();
    this.#assertOpen();
    await this.#repairPlaceholderTitles();
    this.#assertOpen();
    // Never invent a new session on open. Empty workspaces stay on the onboarding home until
    // the user creates or resumes a session. Optionally start only an already-selected one.
    const active = this.#activeSessionId ? this.#runtimes.get(this.#activeSessionId) : undefined;
    if (active && readConfiguration(this.#host, this.#configurationScopeCwd(active.cwd)).startSessionOnOpen) {
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

  /** The directory whose settings apply to this Session: its workspace folder, also for a worktree outside it. */
  configurationScope(sessionId: string): string | undefined {
    const runtime = this.#runtimes.get(sessionId);
    return runtime ? this.#configurationScopeCwd(runtime.view.cwd) : undefined;
  }

  retainProvisionalSession(sessionId: string): void {
    this.#requireRuntime(sessionId);
    if (this.#temporarySessionIds.has(sessionId)) this.#retainedProvisionalSessionIds.add(sessionId);
  }

  snapshot(): WorkspaceViewModel {
    const folder = this.#host.workspace.activeWorkspaceFolder();
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

  async createSession(ephemeral = false, options: CreateSessionOptions = {}): Promise<string | undefined> {
    return this.#withSessionCreation(async () => {
      const inherited = options.workingDirectoryOf
        ? await this.#workingDirectoryOfSession(options.workingDirectoryOf)
        : undefined;
      this.#assertOpen();
      let directory = inherited;
      if (!directory) {
        const cwd = this.#sourceWorkspaceCwd("creating a Pi session");
        const discovery = await this.#discoverWorkingDirectories(cwd);
        this.#assertOpen();
        directory = await this.#pickSessionWorkingDirectory(discovery.directories);
      }
      if (!directory) return undefined;
      return this.#createSessionInDirectory(directory, ephemeral, undefined, options);
    });
  }

  async createSessionWithCustomArguments(): Promise<string | undefined> {
    return this.#withSessionCreation(async () => {
      const cwd = this.#sourceWorkspaceCwd("creating a Pi session");
      // Tokenization handles input syntax only; the Pi CLI owns option semantics.
      // Do not reinterpret, sanitize or log these per-launch flag values.
      const raw = await this.#host.window.showInputBox({
        title: "New Pi session · custom arguments",
        placeHolder: 'e.g. --model sonnet --system-prompt "focus on tests"',
        prompt:
          "Extra Pi CLI arguments appended to this launch as-is. Whitespace separates arguments; double quotes group one argument. Not validated.",
      });
      this.#assertOpen();
      if (raw === undefined) return undefined;
      const customArguments = parseLaunchArguments(raw);
      if (customArguments.length === 0 || customArguments.every((argument) => argument.length === 0)) return undefined;
      const discovery = await this.#discoverWorkingDirectories(cwd);
      this.#assertOpen();
      const directory = await this.#pickSessionWorkingDirectory(discovery.directories);
      if (!directory) return undefined;
      return this.#createSessionInDirectory(directory, false, customArguments);
    });
  }

  async resumeSession(): Promise<string | undefined> {
    this.#assertOpen();
    this.#assertNoForkOperation();
    const cwd = this.#sourceWorkspaceCwd("resuming a Pi session");
    const discovery = await this.#discoverWorkingDirectories(cwd);
    this.#assertOpen();
    const configuration = readConfiguration(this.#host, cwd);
    const entry = await pickPiSession(this.#host, discovery.directories, configuration.piArguments, configuration.runtimeCompatibility);
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
    this.#assertOpen();
    this.#assertNoForkOperation();
    const existing = [...this.#records.values()].find((record) => record.sessionFile && samePath(record.sessionFile, entry.path));
    if (existing) {
      this.#onSessionOpened?.(existing.id);
      if (workingDirectory) this.#rememberWorkingDirectory(workingDirectory, existing.cwd);
      if (existing.id !== this.#activeSessionId) await this.#discardActiveTemporarySession();
      await this.activateSession(existing.id);
      return existing.id;
    }

    await this.#discardActiveTemporarySession();
    this.#assertOpen();
    const id = randomUUID();
    const record: PersistedSessionRecord = {
      id,
      title: entry.title,
      cwd: entry.cwd,
      sessionFile: entry.path,
      updatedAt: entry.updatedAt,
    };
    this.#records.set(id, record);
    if (workingDirectory) this.#rememberWorkingDirectory(workingDirectory, record.cwd);
    const runtime = this.#createRuntime(record);
    this.#runtimes.set(id, runtime);
    this.#activeSessionId = id;
    this.#onSessionOpened?.(id);
    await this.#persist();
    this.#emitChange();
    await this.#startRuntime(runtime, workingDirectoryValidated);
    return id;
  }

  /** The source Session's directory, only while workspace discovery still allows it. */
  async #workingDirectoryOfSession(sessionId: string): Promise<SessionWorkingDirectory | undefined> {
    const source = this.#runtimes.get(sessionId);
    if (!source) return undefined;
    const discoveries = await this.#discoverOpenWorkspaceDirectories();
    return findSessionWorkingDirectory(discoveries.flatMap((discovery) => discovery.directories), source.cwd);
  }

  async #createSessionInDirectory(
    directory: SessionWorkingDirectory,
    ephemeral: boolean,
    customArguments?: readonly string[],
    options: CreateSessionOptions = {},
  ): Promise<string> {
    this.#assertOpen();
    const preserveSidebar = options.selection === "preserve-sidebar-selection";
    if (!preserveSidebar) await this.#discardActiveTemporarySession();
    this.#assertOpen();
    const id = randomUUID();
    const record: PersistedSessionRecord = {
      id,
      title: NEW_SESSION_TITLE,
      cwd: directory.cwd,
      ...(ephemeral ? { ephemeral: true } : {}),
      updatedAt: Date.now(),
    };
    this.#records.set(id, record);
    this.#rememberWorkingDirectory(directory);
    if (!ephemeral) this.#temporarySessionIds.add(id);
    const runtime = this.#createRuntime(record, customArguments);
    this.#runtimes.set(id, runtime);
    if (preserveSidebar) this.#ensureValidActiveSelection();
    else this.#activeSessionId = id;
    this.#onSessionOpened?.(id);
    await this.#persist();
    this.#emitChange();
    // A presentation that cannot open must not leave an entry that never starts.
    let presentationError: unknown;
    try {
      await options.onRegistered?.(id);
    } catch (error) {
      presentationError = error;
    }
    await this.#startRuntime(runtime, true);
    if (presentationError) throw presentationError instanceof Error ? presentationError : new Error("The new session could not be presented.", { cause: presentationError });
    return id;
  }

  async activateSession(sessionId: string): Promise<void> {
    this.#assertNoForkOperation();
    const runtime = this.#requireRuntime(sessionId);
    if (sessionId !== this.#activeSessionId) await this.#discardActiveTemporarySession();
    this.#assertOpen();
    this.#activeSessionId = sessionId;
    await this.#persist();
    this.#emitChange();
    if (runtime.view.status === "stopped" && !runtime.isEphemeral) await this.#startRuntime(runtime);
  }

  /**
   * Starts a restored Session that a presentation is about to show, as selecting it in
   * the sidebar does, so its history loads without a prompt first. Failures are
   * reported by the start itself.
   */
  async startIfStopped(sessionId: string): Promise<void> {
    const runtime = this.#requireRuntime(sessionId);
    if (runtime.view.status === "stopped" && !runtime.isEphemeral) await this.#startRuntime(runtime);
  }

  /** Clear the foreground without closing, discarding or starting any Runtime. */
  async clearActiveSession(): Promise<void> {
    this.#assertOpen();
    this.#assertNoForkOperation();
    if (this.#activeSessionId === null) return;
    this.#activeSessionId = null;
    await this.#persist();
    this.#emitChange();
  }

  async closeSession(sessionId: string): Promise<void> {
    this.#assertSessionOutsideFork(sessionId);
    const runtime = this.#requireRuntime(sessionId);
    if (!await confirmClose(this.#host, runtime)) return;
    await runtime.dispose();
    this.#removeSession(sessionId);
    if (this.#activeSessionId === sessionId) {
      // Stable open order: prefer the most recently opened remaining session.
      this.#activeSessionId = [...this.#runtimes.keys()].at(-1) ?? null;
    }
    await this.#persist();
    this.#emitChange();
  }

  /**
   * Stops the Session's Pi process and keeps the Session listed. Selecting it, opening it
   * in a tab or sending a prompt starts it again from its file. A Temporary Session has no
   * file to start from, so it can only be closed.
   */
  async stopSession(sessionId: string): Promise<void> {
    this.#assertSessionOutsideFork(sessionId);
    const runtime = this.#requireRuntime(sessionId);
    if (runtime.isEphemeral) throw new Error("A temporary session cannot start again once stopped. Close it instead.");
    // A start already under way finishes first, so it cannot bring the process back afterwards.
    await this.#startJobs.get(sessionId)?.catch(() => undefined);
    const status = runtime.view.status;
    if (status === "stopped" || status === "stopping") return;
    if (!await confirmStop(this.#host, runtime)) return;
    await runtime.stop();
    this.#emitChange();
  }

  /**
   * Deletes the Session: stops its Pi process, removes Pi's session file (to the trash
   * where the host has one, as Pi's own session picker does) and closes it. Other files
   * of the same session tree, such as forks, stay. If the file cannot be removed, the
   * Session stays listed, stopped.
   */
  async deleteSession(sessionId: string): Promise<void> {
    this.#assertSessionOutsideFork(sessionId);
    // The Fork's process reads this file; it must outlive the Fork.
    if (this.#processForkOf(sessionId)) throw new Error("Wait for the Fork of this session to finish or cancel it first.");
    const runtime = this.#requireRuntime(sessionId);
    if (runtime.isEphemeral) throw new Error("A temporary session is never saved, so there is nothing to delete. Close it instead.");
    const sessionFile = runtime.view.sessionFile ?? this.#records.get(sessionId)?.sessionFile;
    if (sessionFile && !sessionFile.endsWith(".jsonl")) throw new Error(`Refusing to delete a file that is not a Pi session: ${sessionFile}`);
    const canTrash = this.#host.moveToTrash !== undefined;
    const choice = await this.#host.window.showWarningDialog(
      sessionFile
        ? `Delete the session "${runtime.view.title}"? Its Pi session file will be ${canTrash ? "moved to the trash" : "permanently deleted"}: ${sessionFile}`
        : `Delete the session "${runtime.view.title}"? Pi has not saved it yet, so it is only closed.`,
      ["Delete session"],
    );
    if (choice !== "Delete session") return;
    await this.#startJobs.get(sessionId)?.catch(() => undefined);
    await runtime.stop();
    this.#emitChange();
    if (sessionFile) await this.#removeSessionFile(sessionFile);
    await runtime.dispose();
    this.#removeSession(sessionId);
    if (this.#activeSessionId === sessionId) this.#activeSessionId = [...this.#runtimes.keys()].at(-1) ?? null;
    await this.#persist();
    this.#emitChange();
  }

  async #removeSessionFile(sessionFile: string): Promise<void> {
    const exists = async (): Promise<boolean> => access(sessionFile).then(() => true, () => false);
    if (this.#host.moveToTrash) {
      try {
        await this.#host.moveToTrash(sessionFile);
        return;
      } catch (error) {
        if (!await exists()) return;
        const reason = error instanceof Error ? error.message : String(error);
        const choice = await this.#host.window.showWarningDialog(
          `The session file could not be moved to the trash (${reason}). Delete it permanently instead? ${sessionFile}`,
          ["Delete permanently"],
        );
        if (choice !== "Delete permanently") throw new Error("The session was stopped but not deleted.");
      }
    }
    try {
      await unlink(sessionFile);
    } catch (error) {
      // Pi writes the file only once there is something to save.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }

  async retrySession(sessionId?: string): Promise<void> {
    const targetId = sessionId ?? this.#requireActiveId();
    this.#assertSessionOutsideFork(targetId);
    const runtime = this.#requireRuntime(targetId);
    if (runtime.isEphemeral) throw new Error("Temporary sessions cannot be restarted.");
    if (!await confirmRestart(this.#host, [runtime])) return;
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
    if (!await confirmRestart(this.#host, restartable)) return;
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
    const hostCommand = parseHostCommand(text);
    // A command this runtime cannot be answered for stays the runtime's own text.
    if (hostCommand && runtime.answersHostCommand(hostCommand.name)) {
      // An ordinary prompt waits in the queue until compaction ends; a FrostPi command acts now, so it cannot.
      if (runtime.view.isCompacting) throw new Error("Wait for context compaction to finish before running this command.");
      if (images.length > 0) throw new Error(`/${hostCommand.name} does not support image attachments.`);
      // Host commands never become a user prompt and never promote a Provisional Session.
      switch (hostCommand.name) {
        case "compact":
          await runtime.compact(hostCommand.argument || undefined);
          runtime.clearComposerSeed();
          return;
        case "new":
          await this.startNewConversation(sessionId);
          return;
        case "reload":
          await this.#withTreeInteraction(sessionId, () => runtime.reloadResources());
          return;
        case "name":
        case "alias":
          await this.#renameFromCommand(sessionId, hostCommand.argument);
          return;
      }
    }
    await runtime.sendPrompt(text, images, streamingBehavior);
    runtime.clearComposerSeed();
    if (this.#temporarySessionIds.delete(sessionId)) {
      this.#retainedProvisionalSessionIds.delete(sessionId);
      await this.#persist();
    }
  }

  /**
   * `/new` keeps the application identity and its presentation; only Pi's conversation
   * is replaced. Nothing here changes until Pi commits. From that point the entry is
   * Provisional again, because the new conversation has no file to restore until its
   * first prompt, and retained, because the user chose to continue in it. That holds
   * even when loading the new conversation then fails: the old file is no longer this
   * entry's conversation and must not be what a restart reopens.
   */
  async startNewConversation(sessionId: string): Promise<{ cancelled: boolean }> {
    this.#assertSessionOutsideFork(sessionId);
    // /new is a session-tree interaction too: a branch switch or a second /new must not interleave.
    return this.#withTreeInteraction(sessionId, async () => {
      const runtime = this.#requireRuntime(sessionId);
      await this.#ensureRunning(runtime);
      if (!await confirmNewConversation(this.#host, runtime)) return { cancelled: true };

      let committed = false;
      const onCommitted = (): void => {
        committed = true;
        if (runtime.isEphemeral) return;
        this.#temporarySessionIds.add(sessionId);
        this.#retainedProvisionalSessionIds.add(sessionId);
        // The earlier conversation's file stops being this entry's restart target.
        const record = this.#records.get(sessionId);
        if (record) this.#records.set(sessionId, { id: record.id, title: record.title, cwd: record.cwd, updatedAt: Date.now() });
      };
      try {
        return await runtime.startNewConversation(onCommitted);
      } finally {
        if (committed && !this.#disposed) {
          await Promise.resolve(this.#persist()).catch(() => undefined);
          this.#emitChange();
        }
      }
    });
  }

  async restoreQueuedPrompts(sessionId: string) {
    this.#assertSessionOutsideFork(sessionId);
    // A recovery request must not start/restart a process with an empty queue.
    return this.#requireRuntime(sessionId).restoreQueuedPrompts();
  }

  async abort(sessionId = this.#requireActiveId()): Promise<void> {
    this.#assertSessionOutsideFork(sessionId);
    await this.#requireRuntime(sessionId).abort();
  }

  async cancelFork(sessionId: string): Promise<void> {
    const processFork = this.#processForkOf(sessionId);
    if (processFork) {
      if (processFork.committed) throw new Error("Pi has already created the Fork; it opens in a moment.");
      processFork.cancelRequested = true;
      processFork.stopPromise ??= processFork.runtime.stop();
      await processFork.stopPromise;
      return;
    }
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
    this.#assertNoSessionCreation();
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
    if (forkNeedsOwnProcess(runtime)) {
      return this.#withSessionCreation(() => this.#forkInNewProcess(runtime, original, original.sessionFile!, entryId, resultSelection));
    }
    const operation: ForkOperation = {
      phase: "waiting-for-pi",
      sourceId: sessionId,
      forkId: randomUUID(),
      runtime,
      resultSelection,
      cancelRequested: false,
    };
    this.#assertNoSessionCreation();
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

  /**
   * Fork while the source is busy. Pi's fork replaces the conversation of the process
   * that runs it, which would end the running reply, so a second Pi process opens the
   * same session file and forks there. The source process is never touched.
   *
   * Until Pi has written the Fork's own file and its history has loaded, the second
   * process belongs to this operation alone (`#processForks`): it is not a Session, so
   * nothing can select, stop or delete it, and in particular nothing can mistake the
   * source's file, which that process has open, for the Fork's. Only then does the Fork
   * join the collection. A failed or cancelled Fork disposes its process and touches no
   * file.
   */
  async #forkInNewProcess(
    source: SessionRuntime,
    original: PersistedSessionRecord,
    sourceFile: string,
    entryId: string,
    resultSelection: ForkResultSelection,
  ): Promise<{ cancelled: boolean; forkSessionId?: string }> {
    const forkId = randomUUID();
    const forkName = forkSessionName(source.view.title);
    const runtime = this.#createRuntime({ id: forkId, title: forkName, cwd: original.cwd, updatedAt: Date.now() });
    const operation: ProcessForkOperation = { sourceId: source.id, forkId, runtime, committed: false, cancelRequested: false };
    this.#processForks.set(forkId, operation);
    let listed = false;
    try {
      await this.#startProcessFork(runtime, sourceFile);
      if (operation.cancelRequested) return { cancelled: true };
      if (runtime.view.status !== "ready") throw new Error(runtime.view.error ?? "The Pi process for the Fork did not start.");
      // The target may lie anywhere in the source's history: load all of it.
      await this.#loadProcessForkHistory(runtime);
      if (operation.cancelRequested) return { cancelled: true };
      if (runtime.view.historyStatus !== "loaded") throw new Error("Unable to load the session history for the Fork.");
      const result = await runtime.executeFork(entryId);
      if (result.cancelled || operation.cancelRequested) return { cancelled: true };
      operation.committed = true;
      await runtime.reconcileFork(forkName, { id: forkId, text: result.text, images: result.images });
      const forkFile = runtime.view.sessionFile;
      if (!forkFile || samePath(forkFile, sourceFile)) throw new Error("Pi did not create a separate file for the Fork.");
      // The Fork joins the collection as Provisional, like a Fork from an idle Session.
      this.#processForks.delete(forkId);
      this.#records.set(forkId, { id: forkId, title: runtime.view.title, cwd: runtime.view.cwd, sessionFile: forkFile, updatedAt: Date.now() });
      this.#runtimes.set(forkId, runtime);
      this.#lastStatuses.set(forkId, runtime.view.status);
      this.#temporarySessionIds.add(forkId);
      listed = true;
      this.#onSessionOpened?.(forkId, source.id);
      if (resultSelection === "select-result") this.#activeSessionId = forkId;
      await Promise.resolve(this.#persist()).catch((error: unknown) => this.#logger.error("Failed to persist session collection after Fork", error));
      this.#emitChange();
      return { cancelled: false, forkSessionId: forkId };
    } catch (error) {
      // Stopping the process to cancel makes whatever step was under way fail.
      if (operation.cancelRequested && !operation.committed) return { cancelled: true };
      throw error;
    } finally {
      this.#processForks.delete(forkId);
      if (!listed) await runtime.dispose().catch(() => undefined);
    }
  }

  /** Starts a Fork's own process from the source's file, in turn with every other start. */
  async #startProcessFork(runtime: SessionRuntime, sourceFile: string): Promise<void> {
    this.#assertOpen();
    runtime.markWaitingToStart();
    const job = this.#startQueue.catch(() => undefined).then(() => runtime.start(sourceFile));
    this.#startQueue = job.catch(() => undefined);
    await job;
  }

  /** Loads a Fork process's full history, in turn with every other history load. */
  async #loadProcessForkHistory(runtime: SessionRuntime): Promise<void> {
    runtime.markHistoryWaiting();
    const job = this.#historyQueue.catch(() => undefined).then(() => runtime.loadHistory(true));
    this.#historyQueue = job.catch(() => undefined);
    await job;
  }

  /** The Fork running in a second process for this source Session, if any. */
  #processForkOf(sourceId: string): ProcessForkOperation | undefined {
    return [...this.#processForks.values()].find((operation) => operation.sourceId === sourceId);
  }

  async branchHere(sessionId: string, entryId: string, hasDraft: boolean): Promise<{ cancelled: boolean }> {
    return this.#withTreeInteraction(sessionId, async () => {
      this.#assertNoForkOperation();
      const runtime = this.#requireRuntime(sessionId);
      await this.#ensureRunning(runtime);
      if (hasDraft && !await confirmDraftReplacement(this.#host)) return { cancelled: true };
      const summary = await pickBranchSummary(this.#host);
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
      const selected = await pickBranchEnd(this.#host, await runtime.listBranchEnds(branchPointId));
      if (!selected || selected.isCurrent) return { cancelled: true };
      if (selected.isEditable && hasDraft && !await confirmDraftReplacement(this.#host)) return { cancelled: true };
      const summary = await pickBranchSummary(this.#host);
      if (!summary) return { cancelled: true };
      const result = await runtime.navigateTree(selected.targetId, summary);
      if (result.seed) runtime.setComposerSeed(result.seed);
      return { cancelled: result.cancelled };
    });
  }

  /** `/name` and `/alias`: with a name, rename at once; without one, ask for it. */
  async #renameFromCommand(sessionId: string, argument: string): Promise<void> {
    const current = this.#requireRuntime(sessionId).view.title;
    const name = argument || await this.#host.window.showInputBox({
      title: "Rename FrostPi session",
      value: current,
      prompt: "The name is shown in the session list and the editor tab.",
      validateInput: (value) => value.trim().length > MAX_SESSION_NAME_LENGTH ? `A session name can have at most ${MAX_SESSION_NAME_LENGTH} characters.` : undefined,
    });
    const normalized = name?.trim();
    if (!normalized || normalized === current) return;
    if (normalized.length > MAX_SESSION_NAME_LENGTH) throw new Error(`A session name can have at most ${MAX_SESSION_NAME_LENGTH} characters.`);
    await this.rename(sessionId, normalized);
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
      this.#host.window.showInformation(
        `Pi integration connected. Session tree adapter is available as /${result.commandName}.`,
      );
      return;
    }
    this.#host.window.showWarning(
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
      `Forks in a second process: ${this.#processForks.size === 0 ? "<none>" : [...this.#processForks.values()].map((fork) => `source=${fork.sourceId} target=${fork.forkId}${fork.committed ? " committed" : ""}`).join(", ")}`,
      "",
      ...sessions.flatMap((runtime) => [runtime.diagnosticsSummary(), ""]),
    ].join("\n");
  }

  /** Wait for metadata saves already queued by Registry actions; does not wait for agent turns. */
  async flushPersistence(): Promise<void> {
    await this.#persistenceQueue;
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#emitTimer) clearTimeout(this.#emitTimer);
    await Promise.allSettled([...this.#runtimes.values(), ...[...this.#processForks.values()].map((operation) => operation.runtime)].map((runtime) => runtime.dispose()));
    this.#changeEmitter.dispose();
    this.#toastEmitter.dispose();
    this.#setComposerTextEmitter.dispose();
  }

  #restoreRecord(record: PersistedSessionRecord): void {
    this.#records.set(record.id, record);
    this.#runtimes.set(record.id, this.#createRuntime(record));
  }

  #sourceWorkspaceCwd(activity: string): string {
    const folder = this.#host.workspace.activeWorkspaceFolder();
    if (!folder) throw new Error(`Open a workspace folder before ${activity}.`);
    return folder.uri.fsPath;
  }

  #discoverOpenWorkspaceDirectories() {
    return Promise.all(this.#host.workspace.getWorkspaceFolders().map((folder) => this.#discoverWorkingDirectories(folder.uri.fsPath)));
  }

  async #reconcilePersistedWorkingDirectories(): Promise<void> {
    const externalRecords = [...this.#records.values()].filter((record) => !this.#isOpenWorkspaceFolder(record.cwd));
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
      this.#rememberWorkingDirectory(directory, record.cwd);
      this.#runtimes.get(record.id)?.refreshConfigurationState();
    }
    if (!stale.length) return;

    await Promise.all(stale.map(async (record) => {
      const runtime = this.#runtimes.get(record.id);
      if (runtime) await runtime.dispose();
    }));
    for (const record of stale) this.#removeSession(record.id);
    if (this.#activeSessionId && !this.#runtimes.has(this.#activeSessionId)) {
      this.#activeSessionId = this.#restoreOnlySavedSelection ? null : [...this.#runtimes.keys()].at(-1) ?? null;
    }
    await this.#persist();
    this.#logger.info(`Removed ${stale.length} FrostPi session record(s) for deleted worktrees.`);
    this.#emitChange();
  }

  async #validateRuntimeWorkingDirectory(runtime: SessionRuntime): Promise<boolean> {
    if (this.#isOpenWorkspaceFolder(runtime.cwd)) return true;
    const discoveries = await this.#discoverOpenWorkspaceDirectories();
    const allowed = discoveries.flatMap((discovery) => discovery.directories);
    const directory = findSessionWorkingDirectory(allowed, runtime.cwd);
    if (directory) {
      this.#rememberWorkingDirectory(directory, runtime.cwd);
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

  /** Adopt the name already stored in Pi's file for records whose title is still a placeholder. */
  async #repairPlaceholderTitles(): Promise<void> {
    let changed = false;
    for (const record of this.#records.values()) {
      if (!record.sessionFile || !isPlaceholderSessionTitle(record.title)) continue;
      const metadata = await readPiSessionMetadata(record.sessionFile);
      const title = metadata?.storedName ?? NEW_SESSION_TITLE;
      if (title === record.title) continue;
      record.title = title;
      this.#runtimes.get(record.id)?.setDisplayTitle(title);
      changed = true;
    }
    if (changed) await this.#persist();
  }

  #createRuntime(record: PersistedSessionRecord, customArguments?: readonly string[]): SessionRuntime {
    return new SessionRuntime(
      record.id,
      record.cwd,
      record.title,
      () => readConfiguration(this.#host, this.#configurationScopeCwd(record.cwd)),
      this.#host.proxyCredentials,
      this.#logger,
      {
        // A Fork still running in its own process is not a Session yet; nothing it reports reaches the collection.
        onChange: (runtime) => { if (!this.#processForks.has(runtime.id)) this.#handleRuntimeChange(runtime); },
        onAgentTurnCompleted: (runtime) => { if (!this.#processForks.has(runtime.id)) void this.#showSystemNotification(runtime, "completed"); },
        onExtensionCommandCompletionUnconfirmed: (runtime, message) => { if (!this.#processForks.has(runtime.id)) this.#toastEmitter.fire({ level: "warning", message }); },
        onEditorText: (runtime, text) => { if (!this.#processForks.has(runtime.id)) this.#setComposerTextEmitter.fire({ sessionId: runtime.id, text }); },
      },
      {
        clientVersion: this.#host.clientVersion(),
        readHostProxy: () => readHostProxy(this.#host, record.cwd),
      },
      this.#sessionTreeArtifactPath,
      this.#questionToolArtifactPath,
      record.ephemeral === true,
      customArguments,
    );
  }

  async #startRuntime(runtime: SessionRuntime, workingDirectoryValidated = false): Promise<void> {
    this.#assertOpen();
    const pending = this.#startJobs.get(runtime.id);
    if (pending) return pending;
    if (!workingDirectoryValidated && !await this.#validateRuntimeWorkingDirectory(runtime)) return;
    this.#assertOpen();

    const sessionFile = this.#records.get(runtime.id)?.sessionFile;
    runtime.markWaitingToStart();
    const job = this.#startQueue.catch(() => undefined).then(async () => {
      if (this.#disposed || this.#runtimes.get(runtime.id) !== runtime) return;
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
    this.#onSessionOpened?.(operation.forkId, operation.sourceId);
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

  #assertNoSessionCreation(): void {
    if (this.#sessionCreationInProgress > 0) throw new Error("Wait for the current session creation to finish.");
  }

  async #withSessionCreation<T>(operation: () => Promise<T>): Promise<T> {
    this.#assertOpen();
    this.#assertNoForkOperation();
    this.#assertNoSessionCreation();
    this.#sessionCreationInProgress += 1;
    try {
      return await operation();
    } finally {
      this.#sessionCreationInProgress -= 1;
    }
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
    if (status === "queued" || status === "stopped" || status === "failed") {
      await this.#startRuntime(runtime);
      // The prompt waits for the history the start reloads, as one typed after it would.
      await this.#historyJobs.get(runtime.id)?.catch(() => undefined);
    }
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
    if (this.#disposed) return;
    const view = runtime.view;
    const previous = this.#records.get(runtime.id);
    const previousStatus = this.#lastStatuses.get(runtime.id);
    this.#lastStatuses.set(runtime.id, view.status);
    const previousPendingUiCount = this.#lastPendingUiCounts.get(runtime.id) ?? 0;
    this.#lastPendingUiCounts.set(runtime.id, view.pendingExtensionUi.length);
    // Notify on entering input-required/failed state, not on every subsequent view update.
    const inputRequired = previousPendingUiCount === 0 && view.pendingExtensionUi.length > 0;
    if (runtime.id !== this.#activeSessionId && inputRequired) {
      this.#toastEmitter.fire({ level: "info", message: "A background FrostPi session is waiting for input." });
    }
    if (inputRequired) void this.#showSystemNotification(runtime, "inputRequired");
    if (previousStatus && previousStatus !== "failed" && view.status === "failed") {
      void this.#showSystemNotification(runtime, "failed");
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
      this.#host.workspace.setSessionRunningContext?.(view.isStreaming);
    }
    this.#scheduleChange();
  }

  async #showSystemNotification(runtime: SessionRuntime, event: SystemNotificationEvent): Promise<void> {
    if (this.#host.window.focused()) return;
    const scope = this.#configurationScopeCwd(runtime.view.cwd);
    if (!readConfiguration(this.#host, scope).experimentalNotificationsEnabled) return;
    const backgroundSession = runtime.id !== this.#activeSessionId;
    const message = event === "inputRequired"
      ? backgroundSession ? "A background FrostPi session is waiting for input." : "FrostPi is waiting for your input."
      : event === "completed"
        ? backgroundSession ? "A background FrostPi session completed an agent turn." : "FrostPi completed an agent turn."
        : "A FrostPi session failed. Open the session for details.";
    const title = event === "completed" ? "FrostPi turn completed" : "FrostPi needs your attention";
    const shown = this.#host.systemToast ? await this.#host.systemToast(title, message) : false;
    if (!shown && !this.#host.window.focused()) {
      if (event === "failed") this.#host.window.showError(message);
      else this.#host.window.showInformation(message);
    }
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

  #persist(): PromiseLike<void> {
    this.#assertOpen();
    const sessions = [...this.#records.values()].filter((record) => !record.ephemeral && !this.#temporarySessionIds.has(record.id));
    const activeRecord = this.#activeSessionId ? this.#records.get(this.#activeSessionId) : undefined;
    const activeSessionId = this.#activeSessionId && !activeRecord?.ephemeral && !this.#temporarySessionIds.has(this.#activeSessionId)
      ? this.#activeSessionId
      : null;
    const job = this.#persistenceQueue.catch(() => undefined).then(() => this.#persistence.save(activeSessionId, sessions));
    this.#persistenceQueue = job;
    // Runtime-change saves can be fire-and-forget; retain rejection for callers without an unhandled promise.
    void job.catch((error: unknown) => this.#logger.error("Failed to persist session metadata", error));
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

  #rememberWorkingDirectory(directory: SessionWorkingDirectory, sessionCwd = directory.cwd): void {
    this.#workingDirectoriesByCwd.set(normalizedPath(directory.cwd), directory);
    this.#workingDirectoriesByCwd.set(normalizedPath(sessionCwd), directory);
  }

  #configurationScopeCwd(cwd: string): string {
    return this.#workingDirectoriesByCwd.get(normalizedPath(cwd))?.workspaceFolderCwd ?? cwd;
  }

  #withWorkingDirectoryLabel(view: SessionRuntime["view"]): SessionRuntime["view"] {
    const label = this.#workingDirectoryLabel(view.cwd);
    return label.workingDirectoryLabel ? { ...view, ...label } : view;
  }

  #workingDirectoryLabel(cwd: string): { workingDirectoryLabel?: string } {
    if (this.#isOpenWorkspaceFolder(cwd)) return {};
    return { workingDirectoryLabel: this.#workingDirectoriesByCwd.get(normalizedPath(cwd))?.directoryName ?? basename(cwd) };
  }

  #ensureValidActiveSelection(): void {
    if (this.#activeSessionId && this.#runtimes.has(this.#activeSessionId)) return;
    this.#activeSessionId = [...this.#runtimes.keys()].at(-1) ?? null;
  }

  #assertOpen(): void {
    if (this.#disposed) throw new Error("The FrostPi client has closed.");
  }

  #requireRuntime(sessionId: string): SessionRuntime {
    this.#assertOpen();
    const runtime = this.#runtimes.get(sessionId);
    if (!runtime) throw new Error(`Unknown FrostPi session: ${sessionId}`);
    return runtime;
  }

  #requireActiveId(): string {
    if (!this.#activeSessionId) throw new Error("No active FrostPi session");
    return this.#activeSessionId;
  }

  async #pickSessionWorkingDirectory(
    directories: readonly SessionWorkingDirectory[],
  ): Promise<SessionWorkingDirectory | undefined> {
    if (directories.length <= 1) return directories[0];
    const items: Array<HostQuickPickItem & { directory: SessionWorkingDirectory }> = directories.map((directory) => ({
      label: directory.isCurrent
        ? "$(folder-active) Current workspace"
        : `$(git-branch) ${directory.branch ?? (directory.detached ? "Detached HEAD" : directory.directoryName)}`,
      description: directory.branch && directory.isCurrent
        ? `${directory.branch} · ${directory.directoryName}`
        : directory.directoryName,
      detail: directory.cwd,
      directory,
    }));
    const selected = await this.#host.window.showQuickPick(items, {
      title: `New Pi session · ${directories[0]?.directoryName ?? "workspace"}`,
      placeHolder: "Choose where Pi should run",
      matchOnDescription: true,
      matchOnDetail: true,
      ignoreFocusOut: true,
    });
    return selected?.directory;
  }

  #isOpenWorkspaceFolder(cwd: string): boolean {
    return this.#host.workspace.getWorkspaceFolders().some((folder) => sameCanonicalPath(folder.uri.fsPath, cwd));
  }
}

/** The bridge's bound on a session name; Pi itself accepts longer ones. */
const MAX_SESSION_NAME_LENGTH = 160;

/** The source cannot hand its own process to the Fork while it is busy. */
function forkNeedsOwnProcess(runtime: SessionRuntime): boolean {
  const view = runtime.view;
  return view.isStreaming || view.status === "running" || view.pendingExtensionUi.length > 0
    || view.queuedSteers.length > 0 || view.queuedFollowUps.length > 0;
}

function forkSessionName(title: string): string {
  const source = title.trim();
  return (source ? `Fork: ${source}` : "Fork session").slice(0, 160);
}

async function confirmNewConversation(host: ClientHost, runtime: SessionRuntime): Promise<boolean> {
  const view = runtime.view;
  const losesConversation = view.isEphemeral
    && view.conversationItems.some((item) => item.type === "turn" && item.userMessage?.role === "user");
  if (!losesConversation) return true;
  const choice = await host.window.showWarningDialog(
    "Starting a new conversation in this temporary session will permanently discard the current one. This cannot be undone.",
    ["Start new conversation"],
  );
  return choice === "Start new conversation";
}

async function confirmClose(host: ClientHost, runtime: SessionRuntime): Promise<boolean> {
  const view = runtime.view;
  const ephemeralWithPrompt = view.isEphemeral
    && view.conversationItems.some((item) => item.type === "turn" && item.userMessage?.role === "user");
  if (!ephemeralWithPrompt && !view.isStreaming && view.pendingExtensionUi.length === 0) return true;
  const choice = await host.window.showWarningDialog(
    ephemeralWithPrompt
      ? "Closing this temporary session will permanently discard its conversation. This cannot be undone."
      : view.pendingExtensionUi.length > 0
        ? "Closing this FrostPi session will cancel its pending user interaction and stop its Pi process. Persisted Pi history is retained."
        : "Closing this FrostPi session will stop its active response and tools. Persisted Pi history is retained.",
    ["Close session"],
  );
  return choice === "Close session";
}

async function confirmStop(host: ClientHost, runtime: SessionRuntime): Promise<boolean> {
  const view = runtime.view;
  if (!view.isStreaming && view.pendingExtensionUi.length === 0) return true;
  const choice = await host.window.showWarningDialog(
    "Stopping this session's Pi process will stop its active response, tools, and pending extension UI requests. Any queued messages will be discarded. The session and its saved Pi history are kept.",
    ["Stop Pi process"],
  );
  return choice === "Stop Pi process";
}

async function confirmRestart(host: ClientHost, runtimes: readonly SessionRuntime[]): Promise<boolean> {
  const disruptive = runtimes.some((runtime) => runtime.view.isStreaming || runtime.view.pendingExtensionUi.length > 0);
  if (!disruptive) return true;
  const choice = await host.window.showWarningDialog(
    runtimes.length > 1
      ? "Restarting all FrostPi sessions will stop active responses, tools, and pending extension UI requests. Persisted Pi history is retained."
      : "Restarting this FrostPi session will stop its active response, tools, and pending extension UI requests. Persisted Pi history is retained.",
    runtimes.length > 1 ? ["Restart all sessions"] : ["Restart session"],
  );
  return Boolean(choice);
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

/** A record title that only marks an unnamed session: FrostPi's own placeholder or a catalog file-name fallback. */
function isPlaceholderSessionTitle(value: string): boolean {
  return value === NEW_SESSION_TITLE || looksLikeGeneratedSessionName(value);
}
