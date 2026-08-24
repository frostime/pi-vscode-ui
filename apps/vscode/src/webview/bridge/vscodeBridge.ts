import type { HostToWebviewMessage } from "$shared/bridge/hostToWebview";
import { BRIDGE_VERSION } from "$shared/bridge/bridgeVersion";
import type { WebviewToHostPayload } from "$shared/bridge/webviewToHost";

interface VsCodeApi<State = unknown> {
  postMessage(message: unknown): void;
  getState(): State | undefined;
  setState(state: State): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: <State = unknown>() => VsCodeApi<State>;
  }
}

const browserWindow = typeof window === "undefined" ? undefined : window;
const api = browserWindow?.acquireVsCodeApi?.() ?? {
  postMessage() {},
  getState() {
    return undefined;
  },
  setState() {},
};

export function postToHost(message: WebviewToHostPayload): void {
  api.postMessage({ ...message, bridgeVersion: BRIDGE_VERSION });
}

export function onHostMessage(listener: (message: HostToWebviewMessage) => void): () => void {
  if (!browserWindow) return () => {};
  const handler = (event: MessageEvent<HostToWebviewMessage>) => listener(event.data);
  browserWindow.addEventListener("message", handler);
  return () => browserWindow.removeEventListener("message", handler);
}
