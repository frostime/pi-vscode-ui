import * as vscode from "vscode";

import type { SessionRegistry } from "../sessions/SessionRegistry.js";
import { createWebviewHtml } from "./createWebviewHtml.js";
import type { WebviewConnection } from "./WebviewConnection.js";
import type { WebviewEndpoint } from "./webviewTypes.js";

export interface SessionPanelHandle {
  readonly sessionId: string;
  readonly panel: vscode.WebviewPanel;
  readonly connection: WebviewConnection;
}

export type PanelConnectionFactory = (endpoint: WebviewEndpoint) => WebviewConnection;
export type WebviewPanelFactory = (sessionId: string, title: string) => vscode.WebviewPanel;

export class SessionPanelManager implements vscode.Disposable {
  readonly #registry: SessionRegistry;
  readonly #extensionUri: vscode.Uri;
  readonly #createConnection: PanelConnectionFactory;
  readonly #createPanel: WebviewPanelFactory;
  readonly #panels = new Map<string, SessionPanelHandle>();
  readonly #changeEmitter = new vscode.EventEmitter<void>();
  #disposed = false;

  readonly onDidChange = this.#changeEmitter.event;

  constructor(
    registry: SessionRegistry,
    extensionUri: vscode.Uri,
    createConnection: PanelConnectionFactory,
    createPanel?: WebviewPanelFactory,
  ) {
    this.#registry = registry;
    this.#extensionUri = extensionUri;
    this.#createConnection = createConnection;
    this.#createPanel = createPanel ?? ((sessionId, title) => vscode.window.createWebviewPanel(
      "frostpi.session",
      title,
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.#extensionUri, "dist", "webview")],
      },
    ));
  }

  has(sessionId: string): boolean {
    return this.#panels.has(sessionId);
  }

  sessionIds(): string[] {
    return [...this.#panels.keys()];
  }

  open(sessionId: string): void {
    const existing = this.#panels.get(sessionId);
    if (existing) {
      existing.panel.reveal(existing.panel.viewColumn, false);
      return;
    }
    const session = this.#registry.sessionView(sessionId);
    if (!session) throw new Error("This FrostPi Session no longer exists.");

    const panel = this.#createPanel(sessionId, panelTitle(session.title));
    let connection: WebviewConnection | undefined;
    try {
      panel.webview.html = createWebviewHtml(panel.webview, this.#extensionUri);
      const endpoint = panelEndpoint(panel, sessionId);
      connection = this.#createConnection(endpoint);
      if (!this.#registry.hasSession(sessionId)) throw new Error("The Session was removed while its editor tab was opening.");

      const handle: SessionPanelHandle = { sessionId, panel, connection };
      this.#panels.set(sessionId, handle);
      this.#registry.retainProvisionalSession(sessionId);
      panel.onDidDispose(() => this.#forgetDisposedPanel(handle));
      this.#changeEmitter.fire();
    } catch (error) {
      connection?.dispose();
      panel.dispose();
      throw error;
    }
  }

  reveal(sessionId: string): void {
    const handle = this.#panels.get(sessionId);
    if (!handle) throw new Error("This Session is not displayed in an editor tab.");
    handle.panel.reveal(handle.panel.viewColumn, false);
    handle.connection.focusComposer();
  }

  reconcileRegistry(): string[] {
    const removed: string[] = [];
    for (const [sessionId, handle] of this.#panels) {
      const session = this.#registry.sessionView(sessionId);
      if (!session) {
        removed.push(sessionId);
        this.#panels.delete(sessionId);
        handle.connection.dispose();
        handle.panel.dispose();
        continue;
      }
      handle.panel.title = panelTitle(session.title);
    }
    if (removed.length) this.#changeEmitter.fire();
    return removed;
  }

  connection(sessionId: string): WebviewConnection | undefined {
    return this.#panels.get(sessionId)?.connection;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const handles = [...this.#panels.values()];
    this.#panels.clear();
    for (const handle of handles) {
      handle.connection.dispose();
      handle.panel.dispose();
    }
    this.#changeEmitter.dispose();
  }

  #forgetDisposedPanel(handle: SessionPanelHandle): void {
    if (this.#panels.get(handle.sessionId) !== handle) return;
    this.#panels.delete(handle.sessionId);
    handle.connection.dispose();
    this.#changeEmitter.fire();
  }
}

function panelEndpoint(panel: vscode.WebviewPanel, sessionId: string): WebviewEndpoint {
  return {
    webview: panel.webview,
    surface: { kind: "panel", sessionId },
    isVisible: () => panel.visible,
    onDidChangeVisibility: (listener) => panel.onDidChangeViewState((event) => {
      listener(event.webviewPanel.visible);
    }),
  };
}

function panelTitle(sessionTitle: string): string {
  return `FrostPi · ${sessionTitle}`;
}
