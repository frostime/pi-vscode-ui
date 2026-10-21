import { expect, it, vi } from "vitest";
import { BRIDGE_VERSION } from "@frostime/pi-client/shared/bridge/bridgeVersion";
import type { HostToWebviewMessage } from "@frostime/pi-client/shared/bridge/hostToWebview";
import { WorkspaceFileSearch } from "@frostime/pi-client/host/file-search/WorkspaceFileSearch";
import { WebviewConnection } from "@frostime/pi-client/host/bridge/WebviewConnection";
import type { WebviewEndpoint } from "@frostime/pi-client/host/bridge/webviewTypes";
import { connectHostBridge, onHostMessage, postToHost } from "$ui/bridge/hostBridge";

it("completes the renderer ready/snapshot handshake without a VS Code API on either side", async () => {
  let receiveAction: ((message: unknown) => void) | undefined;
  const rendererListeners = new Set<(message: HostToWebviewMessage) => void>();
  const endpoint: WebviewEndpoint = {
    surface: { kind: "sidebar" },
    isVisible: () => true,
    onDidChangeVisibility: () => ({ dispose() {} }),
    onDidReceiveMessage: (listener) => {
      receiveAction = listener;
      return { dispose: () => { receiveAction = undefined; } };
    },
    postMessage: (message) => {
      for (const listener of rendererListeners) listener(message);
      return Promise.resolve(true);
    },
  };
  const registry = {
    activeSessionId: null,
    snapshot: () => ({ workspaceName: "test", workspacePath: "/test", sessions: [], activeSessionId: null }),
  };
  const typography = { message: { fontSize: 15 }, composer: { fontSize: 14 } };
  const logger = { info: vi.fn(), error: vi.fn() };
  const host = new WebviewConnection(
    registry as never, endpoint, {} as never, {} as never, logger, () => false, () => false,
    { fileSearch: new WorkspaceFileSearch(), readChatTypography: () => typography },
  );
  const disconnect = connectHostBridge({
    postMessage: (message) => receiveAction?.(message),
    onMessage: (listener) => {
      rendererListeners.add(listener);
      return () => { rendererListeners.delete(listener); };
    },
  });
  try {
    const received: HostToWebviewMessage[] = [];
    onHostMessage((message) => received.push(message));
    postToHost({ type: "ready" });
    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received[0]).toMatchObject({
      type: "snapshot", bridgeVersion: BRIDGE_VERSION, draft: null,
      presentation: { surface: { kind: "sidebar" }, workspacePath: "/test", displayedSession: null },
    });
    expect(received[1]).toEqual({ type: "setChatTypography", bridgeVersion: BRIDGE_VERSION, typography });
    expect(logger.error).not.toHaveBeenCalled();
  } finally {
    host.dispose();
    disconnect();
  }
  expect(receiveAction).toBeUndefined();
  expect(rendererListeners.size).toBe(0);
});
