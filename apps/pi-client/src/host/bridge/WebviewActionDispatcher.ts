import { homedir } from "node:os";
import { listProviders, queryUsage } from "@frostime/provider-usage";
import { resolvePiAgentDirectory } from "../../core/_shared/pi-settings/loadPiSettings.js";

import type { HostToWebviewPayload } from "../../shared/bridge/hostToWebview.js";
import type { WebviewToHostMessage } from "../../shared/bridge/webviewToHost.js";
import type { ComposerDraftView } from "../../shared/model/composerDraftModel.js";
import type { QueuedPromptRecoveryOutcome } from "../../shared/model/queuedPromptRecoveryModel.js";
import { buildProviderUsageEnvironment } from "../../core/network/buildPiProcessEnvironment.js";
import type { ProxyCredentials } from "../../core/network/proxyCredentials.js";
import type { RuntimeLogger } from "../../core/diagnostics/RuntimeLogger.js";
import type { WorkspaceFileSearch } from "../file-search/WorkspaceFileSearch.js";
import { workspaceFileBoosts, workspaceFileExcludeRules } from "../file-search/mentionSearchContext.js";
import { readConfiguration, readHostProxy } from "../readConfiguration.js";
import type { ClientHost } from "../clientHost.js";
import type { SessionRegistry } from "../SessionRegistry.js";
import type { ComposerDraftCache } from "./ComposerDraftCache.js";
import { resolveLocalMarkdownImage } from "./markdown-images/MarkdownImageResolver.js";
import type { ConnectionContext } from "./webviewTypes.js";

export interface DispatchConnection extends ConnectionContext {
  readonly fileSearch: WorkspaceFileSearch;
  beginProviderUsageRequest(id: string): AbortSignal;
  cancelProviderUsageRequest(id: string): void;
  finishProviderUsageRequest(id: string, signal: AbortSignal): boolean;
  post(message: HostToWebviewPayload): void;
  insertPromptText(text: string): void;
  deliverQueuedPromptRecovery(requestId: string, sessionId: string, outcome: QueuedPromptRecoveryOutcome): void;
}

export interface WebviewActionDispatcherDependencies {
  host: ClientHost;
  registry: SessionRegistry;
  getProxyCredentials: () => Promise<ProxyCredentials | undefined>;
  logger: RuntimeLogger;
  drafts: ComposerDraftCache;
  openPanel(sessionId: string, draft?: ComposerDraftView): void | Promise<void>;
  revealPanel(sessionId: string): void | Promise<void>;
  openComposerEditor(sessionId: string, text: string): Promise<"opened" | "already-open">;
  /**
   * Creates a Session directly in an editor tab. `sourceSessionId` is the Session Tab
   * that asked, whose tab group and working directory the new one shares. Hosts without
   * editor tabs leave it out.
   */
  createSessionPanel?(sourceSessionId: string | null): Promise<unknown>;
}

const SIDEBAR_ONLY_ACTIONS = new Set<WebviewToHostMessage["type"]>([
  "openFolder",
  "createSession",
  "createSessionWithArguments",
  "resumeSession",
  "activateSession",
  "closeSession",
  "openSessionPanel",
  "revealSessionPanel",
  "openSettings",
  "openProxySettings",
  "restartSession",
  "configureExecutable",
  "exportDiagnostics",
  "retryStart",
  "checkPiIntegration",
  "refreshCommands",
]);

const SIDEBAR_COLLECTION_TARGET_ACTIONS = new Set<WebviewToHostMessage["type"]>([
  "activateSession",
  "closeSession",
  "renameSession",
  "revealSessionPanel",
  "restartSession",
  "retryStart",
  "checkPiIntegration",
  "refreshCommands",
]);

/** Absent host capabilities are errors, never silent no-ops ("fake success"). */
function unsupportedHostAction(action: string): Error {
  return new Error(`"${action}" is not supported in this host.`);
}

export class WebviewActionDispatcher {
  readonly #host: ClientHost;
  readonly #registry: SessionRegistry;
  readonly #getProxyCredentials: () => Promise<ProxyCredentials | undefined>;
  readonly #logger: RuntimeLogger;
  readonly #drafts: ComposerDraftCache;
  readonly #openPanel: (sessionId: string, draft?: ComposerDraftView) => void | Promise<void>;
  readonly #revealPanel: (sessionId: string) => void | Promise<void>;
  readonly #openComposerEditor: (sessionId: string, text: string) => Promise<"opened" | "already-open">;
  readonly #createSessionPanel: ((sourceSessionId: string | null) => Promise<unknown>) | undefined;

  constructor(dependencies: WebviewActionDispatcherDependencies) {
    this.#host = dependencies.host;
    this.#registry = dependencies.registry;
    this.#getProxyCredentials = dependencies.getProxyCredentials;
    this.#logger = dependencies.logger;
    this.#drafts = dependencies.drafts;
    this.#openPanel = (sessionId, draft) => draft
      ? dependencies.openPanel(sessionId, draft)
      : dependencies.openPanel(sessionId);
    this.#revealPanel = (sessionId) => dependencies.revealPanel(sessionId);
    this.#openComposerEditor = (sessionId, text) => dependencies.openComposerEditor(sessionId, text);
    this.#createSessionPanel = dependencies.createSessionPanel
      ? (sourceSessionId) => dependencies.createSessionPanel!(sourceSessionId)
      : undefined;
  }

  async dispatch(message: WebviewToHostMessage, connection: DispatchConnection): Promise<void> {
    if (connection.surface.kind === "panel" && SIDEBAR_ONLY_ACTIONS.has(message.type)) {
      throw new Error(message.type === "resumeSession"
        ? "Open the FrostPi sidebar to resume a session."
        : "This action is available only from the FrostPi sidebar.");
    }
    if (message.type === "restoreQueuedPrompts") {
      await this.#restoreQueuedPrompts(message, connection);
      return;
    }
    if (message.type === "loadMarkdownImage") {
      await this.#loadMarkdownImage(message, connection);
      return;
    }
    this.#authorizeSessionTarget(message, connection);

    switch (message.type) {
      case "ready":
        return;
      case "cancelProviderUsage":
        connection.cancelProviderUsageRequest(message.requestId);
        return;
      case "listUsageProviders":
      case "queryProviderUsage": {
        const signal = connection.beginProviderUsageRequest(message.requestId);
        try {
          const environment = { ...process.env };
          const cwd = this.#registry.snapshot().workspacePath || homedir();
          const input = { agentDirectory: resolvePiAgentDirectory(cwd, environment), environment };
          const providers = await listProviders(input, { includeUnconfigured: message.type === "listUsageProviders" });
          signal.throwIfAborted();
          if (message.type === "listUsageProviders") {
            if (connection.finishProviderUsageRequest(message.requestId, signal)) {
              connection.post({ type: "usageProvidersResult", requestId: message.requestId, providers });
            }
          } else {
            if (message.scope !== "all" && !providers.some((provider) => provider.providerId === message.scope)) {
              throw new Error("Unknown usage provider.");
            }
            // Use the current proxy setting
            const proxy = readConfiguration(this.#host, cwd).proxy;
            const vscodeProxy = proxy.mode === "vscode" ? readHostProxy(this.#host, cwd) : undefined;
            const credentials = proxy.mode === "custom" || proxy.mode === "vscode"
              ? await this.#getProxyCredentials()
              : undefined;
            signal.throwIfAborted();
            const queryEnvironment = buildProviderUsageEnvironment(environment, proxy, credentials, vscodeProxy);
            // query the provider's usage, with proxy setting
            const results = await queryUsage(message.scope, { ...input, environment: queryEnvironment }, signal);
            if (connection.finishProviderUsageRequest(message.requestId, signal)) {
              connection.post({ type: "providerUsageResult", requestId: message.requestId, results });
            }
          }
        } catch {
          if (connection.finishProviderUsageRequest(message.requestId, signal)) {
            connection.post({ type: "providerUsageError", requestId: message.requestId, message: "Could not retrieve provider usage. Try again." });
          }
        }
        return;
      }
      case "openFolder":
        if (!this.#host.editor.openFolder) throw unsupportedHostAction("openFolder");
        await this.#host.editor.openFolder();
        return;
      case "createSession":
        await this.#registry.createSession(message.ephemeral ?? false);
        return;
      case "createSessionWithArguments":
        await this.#registry.createSessionWithCustomArguments();
        return;
      case "resumeSession":
        await this.#registry.resumeSession();
        return;
      case "createSessionPanel":
        if (!this.#createSessionPanel) throw unsupportedHostAction("createSessionPanel");
        await this.#createSessionPanel(connection.surface.kind === "panel" ? connection.sessionId : null);
        return;
      case "openSessionPanel":
        await this.#openPanel(message.sessionId, message.draft);
        return;
      case "revealSessionPanel":
        await this.#revealPanel(message.sessionId);
        return;
      case "updateComposerDraft":
        if (connection.surface.kind !== "panel" && !this.#drafts.hasPendingSubmission(message.sessionId)
          && !this.#drafts.hasPendingRecovery(message.sessionId)) {
          throw new Error("Only an externalized Composer synchronizes drafts to the Host.");
        }
        this.#drafts.applyMutation(message.sessionId, message.draft);
        return;
      case "openComposerEditor":
        if (await this.#openComposerEditor(message.sessionId, message.text) === "already-open") {
          connection.post({ type: "toast", level: "info", message: "Finish the open composer editor tab first." });
        }
        return;
      case "activateSession":
        await this.#registry.activateSession(message.sessionId);
        return;
      case "closeSession":
        await this.#registry.closeSession(message.sessionId);
        return;
      case "renameSession":
        await this.#registry.rename(message.sessionId, message.name);
        return;
      case "copyText": {
        if (!this.#host.editor.writeClipboard) throw unsupportedHostAction("copyText");
        await this.#host.editor.writeClipboard(message.text);
        connection.post({ type: "toast", level: "info", message: "Copied to clipboard." });
        return;
      }
      case "sendPrompt": {
        const hostOwnsDraft = connection.surface.kind === "panel"
          || this.#drafts.hasPendingSubmission(message.sessionId) || this.#drafts.hasPendingRecovery(message.sessionId);
        try {
          const submitted = hostOwnsDraft
            ? this.#drafts.beginSubmission(message.sessionId, message.requestId, {
                revision: message.draftRevision,
                text: message.text,
                images: message.images,
              })
            : { text: message.text, images: message.images };
          // Reject synchronously so the existing submission rollback preserves the draft.
          if (this.#drafts.hasPendingRecovery(message.sessionId)) {
            throw new Error("Wait for pending-message recovery before sending another message.");
          }
          await this.#registry.sendPrompt(message.sessionId, submitted.text, submitted.images, message.streamingBehavior);
          if (hostOwnsDraft) this.#drafts.resolveSubmission(message.sessionId, message.requestId, true);
          connection.post({ type: "promptResult", requestId: message.requestId, ok: true });
        } catch (error) {
          const errorText = error instanceof Error ? error.message : String(error);
          if (hostOwnsDraft) {
            this.#drafts.resolveSubmission(message.sessionId, message.requestId, false);
            if (this.#drafts.hasPendingRecovery(message.sessionId)) {
              connection.post({ type: "draftReplacement", sessionId: message.sessionId, draft: this.#drafts.get(message.sessionId) });
            }
          }
          connection.post({ type: "promptResult", requestId: message.requestId, ok: false, error: errorText });
        }
        return;
      }
      case "abort":
        await this.#registry.abort(message.sessionId);
        return;
      case "dismissSideQuestion":
        this.#registry.dismissSideQuestion(message.sessionId, message.questionId);
        return;
      case "cancelFork":
        await this.#registry.cancelFork(message.sessionId);
        return;
      case "branchHere":
        await this.#registry.branchHere(message.sessionId, message.entryId, message.hasDraft);
        return;
      case "switchBranch":
        await this.#registry.switchBranch(message.sessionId, message.branchPointId, message.hasDraft);
        return;
      case "forkMessage": {
        let result: Awaited<ReturnType<SessionRegistry["forkMessage"]>>;
        try {
          const selection = connection.surface.kind === "sidebar" ? "select-result" : "preserve-sidebar-selection";
          result = await this.#registry.forkMessage(message.sessionId, message.entryId, selection);
        } catch (error) {
          connection.post({
            type: "forkResult",
            requestId: message.requestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
          return;
        }

        connection.post({ type: "forkResult", requestId: message.requestId, ok: true, ...result });
        if (!result.cancelled && result.forkSessionId && connection.surface.kind === "panel") {
          try {
            await this.#openPanel(result.forkSessionId);
          } catch (error) {
            this.#logger.error(`Fork result Session Tab failed to open for ${result.forkSessionId}`, error);
            connection.post({
              type: "toast",
              level: "error",
              message: "Fork succeeded, but its Session Tab could not be opened. Select the Fork result in the sidebar.",
            });
          }
        }
        return;
      }
      case "setModel":
        await this.#registry.setModel(message.sessionId, message.provider, message.modelId);
        return;
      case "setThinkingLevel":
        await this.#registry.setThinkingLevel(message.sessionId, message.level);
        return;
      case "respondExtensionUi":
        await this.#registry.respondExtensionUi(message.sessionId, message.requestId, message.response);
        return;
      case "respondQuestion":
        await this.#registry.respondQuestion(message.sessionId, message.requestId, message.response);
        return;
      case "addSelection": {
        const text = this.#host.editor.captureActiveSelection?.();
        if (!text) throw new Error("Open a workspace file first.");
        connection.insertPromptText(`${text} `);
        return;
      }
      case "addCurrentFile": {
        const text = this.#host.editor.captureActiveFileReference?.();
        if (!text) throw new Error("Open a workspace file first.");
        connection.insertPromptText(`${text} `);
        return;
      }
      case "openFile":
        if (!this.#host.editor.openReferencedLocation) throw unsupportedHostAction("openFile");
        await this.#host.editor.openReferencedLocation(message, this.#displayedSession(connection)?.cwd);
        return;
      case "openDiff":
        if (!this.#host.editor.openFileDiff) throw unsupportedHostAction("openDiff");
        await this.#host.editor.openFileDiff(message.path);
        return;
      case "openExternal": {
        let url: URL;
        try {
          url = new URL(message.url);
        } catch {
          throw new Error("Only HTTP(S) links can be opened.");
        }
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only HTTP(S) links can be opened.");
        if (!this.#host.editor.openExternalUrl) throw unsupportedHostAction("openExternal");
        await this.#host.editor.openExternalUrl(message.url);
        return;
      }
      case "refreshCommands":
        await this.#registry.refreshCommands(message.sessionId);
        return;
      case "checkPiIntegration":
        await this.#registry.checkPiIntegration(message.sessionId);
        return;
      case "refreshModels":
        await this.#registry.refreshModels(message.sessionId);
        return;
      case "loadHistory":
        await this.#registry.loadHistory(message.sessionId);
        return;
      case "searchWorkspaceFiles":
        await this.#searchWorkspaceFiles(message, connection);
        return;
      case "openSettings":
        if (!this.#host.editor.openSettings) throw unsupportedHostAction("openSettings");
        await this.#host.editor.openSettings("@ext:frostime.frostpi");
        return;
      case "openProxySettings":
        if (!this.#host.editor.openProxySettings) throw unsupportedHostAction("openProxySettings");
        await this.#host.editor.openProxySettings();
        return;
      case "restartSession":
        await this.#registry.retrySession(message.sessionId);
        return;
      case "configureExecutable":
        if (!this.#host.editor.configurePiExecutable) throw unsupportedHostAction("configureExecutable");
        await this.#host.editor.configurePiExecutable();
        return;
      case "exportDiagnostics":
        if (!this.#host.exportDiagnostics) throw unsupportedHostAction("exportDiagnostics");
        await this.#host.exportDiagnostics(this.#registry.diagnosticsSummary());
        return;
      case "retryStart":
        await this.#registry.retrySession(message.sessionId);
        return;
    }
  }

  async #restoreQueuedPrompts(
    message: Extract<WebviewToHostMessage, { type: "restoreQueuedPrompts" }>,
    connection: DispatchConnection,
  ): Promise<void> {
    let release: (() => void) | undefined;
    try {
      this.#authorizeSessionTarget(message, connection);
      if (this.#drafts.hasPendingSubmission(message.sessionId)) {
        throw new Error("Wait for the current prompt submission before recovering pending messages.");
      }
      const session = this.#registry.sessionView(message.sessionId);
      if (!session) throw new Error("This FrostPi Session no longer exists.");
      const hostOwnsDraft = connection.surface.kind === "panel" || this.#drafts.hasPendingRecovery(message.sessionId);
      const draftImages = hostOwnsDraft ? this.#drafts.get(message.sessionId).images.length : message.draftImageCount;
      const pendingImages = [...session.queuedSteers, ...session.queuedFollowUps].reduce((count, prompt) => count + prompt.images.length, 0);
      if (draftImages + pendingImages > session.attachmentLimits.maxImages) {
        throw new Error("Pending images and the current draft exceed the Composer image limit. Pending messages were not changed.");
      }
      if (hostOwnsDraft) release = this.#drafts.beginRecovery(message.sessionId);
      const outcome = await this.#registry.restoreQueuedPrompts(message.sessionId);
      if (!this.#registry.hasSession(message.sessionId)) throw new Error("This FrostPi Session no longer exists.");
      connection.deliverQueuedPromptRecovery(message.requestId, message.sessionId, outcome);
    } catch (error) {
      connection.post({
        type: "restoreQueuedPromptsResult", sessionId: message.sessionId, requestId: message.requestId,
        ok: false, error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      release?.();
    }
  }

  async #loadMarkdownImage(
    message: Extract<WebviewToHostMessage, { type: "loadMarkdownImage" }>,
    connection: DispatchConnection,
  ): Promise<void> {
    try {
      this.#authorizeSessionTarget(message, connection);
    } catch {
      connection.post({
        type: "markdownImageResult",
        requestId: message.requestId,
        sessionId: message.sessionId,
        result: { ok: false, reason: "invalidSource" },
      });
      return;
    }

    const session = this.#displayedSession(connection);
    const result = session
      ? await resolveLocalMarkdownImage(message.source, session.cwd, session.attachmentLimits.maxImageBytes)
      : { ok: false as const, reason: "invalidSource" as const };
    connection.post({
      type: "markdownImageResult",
      requestId: message.requestId,
      sessionId: message.sessionId,
      result,
    });
  }

  #authorizeSessionTarget(message: WebviewToHostMessage, connection: ConnectionContext): void {
    if (!("sessionId" in message) || !message.sessionId) return;
    if (connection.surface.kind === "sidebar" && SIDEBAR_COLLECTION_TARGET_ACTIONS.has(message.type)) {
      if (!this.#registry.hasSession(message.sessionId)) throw new Error("This FrostPi Session no longer exists.");
      return;
    }
    if (!connection.sessionId || message.sessionId !== connection.sessionId) {
      throw new Error("The Webview action does not target the Session displayed by this surface.");
    }
    if (!this.#registry.hasSession(message.sessionId)) throw new Error("This FrostPi Session no longer exists.");
  }

  #displayedSession(connection: ConnectionContext) {
    return connection.sessionId ? this.#registry.sessionView(connection.sessionId) : null;
  }

  async #searchWorkspaceFiles(
    message: Extract<WebviewToHostMessage, { type: "searchWorkspaceFiles" }>,
    connection: DispatchConnection,
  ): Promise<void> {
    try {
      const session = this.#displayedSession(connection);
      if (!session) throw new Error("The displayed Session changed before file search completed.");
      const configuration = readConfiguration(this.#host, session.cwd);
      const items = await connection.fileSearch.search(
        session.cwd,
        message.query,
        message.limit,
        workspaceFileBoosts(this.#host, session),
        {
          excludeRules: workspaceFileExcludeRules(this.#host, session.cwd, configuration.fileMentionRespectSearchExclude),
          respectIgnoreFiles: configuration.fileMentionRespectIgnoreFiles,
          followSymlinks: configuration.fileMentionFollowSymlinks,
        },
      );
      const specials = [...(this.#host.editor.listEditorMentionSpecials?.(message.query) ?? [])];
      connection.post({
        type: "workspaceFileSuggestions",
        requestId: message.requestId,
        items,
        ...(specials.length ? { specials } : {}),
      });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      this.#logger.error("Workspace file completion failed", error);
      connection.post({ type: "workspaceFileSuggestions", requestId: message.requestId, items: [], error: errorText });
    }
  }
}
