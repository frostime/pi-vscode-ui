import * as vscode from "vscode";

import type { HostToWebviewPayload } from "../../shared/bridge/hostToWebview.js";
import { ComposerExternalEditor } from "../composer/ComposerExternalEditor.js";
import { readChatTypography } from "../configuration/readChatTypography.js";
import type { DiagnosticLogger } from "../diagnostics/DiagnosticLogger.js";
import type { SessionRegistry } from "../sessions/SessionRegistry.js";
import { ComposerDraftCache } from "./ComposerDraftCache.js";
import { SessionPanelManager } from "./SessionPanelManager.js";
import { WebviewActionDispatcher } from "./WebviewActionDispatcher.js";
import { WebviewConnection } from "./WebviewConnection.js";
import type { WebviewEndpoint } from "./webviewTypes.js";

export class SessionWebviewCoordinator implements vscode.Disposable {
  readonly #registry: SessionRegistry;
  readonly #logger: DiagnosticLogger;
  readonly #drafts = new ComposerDraftCache();
  readonly #externalEditor: ComposerExternalEditor;
  readonly #dispatcher: WebviewActionDispatcher;
  readonly #panels: SessionPanelManager;
  readonly #disposables: vscode.Disposable[] = [];
  #sidebar: WebviewConnection | null = null;
  #knownSessionIds: Set<string>;

  constructor(registry: SessionRegistry, logger: DiagnosticLogger, extensionUri: vscode.Uri) {
    this.#registry = registry;
    this.#logger = logger;
    this.#knownSessionIds = new Set(registry.snapshot().sessions.map((session) => session.id));
    this.#externalEditor = new ComposerExternalEditor(
      ({ sessionId, text }) => this.#applyExternalEditorText(sessionId, text),
      () => this.broadcast({ type: "toast", level: "info", message: "Finish the open composer editor tab first." }),
    );
    this.#dispatcher = new WebviewActionDispatcher({
      registry,
      logger,
      drafts: this.#drafts,
      openPanel: (sessionId) => this.openPanel(sessionId),
      revealPanel: (sessionId) => this.revealPanel(sessionId),
      openComposerEditor: (sessionId, text) => this.#externalEditor.open(sessionId, text),
    });
    this.#panels = new SessionPanelManager(
      registry,
      extensionUri,
      (endpoint) => this.#createConnection(endpoint),
    );
    this.#disposables.push(
      registry.onDidChange(() => this.#registryChanged()),
      registry.onDidToast((toast) => this.broadcast({ type: "toast", ...toast })),
      registry.onDidSetComposerText(({ sessionId, text }) => this.#drafts.replaceText(sessionId, text)),
      this.#drafts.onDidChange(({ sessionId }) => this.#forEachConnection((connection) => connection.draftChanged(sessionId))),
      this.#panels.onDidChange(() => this.#refreshConnections()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!chatTypographyChanged(event)) return;
        // A full refresh is unnecessary; each ready Webview can accept typography independently.
        this.#forEachConnection((connection) => connection.post({
          type: "setChatTypography",
          typography: readChatTypography(vscode.workspace.getConfiguration("chat")),
        }));
      }),
      this.#externalEditor,
      this.#drafts,
      this.#panels,
    );
  }

  attachSidebar(endpoint: WebviewEndpoint): void {
    this.#sidebar?.dispose();
    this.#sidebar = this.#createConnection(endpoint);
  }

  detachSidebar(): void {
    this.#sidebar?.dispose();
    this.#sidebar = null;
  }

  openPanel(sessionId: string): void {
    this.#panels.open(sessionId);
  }

  revealPanel(sessionId: string): void {
    this.#panels.reveal(sessionId);
  }

  focusSidebarComposer(): void {
    this.#sidebar?.focusComposer();
  }

  async insertEditorReference(text: string): Promise<void> {
    const candidates = this.#referenceCandidates();
    if (!candidates.length) {
      await vscode.commands.executeCommand("frostpi.focus");
      return;
    }
    const selected = candidates.length === 1
      ? candidates[0]
      : await vscode.window.showQuickPick(candidates.map((candidate) => ({
          label: candidate.title,
          description: candidate.externalized ? "Session Tab" : "FrostPi sidebar",
          candidate,
        })), {
          title: "Insert file reference into FrostPi Session",
          placeHolder: "Choose the destination Session",
          ignoreFocusOut: true,
        }).then((item) => item?.candidate);
    if (!selected) return;

    this.#drafts.insertText(selected.sessionId, text);
    if (selected.externalized) {
      this.#panels.reveal(selected.sessionId);
      return;
    }
    await vscode.commands.executeCommand("frostpi.focus");
    this.#sidebar?.focusComposer();
  }

  broadcast(message: HostToWebviewPayload): void {
    this.#forEachConnection((connection) => connection.post(message));
  }

  dispose(): void {
    this.#sidebar?.dispose();
    this.#sidebar = null;
    for (const disposable of this.#disposables) disposable.dispose();
  }

  #createConnection(endpoint: WebviewEndpoint): WebviewConnection {
    return new WebviewConnection(
      this.#registry,
      endpoint,
      this.#dispatcher,
      this.#drafts,
      this.#logger,
      (sessionId) => this.#panels.has(sessionId),
    );
  }

  #registryChanged(): void {
    const currentIds = new Set(this.#registry.snapshot().sessions.map((session) => session.id));
    for (const sessionId of this.#knownSessionIds) {
      if (!currentIds.has(sessionId)) this.#drafts.release(sessionId);
    }
    this.#knownSessionIds = currentIds;
    this.#panels.reconcileRegistry();
    this.#refreshConnections();
  }

  #refreshConnections(): void {
    this.#forEachConnection((connection) => connection.refresh());
  }

  #forEachConnection(action: (connection: WebviewConnection) => void): void {
    if (this.#sidebar) action(this.#sidebar);
    for (const sessionId of this.#panels.sessionIds()) {
      const connection = this.#panels.connection(sessionId);
      if (connection) action(connection);
    }
  }

  #applyExternalEditorText(sessionId: string, text: string): void {
    if (!this.#registry.hasSession(sessionId)) return;
    this.#drafts.replaceText(sessionId, text);
    if (this.#panels.has(sessionId)) {
      this.#panels.reveal(sessionId);
    } else if (this.#registry.activeSessionId === sessionId) {
      void this.#focusSidebarAfterExternalEdit();
    }
  }

  async #focusSidebarAfterExternalEdit(): Promise<void> {
    try {
      await vscode.commands.executeCommand("frostpi.focus");
      this.#sidebar?.focusComposer();
    } catch (error) {
      this.#logger.error("Failed to reveal Composer destination", error);
    }
  }

  #referenceCandidates(): Array<{ sessionId: string; title: string; externalized: boolean }> {
    const ids = new Set<string>();
    const candidates: Array<{ sessionId: string; title: string; externalized: boolean }> = [];
    const activeId = this.#registry.activeSessionId;
    if (activeId) ids.add(activeId);
    for (const sessionId of this.#panels.sessionIds()) ids.add(sessionId);
    for (const sessionId of ids) {
      const session = this.#registry.sessionView(sessionId);
      if (session) candidates.push({ sessionId, title: session.title, externalized: this.#panels.has(sessionId) });
    }
    return candidates;
  }
}

function chatTypographyChanged(event: vscode.ConfigurationChangeEvent): boolean {
  return event.affectsConfiguration("chat.fontFamily")
    || event.affectsConfiguration("chat.fontSize")
    || event.affectsConfiguration("chat.editor.fontFamily")
    || event.affectsConfiguration("chat.editor.fontSize");
}
