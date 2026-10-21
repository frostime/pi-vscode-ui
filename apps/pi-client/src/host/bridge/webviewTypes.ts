import type { HostToWebviewMessage } from "../../shared/bridge/hostToWebview.js";
import type { WebviewSurface } from "../../shared/model/webviewPresentationModel.js";

export interface WebviewEndpoint {
  postMessage(message: HostToWebviewMessage): Promise<boolean>;
  onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void };
  readonly surface: WebviewSurface;
  isVisible(): boolean;
  onDidChangeVisibility(listener: (visible: boolean) => void): { dispose(): void };
}

export interface ConnectionContext {
  readonly surface: WebviewSurface;
  readonly sessionId: string | null;
}
