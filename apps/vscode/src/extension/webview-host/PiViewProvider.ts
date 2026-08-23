import * as vscode from "vscode";

import { createWebviewHtml } from "./createWebviewHtml.js";
import type { SessionWebviewCoordinator } from "./SessionWebviewCoordinator.js";

export class PiViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "frostpi.chat";
  #view: vscode.WebviewView | null = null;

  readonly #extensionUri: vscode.Uri;
  readonly #coordinator: SessionWebviewCoordinator;

  constructor(extensionUri: vscode.Uri, coordinator: SessionWebviewCoordinator) {
    this.#extensionUri = extensionUri;
    this.#coordinator = coordinator;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.#view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.#extensionUri, "dist", "webview")],
    };
    webviewView.webview.html = createWebviewHtml(webviewView.webview, this.#extensionUri);
    this.#coordinator.attachSidebar({
      webview: webviewView.webview,
      surface: { kind: "sidebar" },
      isVisible: () => webviewView.visible,
      onDidBecomeVisible: (listener) => webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) listener();
      }),
    });
    webviewView.onDidDispose(() => {
      if (this.#view !== webviewView) return;
      this.#coordinator.detachSidebar();
      this.#view = null;
    });
  }

  async reveal(): Promise<void> {
    await vscode.commands.executeCommand(`${PiViewProvider.viewType}.focus`);
    this.#coordinator.focusSidebarComposer();
  }
}
