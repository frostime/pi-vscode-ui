import { BRIDGE_VERSION } from "$shared/bridge/bridgeVersion";
import type { HostToWebviewMessage } from "$shared/bridge/hostToWebview";
import type { WebviewToHostMessage, WebviewToHostPayload } from "$shared/bridge/webviewToHost";

export interface HostTransport {
  postMessage(message: WebviewToHostMessage): void;
  onMessage(listener: (message: HostToWebviewMessage) => void): () => void;
}

interface HostConnection {
  transport: HostTransport;
  subscriptions: Set<() => void>;
}

// One presentation per browser document, matching the lifetime of the UI stores.
let connection: HostConnection | undefined;

export function connectHostBridge(transport: HostTransport): () => void {
  if (connection) throw new Error("FrostPi host transport is already connected.");
  const current: HostConnection = { transport, subscriptions: new Set() };
  connection = current;
  return () => {
    if (connection !== current) return;
    connection = undefined;
    for (const unsubscribe of current.subscriptions) unsubscribe();
    current.subscriptions.clear();
  };
}

export function postToHost(message: WebviewToHostPayload): void {
  requireConnection().transport.postMessage({ ...message, bridgeVersion: BRIDGE_VERSION });
}

export function onHostMessage(listener: (message: HostToWebviewMessage) => void): () => void {
  const current = requireConnection();
  const unsubscribe = current.transport.onMessage((message) => {
    if (connection === current) listener(message);
  });
  current.subscriptions.add(unsubscribe);
  return () => {
    if (current.subscriptions.delete(unsubscribe)) unsubscribe();
  };
}

function requireConnection(): HostConnection {
  if (!connection) throw new Error("FrostPi host transport is not connected.");
  return connection;
}
