import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BRIDGE_VERSION } from "@frostime/pi-client/shared/bridge/bridgeVersion";
import type { HostToWebviewMessage } from "@frostime/pi-client/shared/bridge/hostToWebview";
import type { WebviewToHostMessage } from "@frostime/pi-client/shared/bridge/webviewToHost";
import type { HostTransport } from "$ui/bridge/hostBridge";

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("explicit presentation transport", () => {
  it("sends versioned actions and delivers correlated results without a VS Code global", async () => {
    const { connectHostBridge, onHostMessage, postToHost } = await import("$ui/bridge/hostBridge");
    const host = fakeTransport();
    const disconnect = connectHostBridge(host.transport);
    const received: HostToWebviewMessage[] = [];
    const unsubscribe = onHostMessage((message) => received.push(message));

    postToHost({ type: "listUsageProviders", requestId: "usage-test" });
    expect(host.sent).toEqual([{ type: "listUsageProviders", requestId: "usage-test", bridgeVersion: BRIDGE_VERSION }]);
    const result: HostToWebviewMessage = {
      type: "usageProvidersResult", requestId: "usage-test", providers: [], bridgeVersion: BRIDGE_VERSION,
    };
    host.receive(result);
    expect(received).toEqual([result]);

    unsubscribe();
    host.receive(result);
    expect(received).toEqual([result]);
    disconnect();
  });

  it("does not silently drop actions before connection or leak subscribers into a remount", async () => {
    const { connectHostBridge, onHostMessage, postToHost } = await import("$ui/bridge/hostBridge");
    expect(() => postToHost({ type: "ready" })).toThrow("not connected");
    const first = fakeTransport();
    const disconnect = connectHostBridge(first.transport);
    const oldListener = vi.fn();
    const oldUnsubscribe = onHostMessage(oldListener);
    expect(() => connectHostBridge(fakeTransport().transport)).toThrow("already connected");
    disconnect();
    expect(first.listeners.size).toBe(0);
    expect(() => postToHost({ type: "ready" })).toThrow("not connected");

    const second = fakeTransport();
    const disconnectSecond = connectHostBridge(second.transport);
    const listener = vi.fn();
    onHostMessage(listener);
    // Cleanup from the previous mount must not disconnect the new presentation.
    oldUnsubscribe();
    disconnect();
    const message: HostToWebviewMessage = { type: "focusComposer", bridgeVersion: BRIDGE_VERSION };
    first.receive(message);
    second.receive(message);
    postToHost({ type: "ready" });
    expect(oldListener).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledWith(message);
    expect(second.sent).toEqual([{ type: "ready", bridgeVersion: BRIDGE_VERSION }]);
    disconnectSecond();
    expect(second.listeners.size).toBe(0);
  });
});

describe("VS Code transport adapter", () => {
  it("acquires the native API only at startup and reuses it across reconnects", async () => {
    const postMessage = vi.fn();
    const acquireVsCodeApi = vi.fn(() => ({ postMessage }));
    const browserWindow = Object.assign(new EventTarget(), { acquireVsCodeApi });
    vi.stubGlobal("window", browserWindow);
    const { createVsCodeTransport } = await import("../../src/webview/bridge/vscodeBridge");
    expect(acquireVsCodeApi).not.toHaveBeenCalled();

    const { connectHostBridge, onHostMessage, postToHost } = await import("$ui/bridge/hostBridge");
    const disconnect = connectHostBridge(createVsCodeTransport());
    const listener = vi.fn();
    const unsubscribe = onHostMessage(listener);
    const message: HostToWebviewMessage = { type: "focusComposer", bridgeVersion: BRIDGE_VERSION };
    browserWindow.dispatchEvent(new MessageEvent("message", { data: message }));
    expect(listener).toHaveBeenCalledWith(message);
    postToHost({ type: "ready" });
    expect(postMessage).toHaveBeenCalledWith({ type: "ready", bridgeVersion: BRIDGE_VERSION });

    unsubscribe();
    browserWindow.dispatchEvent(new MessageEvent("message", { data: message }));
    expect(listener).toHaveBeenCalledTimes(1);
    disconnect();
    const disconnectAgain = connectHostBridge(createVsCodeTransport());
    postToHost({ type: "ready" });
    expect(acquireVsCodeApi).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledTimes(2);
    disconnectAgain();
  });

  it("fails visibly instead of substituting an empty native API", async () => {
    vi.stubGlobal("window", new EventTarget());
    const { createVsCodeTransport } = await import("../../src/webview/bridge/vscodeBridge");
    expect(() => createVsCodeTransport()).toThrow("VS Code messaging API is unavailable");
  });
});

function fakeTransport() {
  const sent: WebviewToHostMessage[] = [];
  const listeners = new Set<(message: HostToWebviewMessage) => void>();
  const transport: HostTransport = {
    postMessage: (message) => { sent.push(message); },
    onMessage: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  return {
    transport,
    sent,
    listeners,
    receive: (message: HostToWebviewMessage) => { for (const listener of listeners) listener(message); },
  };
}
