import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  window: { showWarningMessage: vi.fn() },
  workspace: {
    getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
  },
}));

const { BRIDGE_VERSION } = await import("../../src/shared/bridge/bridgeVersion.js");
const { WebviewConnection } = await import("../../src/extension/webview-host/WebviewConnection.js");

describe("per-presentation Webview synchronization", () => {
  it("isolates pinned Session deltas and resynchronizes a hidden panel with a snapshot", async () => {
    const views = new Map([
      ["a", sessionView("a", ["a-1"])],
      ["b", sessionView("b", ["b-1"])],
    ]);
    const registry = {
      activeSessionId: "a",
      sessionView: (id: string) => views.get(id) ?? null,
      snapshot: () => ({
        workspaceName: "workspace",
        workspacePath: "/workspace",
        sessions: [...views.values()].map((view) => ({ id: view.id, title: view.title })),
        activeSessionId: "a",
        activeSession: views.get("a"),
        piAvailable: true,
      }),
    };
    const drafts = { get: () => ({ revision: 0, text: "", images: [] }) };
    const logger = { error: vi.fn(), info: vi.fn() };
    const endpointA = fakeEndpoint("a");
    const endpointB = fakeEndpoint("b");
    const dispatcher = { dispatch: vi.fn() };
    const connectionA = new WebviewConnection(registry as never, endpointA.endpoint as never, dispatcher as never, drafts as never, logger as never, () => true);
    const connectionB = new WebviewConnection(registry as never, endpointB.endpoint as never, dispatcher as never, drafts as never, logger as never, () => true);

    endpointA.receive({ type: "ready", bridgeVersion: BRIDGE_VERSION });
    endpointB.receive({ type: "ready", bridgeVersion: BRIDGE_VERSION });
    await waitFor(() => endpointA.messages.length >= 2 && endpointB.messages.length >= 2);
    endpointA.messages.length = 0;
    endpointB.messages.length = 0;

    views.set("a", sessionView("a", ["a-1", "a-2"]));
    connectionA.refresh();
    connectionB.refresh();
    await waitFor(() => endpointA.messages.length === 1 && endpointB.messages.length === 1);

    expect(endpointA.messages[0]).toMatchObject({
      type: "presentationDelta",
      presentation: { displayedSession: { base: { id: "a" } } },
    });
    expect(JSON.stringify(endpointA.messages[0])).toContain("a-2");
    expect(JSON.stringify(endpointA.messages[0])).not.toContain("b-1");
    expect(endpointB.messages[0]).toMatchObject({
      type: "presentationDelta",
      presentation: { displayedSession: { base: { id: "b" } } },
    });
    expect(JSON.stringify(endpointB.messages[0])).not.toContain("a-2");

    endpointB.messages.length = 0;
    endpointB.setVisible(false);
    views.set("b", sessionView("b", ["b-1", "b-2"]));
    connectionB.refresh();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(endpointB.messages).toEqual([]);

    endpointB.setVisible(true);
    await waitFor(() => endpointB.messages.length === 1);
    expect(endpointB.messages[0]).toMatchObject({
      type: "snapshot",
      presentation: {
        surface: { kind: "panel", sessionId: "b" },
        displayedSession: { id: "b", conversationItems: [{ id: "b-1" }, { id: "b-2" }] },
      },
    });

    connectionA.dispose();
    connectionB.dispose();
  });
});

function sessionView(id: string, itemIds: string[]) {
  return {
    id,
    title: id.toUpperCase(),
    status: "ready",
    conversationItems: itemIds.map((itemId) => ({ id: itemId })),
  };
}

function fakeEndpoint(sessionId: string) {
  let receiveListener: ((message: unknown) => void) | undefined;
  let visible = true;
  const visibilityListeners = new Set<() => void>();
  const messages: unknown[] = [];
  return {
    messages,
    endpoint: {
      surface: { kind: "panel", sessionId },
      webview: {
        onDidReceiveMessage: (listener: (message: unknown) => void) => {
          receiveListener = listener;
          return { dispose: () => { receiveListener = undefined; } };
        },
        postMessage: vi.fn((message: unknown) => {
          messages.push(message);
          return Promise.resolve(true);
        }),
      },
      isVisible: () => visible,
      onDidBecomeVisible: (listener: () => void) => {
        visibilityListeners.add(listener);
        return { dispose: () => visibilityListeners.delete(listener) };
      },
    },
    receive: (message: unknown) => receiveListener?.(message),
    setVisible: (next: boolean) => {
      visible = next;
      if (next) for (const listener of visibilityListeners) listener();
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for Webview synchronization");
}
