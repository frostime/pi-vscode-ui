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
    const connectionA = new WebviewConnection(registry as never, endpointA.endpoint as never, dispatcher as never, drafts as never, logger as never, () => true, () => true);
    const connectionB = new WebviewConnection(registry as never, endpointB.endpoint as never, dispatcher as never, drafts as never, logger as never, () => true, () => true);

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
    connectionB.focusComposer();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(endpointB.messages).toEqual([]);

    endpointB.setVisible(true);
    endpointB.receive({ type: "ready", bridgeVersion: BRIDGE_VERSION });
    await waitFor(() => endpointB.messages.length === 3);
    expect(endpointB.messages[0]).toMatchObject({
      type: "snapshot",
      presentation: {
        surface: { kind: "panel", sessionId: "b" },
        composerDraftAuthority: "host",
        displayedSession: { id: "b", conversationItems: [{ id: "b-1" }, { id: "b-2" }] },
      },
    });
    expect(endpointB.messages[1]).toMatchObject({ type: "setChatTypography" });
    expect(endpointB.messages[2]).toMatchObject({ type: "focusComposer" });

    connectionA.dispose();
    connectionB.dispose();
  });

  it("keeps an ordinary Sidebar draft Webview-local", async () => {
    const view = sessionView("sidebar", []);
    const registry = {
      activeSessionId: "sidebar",
      sessionView: () => view,
      snapshot: () => ({
        workspaceName: "workspace",
        workspacePath: "/workspace",
        sessions: [],
        activeSessionId: "sidebar",
        activeSession: view,
        piAvailable: true,
      }),
    };
    const endpoint = fakeEndpoint("sidebar", "sidebar");
    const drafts = { get: vi.fn(), getIfPresent: vi.fn(() => null), insertText: vi.fn() };
    const connection = new WebviewConnection(
      registry as never,
      endpoint.endpoint as never,
      { dispatch: vi.fn() } as never,
      drafts as never,
      { error: vi.fn(), info: vi.fn() } as never,
      () => false,
      () => false,
    );

    endpoint.receive({ type: "ready", bridgeVersion: BRIDGE_VERSION });
    await waitFor(() => endpoint.messages.length === 2);
    expect(endpoint.messages[0]).toMatchObject({
      type: "snapshot",
      draft: null,
      presentation: { composerDraftAuthority: "webview" },
    });

    endpoint.messages.length = 0;
    connection.insertPromptText("@file ");
    await waitFor(() => endpoint.messages.some((message) => (message as { type?: string }).type === "insertPromptText"));
    expect(drafts.insertText).not.toHaveBeenCalled();
    expect(endpoint.messages).toContainEqual(expect.objectContaining({
      type: "insertPromptText",
      sessionId: "sidebar",
      text: "@file ",
    }));

    endpoint.messages.length = 0;
    endpoint.setVisible(false);
    const delivered = vi.fn();
    connection.queueComposerText("sidebar", "from editor", delivered);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(endpoint.messages).toEqual([]);

    endpoint.setVisible(true);
    await waitFor(() => delivered.mock.calls.length === 1);
    expect(endpoint.messages).toContainEqual(expect.objectContaining({
      type: "replaceComposerText",
      sessionId: "sidebar",
      text: "from editor",
    }));
    connection.dispose();
  });

  it("retains a focus request until a recreated Webview becomes ready", async () => {
    const view = sessionView("panel", ["message"]);
    const registry = {
      activeSessionId: "sidebar",
      sessionView: () => view,
      snapshot: () => ({
        workspaceName: "workspace",
        workspacePath: "/workspace",
        sessions: [],
        activeSessionId: "sidebar",
        activeSession: null,
        piAvailable: true,
      }),
    };
    const endpoint = fakeEndpoint("panel");
    const connection = new WebviewConnection(
      registry as never,
      endpoint.endpoint as never,
      { dispatch: vi.fn() } as never,
      { get: () => ({ revision: 0, text: "", images: [] }) } as never,
      { error: vi.fn(), info: vi.fn() } as never,
      () => true,
      () => true,
    );

    connection.focusComposer();
    expect(endpoint.messages).toEqual([]);
    endpoint.receive({ type: "ready", bridgeVersion: BRIDGE_VERSION });
    await waitFor(() => endpoint.messages.length === 3);
    expect(endpoint.messages.map((message) => (message as { type: string }).type)).toEqual([
      "snapshot",
      "setChatTypography",
      "focusComposer",
    ]);
    connection.dispose();
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

function fakeEndpoint(sessionId: string, kind: "panel" | "sidebar" = "panel") {
  let receiveListener: ((message: unknown) => void) | undefined;
  let visible = true;
  const visibilityListeners = new Set<(visible: boolean) => void>();
  const messages: unknown[] = [];
  return {
    messages,
    endpoint: {
      surface: kind === "panel" ? { kind: "panel", sessionId } : { kind: "sidebar" },
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
      onDidChangeVisibility: (listener: (visible: boolean) => void) => {
        visibilityListeners.add(listener);
        return { dispose: () => visibilityListeners.delete(listener) };
      },
    },
    receive: (message: unknown) => receiveListener?.(message),
    setVisible: (next: boolean) => {
      visible = next;
      for (const listener of visibilityListeners) listener(next);
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
