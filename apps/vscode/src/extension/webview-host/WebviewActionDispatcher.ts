import * as vscode from "vscode";

import type { HostToWebviewPayload } from "../../shared/bridge/hostToWebview.js";
import type { WebviewToHostMessage } from "../../shared/bridge/webviewToHost.js";
import { captureActiveFileReference } from "../composer/mentions/captureActiveFile.js";
import { captureActiveSelection } from "../composer/mentions/captureSelection.js";
import { listEditorMentionSpecials } from "../composer/mentions/editorMentionSpecials.js";
import type { WorkspaceFileSearch } from "../composer/mentions/WorkspaceFileSearch.js";
import { workspaceFileBoosts, workspaceFileExcludeRules } from "../composer/mentions/workspaceFileSearchContext.js";
import { configurePiExecutable } from "../configuration/configurePiExecutable.js";
import { readConfiguration } from "../configuration/readConfiguration.js";
import { workspaceUriForPath } from "../configuration/workspaceScope.js";
import { openReferencedLocation } from "../conversation/openReferencedLocation.js";
import { exportDiagnostics } from "../diagnostics/exportDiagnostics.js";
import type { DiagnosticLogger } from "../diagnostics/DiagnosticLogger.js";
import { openFileDiff } from "../file-changes/GitBaseContentProvider.js";
import type { SessionRegistry } from "../sessions/SessionRegistry.js";
import type { ComposerDraftCache } from "./ComposerDraftCache.js";
import type { ConnectionContext } from "./webviewTypes.js";

export interface DispatchConnection extends ConnectionContext {
  readonly fileSearch: WorkspaceFileSearch;
  post(message: HostToWebviewPayload): void;
  insertPromptText(text: string): void;
}

export interface WebviewActionDispatcherDependencies {
  registry: SessionRegistry;
  logger: DiagnosticLogger;
  drafts: ComposerDraftCache;
  openPanel(sessionId: string): void | Promise<void>;
  revealPanel(sessionId: string): void | Promise<void>;
  openComposerEditor(sessionId: string, text: string): Promise<void>;
}

const SIDEBAR_ONLY_ACTIONS = new Set<WebviewToHostMessage["type"]>([
  "openFolder",
  "createSession",
  "resumeSession",
  "activateSession",
  "closeSession",
  "renameSession",
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

export class WebviewActionDispatcher {
  readonly #registry: SessionRegistry;
  readonly #logger: DiagnosticLogger;
  readonly #drafts: ComposerDraftCache;
  readonly #openPanel: (sessionId: string) => void | Promise<void>;
  readonly #revealPanel: (sessionId: string) => void | Promise<void>;
  readonly #openComposerEditor: (sessionId: string, text: string) => Promise<void>;

  constructor(dependencies: WebviewActionDispatcherDependencies) {
    this.#registry = dependencies.registry;
    this.#logger = dependencies.logger;
    this.#drafts = dependencies.drafts;
    this.#openPanel = (sessionId) => dependencies.openPanel(sessionId);
    this.#revealPanel = (sessionId) => dependencies.revealPanel(sessionId);
    this.#openComposerEditor = (sessionId, text) => dependencies.openComposerEditor(sessionId, text);
  }

  async dispatch(message: WebviewToHostMessage, connection: DispatchConnection): Promise<void> {
    if (connection.surface.kind === "panel" && SIDEBAR_ONLY_ACTIONS.has(message.type)) {
      throw new Error(message.type === "resumeSession"
        ? "Open the FrostPi sidebar to resume a session."
        : "This action is available only from the FrostPi sidebar.");
    }
    this.#authorizeSessionTarget(message, connection);

    switch (message.type) {
      case "ready":
        return;
      case "openFolder":
        await vscode.commands.executeCommand("vscode.openFolder");
        return;
      case "createSession":
        await this.#registry.createSession(message.ephemeral ?? false);
        return;
      case "resumeSession":
        await this.#registry.resumeSession();
        return;
      case "openSessionPanel":
        await this.#openPanel(message.sessionId);
        return;
      case "revealSessionPanel":
        await this.#revealPanel(message.sessionId);
        return;
      case "updateComposerDraft":
        this.#drafts.applyMutation(message.sessionId, message.draft);
        return;
      case "openComposerEditor":
        await this.#openComposerEditor(message.sessionId, message.text);
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
      case "copyText":
        await vscode.env.clipboard.writeText(message.text);
        connection.post({ type: "toast", level: "info", message: "Copied to clipboard." });
        return;
      case "sendPrompt": {
        try {
          const submitted = this.#drafts.beginSubmission(message.sessionId, message.requestId, {
            revision: message.draftRevision,
            text: message.text,
            images: message.images,
          });
          await this.#registry.sendPrompt(message.sessionId, submitted.text, submitted.images, message.streamingBehavior);
          this.#drafts.resolveSubmission(message.sessionId, message.requestId, true);
          connection.post({ type: "promptResult", requestId: message.requestId, ok: true });
        } catch (error) {
          const errorText = error instanceof Error ? error.message : String(error);
          this.#drafts.resolveSubmission(message.sessionId, message.requestId, false);
          connection.post({ type: "promptResult", requestId: message.requestId, ok: false, error: errorText });
        }
        return;
      }
      case "abort":
        await this.#registry.abort(message.sessionId);
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
        try {
          const selection = connection.surface.kind === "sidebar" ? "select-result" : "preserve-sidebar-selection";
          const result = await this.#registry.forkMessage(message.sessionId, message.entryId, selection);
          if (!result.cancelled && result.forkSessionId && connection.surface.kind === "panel") {
            await this.#openPanel(result.forkSessionId);
          }
          connection.post({ type: "forkResult", requestId: message.requestId, ok: true, ...result });
        } catch (error) {
          connection.post({
            type: "forkResult",
            requestId: message.requestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
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
        const text = captureActiveSelection();
        if (!text) throw new Error("Open a workspace file first.");
        connection.insertPromptText(`${text} `);
        return;
      }
      case "addCurrentFile": {
        const text = captureActiveFileReference();
        if (!text) throw new Error("Open a workspace file first.");
        connection.insertPromptText(`${text} `);
        return;
      }
      case "openFile":
        await openReferencedLocation(message, this.#displayedSession(connection)?.cwd);
        return;
      case "openDiff":
        await openFileDiff(message.path);
        return;
      case "openExternal": {
        const uri = vscode.Uri.parse(message.url, true);
        if (uri.scheme !== "https" && uri.scheme !== "http") throw new Error("Only HTTP(S) links can be opened.");
        await vscode.env.openExternal(uri);
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
        await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:frostime.frostpi");
        return;
      case "openProxySettings":
        await vscode.commands.executeCommand("frostpi.configureProxy");
        return;
      case "restartSession":
        await this.#registry.retrySession(message.sessionId);
        return;
      case "configureExecutable":
        await configurePiExecutable();
        return;
      case "exportDiagnostics":
        await exportDiagnostics(this.#logger, this.#registry.diagnosticsSummary());
        return;
      case "retryStart":
        await this.#registry.retrySession(message.sessionId);
        return;
    }
  }

  #authorizeSessionTarget(message: WebviewToHostMessage, connection: ConnectionContext): void {
    if (!("sessionId" in message)) return;
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
      const scope = workspaceUriForPath(session.cwd);
      const configuration = readConfiguration(scope);
      const items = await connection.fileSearch.search(
        session.cwd,
        message.query,
        message.limit,
        workspaceFileBoosts(session),
        {
          excludeRules: workspaceFileExcludeRules(scope, configuration.fileMentionRespectSearchExclude),
          respectIgnoreFiles: configuration.fileMentionRespectIgnoreFiles,
          followSymlinks: configuration.fileMentionFollowSymlinks,
        },
      );
      const specials = listEditorMentionSpecials(message.query);
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
