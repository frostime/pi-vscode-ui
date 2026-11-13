import * as vscode from "vscode";

import type { SessionRegistry } from "@frostime/pi-client/host/SessionRegistry";
import { createWebviewHtml } from "./createWebviewHtml.js";
import type { WebviewConnection } from "@frostime/pi-client/host/bridge/WebviewConnection";
import type { WebviewEndpoint } from "@frostime/pi-client/host/bridge/webviewTypes";

export interface SessionPanelHandle {
  readonly sessionId: string;
  readonly panel: vscode.WebviewPanel;
  readonly connection: WebviewConnection;
}

export type PanelConnectionFactory = (endpoint: WebviewEndpoint) => WebviewConnection;
export type WebviewPanelFactory = (sessionId: string, title: string, viewColumn?: vscode.ViewColumn) => vscode.WebviewPanel;

/** A closed tab and its panel's disposal arrive as separate events, in either order. */
const CLOSE_MATCH_WINDOW_MS = 2_000;

export class SessionPanelManager implements vscode.Disposable {
  readonly #registry: SessionRegistry;
  readonly #extensionUri: vscode.Uri;
  readonly #createConnection: PanelConnectionFactory;
  readonly #createPanel: WebviewPanelFactory;
  readonly #panels = new Map<string, SessionPanelHandle>();
  readonly #changeEmitter = new vscode.EventEmitter<void>();
  readonly #closeEmitter = new vscode.EventEmitter<string>();
  readonly #subscriptions: vscode.Disposable[] = [];
  /** Session Tab titles whose tab was closed, and disposed panels, waiting for their pair. */
  #closedTabs: Array<{ label: string; at: number }> = [];
  #disposedPanels: Array<{ sessionId: string; title: string; at: number }> = [];
  #disposed = false;

  readonly onDidChange = this.#changeEmitter.event;
  /**
   * The user closed a Session Tab. A panel is also disposed when the window closes or
   * reloads; only a tab closed in the tab model counts here, so shutting VS Code down
   * never looks like closing every tab.
   */
  readonly onDidCloseTab = this.#closeEmitter.event;

  constructor(
    registry: SessionRegistry,
    extensionUri: vscode.Uri,
    createConnection: PanelConnectionFactory,
    createPanel?: WebviewPanelFactory,
  ) {
    this.#registry = registry;
    this.#extensionUri = extensionUri;
    this.#createConnection = createConnection;
    this.#createPanel = createPanel ?? ((_sessionId, title, viewColumn) => vscode.window.createWebviewPanel(
      "frostpi.session",
      title,
      { viewColumn: viewColumn ?? vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        // Keep a hidden Session Tab mounted so returning to it does not show the bootstrap UI.
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.#extensionUri, "dist", "webview")],
      },
    ));
    this.#subscriptions.push(vscode.window.tabGroups.onDidChangeTabs((event) => {
      const now = Date.now();
      for (const tab of event.closed) {
        if (tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith("frostpi.session")) {
          this.#closedTabs.push({ label: tab.label, at: now });
        }
      }
      this.#matchClosedTabs();
    }));
  }

  has(sessionId: string): boolean {
    return this.#panels.has(sessionId);
  }

  sessionIds(): string[] {
    return [...this.#panels.keys()];
  }

  /** The Session whose tab is the active editor, if a Session Tab has it. */
  activeSessionId(): string | undefined {
    for (const handle of this.#panels.values()) {
      if (handle.panel.active) return handle.sessionId;
    }
    return undefined;
  }

  /** The tab group a Session Tab currently sits in. */
  viewColumn(sessionId: string): vscode.ViewColumn | undefined {
    return this.#panels.get(sessionId)?.panel.viewColumn;
  }

  /** `viewColumn` places a new tab in a chosen group; without it the active group is used. */
  open(sessionId: string, viewColumn?: vscode.ViewColumn): void {
    const existing = this.#panels.get(sessionId);
    if (existing) {
      existing.panel.reveal(existing.panel.viewColumn, false);
      return;
    }
    const session = this.#registry.sessionView(sessionId);
    if (!session) throw new Error("This FrostPi Session no longer exists.");

    const panel = this.#createPanel(sessionId, panelTitle(session.title), viewColumn);
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
    for (const subscription of this.#subscriptions.splice(0)) subscription.dispose();
    this.#closedTabs = [];
    this.#disposedPanels = [];
    const handles = [...this.#panels.values()];
    this.#panels.clear();
    for (const handle of handles) {
      handle.connection.dispose();
      handle.panel.dispose();
    }
    this.#changeEmitter.dispose();
    this.#closeEmitter.dispose();
  }

  #forgetDisposedPanel(handle: SessionPanelHandle): void {
    if (this.#panels.get(handle.sessionId) !== handle) return;
    this.#panels.delete(handle.sessionId);
    handle.connection.dispose();
    this.#changeEmitter.fire();
    if (this.#disposed) return;
    this.#disposedPanels.push({ sessionId: handle.sessionId, title: handle.panel.title, at: Date.now() });
    this.#matchClosedTabs();
  }

  #matchClosedTabs(): void {
    const cutoff = Date.now() - CLOSE_MATCH_WINDOW_MS;
    this.#closedTabs = this.#closedTabs.filter((tab) => tab.at >= cutoff);
    this.#disposedPanels = this.#disposedPanels.filter((panel) => panel.at >= cutoff);
    for (const panel of [...this.#disposedPanels]) {
      const tabIndex = this.#closedTabs.findIndex((tab) => tab.label === panel.title);
      if (tabIndex < 0) continue;
      this.#closedTabs.splice(tabIndex, 1);
      this.#disposedPanels.splice(this.#disposedPanels.indexOf(panel), 1);
      this.#closeEmitter.fire(panel.sessionId);
    }
  }
}

function panelEndpoint(panel: vscode.WebviewPanel, sessionId: string): WebviewEndpoint {
  return {
    postMessage: (message) => Promise.resolve(panel.webview.postMessage(message)),
    onDidReceiveMessage: (listener) => panel.webview.onDidReceiveMessage(listener),
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
