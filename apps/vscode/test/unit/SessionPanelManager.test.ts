import { describe, expect, it, vi } from "vitest";

import * as vscode from "vscode";

const tabEvents = vi.hoisted(() => ({ listeners: new Set<(event: { closed: unknown[] }) => void>() }));

vi.mock("vscode", () => ({
  TabInputWebview: class { constructor(readonly viewType: string) {} },
  EventEmitter: class<T> {
    listeners = new Set<(value: T) => void>();
    event = (listener: (value: T) => void) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };
    fire(value: T): void { for (const listener of this.listeners) listener(value); }
    dispose(): void { this.listeners.clear(); }
  },
  Uri: { joinPath: (...parts: unknown[]) => ({ parts }) },
  ViewColumn: { Active: 1 },
  window: {
    createWebviewPanel: vi.fn(),
    tabGroups: {
      onDidChangeTabs: (listener: (event: { closed: unknown[] }) => void) => {
        tabEvents.listeners.add(listener);
        return { dispose: () => tabEvents.listeners.delete(listener) };
      },
    },
  },
}));

function closeTabs(...tabs: Array<{ label: string; viewType?: string }>): void {
  const closed = tabs.map(({ label, viewType = "mainThreadWebview-frostpi.session" }) => ({ label, input: new vscode.TabInputWebview(viewType) }));
  for (const listener of tabEvents.listeners) listener({ closed });
}

const { SessionPanelManager } = await import("../../src/extension/webview-host/SessionPanelManager.js");

describe("Session panel lifecycle", () => {
  it("reports a Session Tab the user closed, in either event order, but not a panel the window disposed", () => {
    const sessions = new Map([["a", { id: "a", title: "Alpha" }], ["b", { id: "b", title: "Beta" }], ["c", { id: "c", title: "Gamma" }]]);
    const registry = { sessionView: (id: string) => sessions.get(id) ?? null, hasSession: (id: string) => sessions.has(id), retainProvisionalSession: vi.fn() };
    const panels = new Map<string, ReturnType<typeof fakePanel>>();
    const manager = new SessionPanelManager(registry as never, {} as never, () => ({ dispose: vi.fn() }) as never, (sessionId, title) => {
      const panel = fakePanel();
      panel.value.title = title;
      panels.set(sessionId, panel);
      return panel.value as never;
    });
    const closed: string[] = [];
    manager.onDidCloseTab((sessionId) => closed.push(sessionId));
    for (const id of ["a", "b", "c"]) manager.open(id);

    // Tab event first, then the disposal.
    closeTabs({ label: "FrostPi · Alpha" }, { label: "FrostPi · Alpha", viewType: "other.view" });
    panels.get("a")!.closeFromUser();
    // Disposal first, then the tab event.
    panels.get("b")!.closeFromUser();
    closeTabs({ label: "FrostPi · Beta" });
    // A panel disposed without a closed tab, as on window close or reload.
    panels.get("c")!.closeFromUser();

    expect(closed).toEqual(["a", "b"]);
    manager.dispose();
    expect(tabEvents.listeners.size).toBe(0);
  });

  it("creates one panel per Session and tab disposal leaves the Session intact", () => {
    const sessions = new Map([["session", { id: "session", title: "Session" }]]);
    const registry = {
      sessionView: (id: string) => sessions.get(id) ?? null,
      hasSession: (id: string) => sessions.has(id),
      retainProvisionalSession: vi.fn(),
    };
    const panel = fakePanel();
    const createPanel = vi.fn(() => panel.value as never);
    const connection = { dispose: vi.fn(), focusComposer: vi.fn() };
    const manager = new SessionPanelManager(
      registry as never,
      {} as never,
      () => connection as never,
      createPanel,
    );

    manager.open("session");
    manager.open("session");
    expect(createPanel).toHaveBeenCalledOnce();
    expect(panel.value.reveal).toHaveBeenCalledOnce();
    expect(registry.retainProvisionalSession).toHaveBeenCalledWith("session");

    panel.closeFromUser();
    expect(manager.has("session")).toBe(false);
    expect(connection.dispose).toHaveBeenCalledOnce();
    expect(sessions.has("session")).toBe(true);
    manager.dispose();
  });

  it("retains Session Tab Webview context while hidden", () => {
    const panel = fakePanel();
    const createWebviewPanel = vi.mocked(vscode.window.createWebviewPanel);
    createWebviewPanel.mockReturnValueOnce(panel.value as never);
    const registry = {
      sessionView: () => ({ id: "session", title: "Session" }),
      hasSession: () => true,
      retainProvisionalSession: vi.fn(),
    };
    const manager = new SessionPanelManager(
      registry as never,
      {} as never,
      () => ({ dispose: vi.fn(), focusComposer: vi.fn() }) as never,
    );

    manager.open("session");

    expect(createWebviewPanel).toHaveBeenCalledWith(
      "frostpi.session",
      "FrostPi · Session",
      { viewColumn: 1, preserveFocus: false },
      expect.objectContaining({ enableScripts: true }),
    );
    const options = createWebviewPanel.mock.calls[0]?.[3];
    expect(options).toHaveProperty("retainContextWhenHidden", true);
    manager.dispose();
  });

  it("opens a new tab in a requested group and reports which Session Tab is active", () => {
    const sessions = new Map([["first", { id: "first", title: "First" }], ["second", { id: "second", title: "Second" }]]);
    const registry = {
      sessionView: (id: string) => sessions.get(id) ?? null,
      hasSession: (id: string) => sessions.has(id),
      retainProvisionalSession: vi.fn(),
    };
    const first = fakePanel();
    const second = fakePanel();
    const createWebviewPanel = vi.mocked(vscode.window.createWebviewPanel);
    createWebviewPanel.mockReset();
    createWebviewPanel.mockReturnValueOnce(first.value as never).mockReturnValueOnce(second.value as never);
    const manager = new SessionPanelManager(
      registry as never,
      {} as never,
      () => ({ dispose: vi.fn(), focusComposer: vi.fn() }) as never,
    );

    manager.open("first");
    first.value.viewColumn = 3;
    expect(manager.viewColumn("first")).toBe(3);
    expect(manager.viewColumn("missing")).toBeUndefined();
    expect(manager.activeSessionId()).toBeUndefined();

    manager.open("second", manager.viewColumn("first"));
    expect(createWebviewPanel.mock.calls.map((call) => call[2])).toEqual([
      { viewColumn: 1, preserveFocus: false },
      { viewColumn: 3, preserveFocus: false },
    ]);

    (second.value as { active?: boolean }).active = true;
    expect(manager.activeSessionId()).toBe("second");
    manager.dispose();
  });

  it("disposes the mapped panel exactly once after Registry removal", () => {
    const sessions = new Map([["session", { id: "session", title: "Session" }]]);
    const registry = {
      sessionView: (id: string) => sessions.get(id) ?? null,
      hasSession: (id: string) => sessions.has(id),
      retainProvisionalSession: vi.fn(),
    };
    const panel = fakePanel();
    const connection = { dispose: vi.fn(), focusComposer: vi.fn() };
    const manager = new SessionPanelManager(registry as never, {} as never, () => connection as never, () => panel.value as never);
    manager.open("session");

    sessions.delete("session");
    expect(manager.reconcileRegistry()).toEqual(["session"]);
    expect(panel.value.dispose).toHaveBeenCalledOnce();
    expect(connection.dispose).toHaveBeenCalledOnce();
    expect(manager.reconcileRegistry()).toEqual([]);
    expect(panel.value.dispose).toHaveBeenCalledOnce();
    manager.dispose();
  });
});

function fakePanel() {
  const disposeListeners = new Set<() => void>();
  const viewStateListeners = new Set<(event: { webviewPanel: { visible: boolean } }) => void>();
  let disposed = false;
  const value = {
    title: "",
    visible: true,
    viewColumn: 1,
    webview: {
      html: "",
      cspSource: "test",
      asWebviewUri: (uri: unknown) => ({ toString: () => String(uri) }),
    },
    reveal: vi.fn(),
    onDidDispose: (listener: () => void) => {
      disposeListeners.add(listener);
      return { dispose: () => disposeListeners.delete(listener) };
    },
    onDidChangeViewState: (listener: (event: { webviewPanel: { visible: boolean } }) => void) => {
      viewStateListeners.add(listener);
      return { dispose: () => viewStateListeners.delete(listener) };
    },
    dispose: vi.fn(() => {
      if (disposed) return;
      disposed = true;
      for (const listener of disposeListeners) listener();
    }),
  };
  return {
    value,
    closeFromUser: () => {
      if (disposed) return;
      disposed = true;
      for (const listener of disposeListeners) listener();
    },
  };
}
