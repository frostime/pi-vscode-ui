import type * as vscode from "vscode";

import type { WebviewSurface } from "../../shared/model/webviewPresentationModel.js";

export interface WebviewEndpoint {
  readonly webview: vscode.Webview;
  readonly surface: WebviewSurface;
  isVisible(): boolean;
  onDidChangeVisibility(listener: (visible: boolean) => void): vscode.Disposable;
}

export interface ConnectionContext {
  readonly surface: WebviewSurface;
  readonly sessionId: string | null;
}
