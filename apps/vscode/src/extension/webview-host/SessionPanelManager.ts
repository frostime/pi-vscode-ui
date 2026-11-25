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
export type WebviewPanelFactory = (viewType: string, title: string, viewColumn?: vscode.ViewColumn) => vscode.WebviewPanel;

interface SessionTab {
  readonly viewType: string;
  handle: SessionPanelHandle | undefined;
  lastTabClosed: boolean;
}

const SESSION_VIEW_TYPE_PREFIX = "frostpi.session.";
const VSCODE_WEBVIEW_VIEW_TYPE_PREFIX = "mainThreadWebview-";

/**
 * Session Tabs numbered up to this come back after VS Code restarts. Each number is a
 * Webview type of its own, which needs its own panel serializer and an
 * `onWebviewPanel:frostpi.session.<n>` activation event in the manifest; a tab takes the
 * lowest free number, so only more open tabs than this are not restored.
 */
export const RESTORABLE_SESSION_TABS = 32;

/** The Webview type of the Session Tab numbered `n`. */
export function sessionTabViewType(n: number): string {
  return `${SESSION_VIEW_TYPE_PREFIX}${n}`;
}

export class SessionPanelManager implements vscode.Disposable {
  readonly #registry: SessionRegistry;
  readonly #extensionUri: vscode.Uri;
  readonly #createConnection: PanelConnectionFactory;
  readonly #createPanel: WebviewPanelFactory;
  // Keep the instance identity until both close signals arrive, even after releasing the panel.
  readonly #tabs = new Map<string, SessionTab>();
  readonly #changeEmitter = new vscode.EventEmitter<void>();
  readonly #closeEmitter = new vscode.EventEmitter<string>();
  readonly #subscriptions: vscode.Disposable[] = [];
  /** When each Session Tab number was last handed out, by a counter. */
  readonly #issued = new Map<string, number>();
  #issueCount = 0;
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
    this.#createPanel = createPanel ?? ((viewType, title, viewColumn) => vscode.window.createWebviewPanel(
      viewType,
      title,
      { viewColumn: viewColumn ?? vscode.ViewColumn.Active, preserveFocus: false },
      {
        ...this.#webviewOptions(),
        // Keep a hidden Session Tab mounted so returning to it does not show the bootstrap UI.
        retainContextWhenHidden: true,
      },
    ));
    this.#subscriptions.push(vscode.window.tabGroups.onDidChangeTabs((event) => this.#tabGroupsChanged(event)));
  }

  has(sessionId: string): boolean {
    return this.#tabs.get(sessionId)?.handle !== undefined;
  }

  sessionIds(): string[] {
    return [...this.#tabs.values()].flatMap(({ handle }) => handle ? [handle.sessionId] : []);
  }

  /** The Session whose tab is the active editor, if a Session Tab has it. */
  activeSessionId(): string | undefined {
    for (const { handle } of this.#tabs.values()) {
      if (handle?.panel.active) return handle.sessionId;
    }
    return undefined;
  }

  /** The tab group a Session Tab currently sits in. */
  viewColumn(sessionId: string): vscode.ViewColumn | undefined {
    return this.#tabs.get(sessionId)?.handle?.panel.viewColumn;
  }

  /** `viewColumn` places a new tab in a chosen group; without it the active group is used. */
  open(sessionId: string, viewColumn?: vscode.ViewColumn): void {
    const existing = this.#tabs.get(sessionId)?.handle;
    if (existing) {
      existing.panel.reveal(existing.panel.viewColumn, false);
      return;
    }
    const session = this.#registry.sessionView(sessionId);
    if (!session) throw new Error("This FrostPi Session no longer exists.");

    const viewType = this.#freeViewType();
    this.#attach(this.#createPanel(viewType, panelTitle(session.title), viewColumn), sessionId, viewType);
  }

  /**
   * Takes over a Session Tab VS Code restored after a restart, in the group and position
   * it had and under its own Webview type. A tab whose Session is gone, such as a Temporary
   * Session, or that is already open elsewhere, is closed instead. Returns whether the tab
   * was kept.
   */
  restore(panel: vscode.WebviewPanel, sessionId: string | undefined): boolean {
    const session = sessionId ? this.#registry.sessionView(sessionId) : null;
    const viewType = sessionTabViewTypeOf(panel.viewType);
    if (!sessionId || !session || !viewType || this.#tabs.get(sessionId)?.handle) {
      panel.dispose();
      return false;
    }
    panel.webview.options = this.#webviewOptions();
    panel.title = panelTitle(session.title);
    try {
      this.#attach(panel, sessionId, viewType);
    } catch {
      return false;
    }
    return true;
  }

  #webviewOptions(): vscode.WebviewOptions {
    return { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.#extensionUri, "dist", "webview")] };
  }

  /**
   * A Session Tab number no tab uses, within the restorable range while one is free there.
   * A tab VS Code restored that no serializer has taken over yet, and a closed tab whose
   * close has not finished, still hold theirs. Numbers not handed out since activation come
   * first, then the one handed out longest ago, so a late event of a closed tab is unlikely
   * to meet a new tab of the same number.
   */
  #freeViewType(): string {
    const used = new Set([...this.#tabs.values()].map(({ viewType }) => viewType));
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const viewType = sessionViewType(tab);
        if (viewType) used.add(viewType);
      }
    }
    let choice: string | undefined;
    for (let n = 1; n <= RESTORABLE_SESSION_TABS; n += 1) {
      const viewType = sessionTabViewType(n);
      if (used.has(viewType)) continue;
      const issued = this.#issued.get(viewType);
      if (issued === undefined) {
        choice = viewType;
        break;
      }
      if (choice === undefined || issued < this.#issued.get(choice)!) choice = viewType;
    }
    for (let n = RESTORABLE_SESSION_TABS + 1; choice === undefined; n += 1) {
      if (!used.has(sessionTabViewType(n))) choice = sessionTabViewType(n);
    }
    return choice;
  }

  #attach(panel: vscode.WebviewPanel, sessionId: string, viewType: string): void {
    let connection: WebviewConnection | undefined;
    try {
      panel.webview.html = createWebviewHtml(panel.webview, this.#extensionUri, sessionId);
      const endpoint = panelEndpoint(panel, sessionId);
      connection = this.#createConnection(endpoint);
      if (!this.#registry.hasSession(sessionId)) throw new Error("The Session was removed while its editor tab was opening.");

      const handle: SessionPanelHandle = { sessionId, panel, connection };
      const tab: SessionTab = { viewType, handle, lastTabClosed: false };
      this.#issued.set(viewType, ++this.#issueCount);
      this.#registry.retainProvisionalSession(sessionId);
      this.#tabs.set(sessionId, tab);
      panel.onDidDispose(() => this.#forgetDisposedPanel(handle, tab));
      this.#changeEmitter.fire();
    } catch (error) {
      connection?.dispose();
      panel.dispose();
      throw error;
    }
  }

  reveal(sessionId: string): void {
    const handle = this.#tabs.get(sessionId)?.handle;
    if (!handle) throw new Error("This Session is not displayed in an editor tab.");
    handle.panel.reveal(handle.panel.viewColumn, false);
    handle.connection.focusComposer();
  }

  reconcileRegistry(): string[] {
    const removed: string[] = [];
    for (const [sessionId, { handle }] of this.#tabs) {
      const session = this.#registry.sessionView(sessionId);
      if (!session) {
        this.#tabs.delete(sessionId);
        if (handle) {
          removed.push(sessionId);
          handle.connection.dispose();
          handle.panel.dispose();
        }
        continue;
      }
      if (handle) handle.panel.title = panelTitle(session.title);
    }
    if (removed.length) this.#changeEmitter.fire();
    return removed;
  }

  connection(sessionId: string): WebviewConnection | undefined {
    return this.#tabs.get(sessionId)?.handle?.connection;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const subscription of this.#subscriptions.splice(0)) subscription.dispose();
    const tabs = [...this.#tabs.values()];
    this.#tabs.clear();
    for (const { handle } of tabs) {
      if (!handle) continue;
      handle.connection.dispose();
      handle.panel.dispose();
    }
    this.#changeEmitter.dispose();
    this.#closeEmitter.dispose();
  }

  #tabGroupsChanged(event: vscode.TabChangeEvent): void {
    if (!event.closed.length && !event.opened.length) return;
    const closed = new Set(event.closed.map(sessionViewType));
    const open = new Set(vscode.window.tabGroups.all.flatMap((group) => group.tabs.map(sessionViewType)));
    for (const [sessionId, tab] of this.#tabs) {
      // A group move closes the old tab but keeps the same panel open in another group.
      if (open.has(tab.viewType)) tab.lastTabClosed = false;
      else if (closed.has(tab.viewType)) {
        tab.lastTabClosed = true;
        this.#finishTabClose(sessionId, tab);
      }
    }
  }

  #forgetDisposedPanel(handle: SessionPanelHandle, tab: SessionTab): void {
    if (this.#tabs.get(handle.sessionId) !== tab) return;
    tab.handle = undefined;
    handle.connection.dispose();
    this.#changeEmitter.fire();
    this.#finishTabClose(handle.sessionId, tab);
  }

  #finishTabClose(sessionId: string, tab: SessionTab): void {
    if (tab.handle || !tab.lastTabClosed || this.#tabs.get(sessionId) !== tab) return;
    this.#tabs.delete(sessionId);
    this.#closeEmitter.fire(sessionId);
  }
}

function sessionViewType(tab: vscode.Tab): string | undefined {
  if (!(tab.input instanceof vscode.TabInputWebview)) return undefined;
  return sessionTabViewTypeOf(tab.input.viewType);
}

/** A Session Tab's Webview type, with or without the prefix VS Code's tab model adds. */
function sessionTabViewTypeOf(raw: string): string | undefined {
  const viewType = raw.startsWith(VSCODE_WEBVIEW_VIEW_TYPE_PREFIX) ? raw.slice(VSCODE_WEBVIEW_VIEW_TYPE_PREFIX.length) : raw;
  return viewType.startsWith(SESSION_VIEW_TYPE_PREFIX) ? viewType : undefined;
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
