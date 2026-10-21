import { describe, expect, it, vi } from "vitest";

import { BRIDGE_VERSION } from "@frostime/pi-client/shared/bridge/bridgeVersion";
import type { ChatTypographyView } from "@frostime/pi-client/shared/model/chatTypography";
import { WorkspaceFileSearch } from "../../src/host/file-search/WorkspaceFileSearch.js";
import { WebviewConnection } from "../../src/host/bridge/WebviewConnection.js";
import type { WebviewEndpoint } from "../../src/host/bridge/webviewTypes.js";

describe("per-presentation Webview synchronization", () => {
  it("aborts usage on replacement/disposal and matches cancellation to the correct request", () => {
    const endpoint = fakeEndpoint("sidebar", "sidebar");
    const connection = new WebviewConnection({} as never, endpoint.endpoint, {} as never, {} as never, {} as never, () => false, () => false, hostInputs());
    const first = connection.beginProviderUsageRequest("first");
    const second = connection.beginProviderUsageRequest("second");
    expect(first.aborted).toBe(true);
    connection.cancelProviderUsageRequest("first");
    expect(second.aborted).toBe(false);
    expect(connection.finishProviderUsageRequest("first", first)).toBe(false);
    expect(connection.finishProviderUsageRequest("second", second)).toBe(true);
    const last = connection.beginProviderUsageRequest("last");
    connection.dispose();
    expect(last.aborted).toBe(true);
    expect(connection.finishProviderUsageRequest("last", last)).toBe(false);
  });
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
    const connectionA = new WebviewConnection(registry as never, endpointA.endpoint, dispatcher as never, drafts as never, logger, () => true, () => true, hostInputs());
    const connectionB = new WebviewConnection(registry as never, endpointB.endpoint, dispatcher as never, drafts as never, logger, () => true, () => true, hostInputs());

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
    await waitFor(() => endpointB.messages.length === 2);
    expect(endpointB.messages[0]).toMatchObject({
      type: "snapshot",
      presentation: {
        surface: { kind: "panel", sessionId: "b" },
        composerDraftAuthority: "host",
        displayedSession: { id: "b", conversationItems: [{ id: "b-1" }, { id: "b-2" }] },
      },
    });
    expect(endpointB.messages[1]).toMatchObject({ type: "focusComposer" });

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
      endpoint.endpoint,
      { dispatch: vi.fn() } as never,
      drafts as never,
      { error: vi.fn(), info: vi.fn() },
      () => false,
      () => false,
      hostInputs(),
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

  it.each([false, new Error("Transport unavailable")])("recovers a failed delta delivery (%s) with a current snapshot", async (failure) => {
    let view = sessionView("panel", ["first"]);
    const endpoint = fakeEndpoint("panel");
    const connection = new WebviewConnection(
      singleSessionRegistry(() => view) as never,
      endpoint.endpoint,
      { dispatch: vi.fn() } as never,
      { get: () => ({ revision: 0, text: "", images: [] }) } as never,
      { error: vi.fn(), info: vi.fn() },
      () => true,
      () => true,
      hostInputs(),
    );
    endpoint.receive({ type: "ready", bridgeVersion: BRIDGE_VERSION });
    await waitFor(() => endpoint.messages.length === 2);
    endpoint.messages.length = 0;

    endpoint.setDeliveryResult(failure);
    view = sessionView("panel", ["first", "undelivered"]);
    connection.refresh();
    await waitFor(() => endpoint.messages.length === 1);
    expect(endpoint.messages[0]).toMatchObject({ type: "presentationDelta" });

    endpoint.setDeliveryResult(true);
    endpoint.messages.length = 0;
    view = sessionView("panel", ["latest"]);
    connection.refresh();
    await waitFor(() => endpoint.messages.length === 1);
    expect(endpoint.messages[0]).toMatchObject({
      type: "snapshot",
      presentation: { displayedSession: { conversationItems: [{ id: "latest" }] } },
    });

    endpoint.messages.length = 0;
    connection.refresh();
    await waitFor(() => endpoint.messages.length === 1);
    expect(endpoint.messages[0]).toMatchObject({
      type: "presentationDelta",
      presentation: { displayedSession: { conversationItems: { mode: "upsert", items: [] } } },
    });
    connection.dispose();
  });

  it("retains Composer delivery and focus until its snapshot succeeds", async () => {
    const endpoint = fakeEndpoint("panel");
    const connection = new WebviewConnection(
      singleSessionRegistry(() => sessionView("panel", [])) as never,
      endpoint.endpoint,
      { dispatch: vi.fn() } as never,
      { get: () => ({ revision: 0, text: "", images: [] }) } as never,
      { error: vi.fn(), info: vi.fn() },
      () => true,
      () => true,
      hostInputs(),
    );
    const delivered = vi.fn();
    connection.queueComposerText("panel", "retained text", delivered);
    connection.focusComposer();
    endpoint.setDeliveryResult(false);
    endpoint.receive({ type: "ready", bridgeVersion: BRIDGE_VERSION });
    await waitFor(() => endpoint.messages.length === 2);
    expect(delivered).not.toHaveBeenCalled();
    expect(endpoint.messages).not.toContainEqual(expect.objectContaining({ type: "replaceComposerText" }));
    expect(endpoint.messages).not.toContainEqual(expect.objectContaining({ type: "focusComposer" }));

    endpoint.messages.length = 0;
    endpoint.setDeliveryResult(true);
    connection.refresh();
    await waitFor(() => endpoint.messages.length === 3);
    expect(endpoint.messages).toContainEqual(expect.objectContaining({ type: "snapshot" }));
    expect(endpoint.messages).toContainEqual(expect.objectContaining({
      type: "replaceComposerText", sessionId: "panel", text: "retained text",
    }));
    expect(endpoint.messages).toContainEqual(expect.objectContaining({ type: "focusComposer" }));
    expect(delivered).toHaveBeenCalledOnce();
    connection.dispose();
  });

  it("retains a focus request and reads current typography when a recreated Webview becomes ready", async () => {
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
    const inputs = hostInputs();
    let fontSize = 13;
    inputs.readChatTypography = () => ({ message: { fontSize }, composer: { fontSize } });
    const connection = new WebviewConnection(
      registry as never,
      endpoint.endpoint,
      { dispatch: vi.fn() } as never,
      { get: () => ({ revision: 0, text: "", images: [] }) } as never,
      { error: vi.fn(), info: vi.fn() },
      () => true,
      () => true,
      inputs,
    );

    fontSize = 19;
    connection.focusComposer();
    expect(endpoint.messages).toEqual([]);
    endpoint.receive({ type: "ready", bridgeVersion: BRIDGE_VERSION });
    await waitFor(() => endpoint.messages.length === 3);
    expect(endpoint.messages.map((message) => (message as { type: string }).type)).toEqual([
      "snapshot",
      "setChatTypography",
      "focusComposer",
    ]);
    expect(endpoint.messages).toContainEqual(expect.objectContaining({
      type: "setChatTypography",
      typography: { message: { fontSize: 19 }, composer: { fontSize: 19 } },
    }));
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

function singleSessionRegistry(readView: () => ReturnType<typeof sessionView>) {
  return {
    activeSessionId: "panel",
    sessionView: readView,
    snapshot: () => ({
      workspaceName: "workspace",
      workspacePath: "/workspace",
      sessions: [{ id: "panel", title: "Panel" }],
      activeSessionId: "panel",
    }),
  };
}

function hostInputs() {
  return {
    fileSearch: new WorkspaceFileSearch(),
    readChatTypography: (): ChatTypographyView => ({
      message: { fontSize: 13 },
      composer: { fontSize: 14 },
    }),
  };
}

function fakeEndpoint(sessionId: string, kind: "panel" | "sidebar" = "panel") {
  let receiveListener: ((message: unknown) => void) | undefined;
  let visible = true;
  let deliveryResult: boolean | Error = true;
  const visibilityListeners = new Set<(visible: boolean) => void>();
  const messages: unknown[] = [];
  const endpoint: WebviewEndpoint = {
    surface: kind === "panel" ? { kind: "panel", sessionId } : { kind: "sidebar" },
    onDidReceiveMessage: (listener) => {
      receiveListener = listener;
      return { dispose: () => { receiveListener = undefined; } };
    },
    postMessage: vi.fn((message) => {
      messages.push(message);
      return deliveryResult instanceof Error ? Promise.reject(deliveryResult) : Promise.resolve(deliveryResult);
    }),
    isVisible: () => visible,
    onDidChangeVisibility: (listener) => {
      visibilityListeners.add(listener);
      return { dispose: () => { visibilityListeners.delete(listener); } };
    },
  };
  return {
    messages,
    endpoint,
    setDeliveryResult: (result: boolean | Error) => { deliveryResult = result; },
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
