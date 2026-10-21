import type { HostToWebviewMessage } from "$shared/bridge/hostToWebview";
import type { HostTransport } from "$ui/bridge/hostBridge";

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

let transport: HostTransport | undefined;

export function createVsCodeTransport(): HostTransport {
  // VS Code permits one API acquisition per document; reconnecting the presentation reuses it.
  if (transport) return transport;
  const browserWindow = typeof window === "undefined" ? undefined : window;
  if (!browserWindow?.acquireVsCodeApi) {
    throw new Error("VS Code messaging API is unavailable. Open FrostPi inside VS Code.");
  }
  const api = browserWindow.acquireVsCodeApi();
  transport = {
    postMessage: (message) => api.postMessage(message),
    onMessage: (listener) => {
      const handler = (event: MessageEvent<HostToWebviewMessage>): void => listener(event.data);
      browserWindow.addEventListener("message", handler);
      return () => browserWindow.removeEventListener("message", handler);
    },
  };
  return transport;
}
