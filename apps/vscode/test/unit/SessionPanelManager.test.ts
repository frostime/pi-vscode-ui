import { describe, expect, it, vi } from "vitest";

import * as vscode from "vscode";

type FakeTab = { input: vscode.TabInputWebview };
const tabEvents = vi.hoisted(() => ({
  listeners: new Set<(event: { closed: FakeTab[]; opened: FakeTab[] }) => void>(),
  groups: [] as Array<{ tabs: FakeTab[] }>,
}));

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
      get all() { return tabEvents.groups; },
      onDidChangeTabs: (listener: (event: { closed: FakeTab[]; opened: FakeTab[] }) => void) => {
        tabEvents.listeners.add(listener);
        return { dispose: () => tabEvents.listeners.delete(listener) };
      },
    },
  },
}));

function webviewTab(viewType: string): FakeTab {
  return { input: new vscode.TabInputWebview(`mainThreadWebview-${viewType}`) };
}

function changeTabs({ closed = [], opened = [] }: { closed?: FakeTab[]; opened?: FakeTab[] }): void {
  for (const listener of tabEvents.listeners) listener({ closed, opened });
}

const { SessionPanelManager } = await import("../../src/extension/webview-host/SessionPanelManager.js");

describe("Session panel lifecycle", () => {
  it("pairs same-titled tabs by instance in either event order and ignores a move or old instance", () => {
    const registry = { sessionView: () => ({ title: "Same title" }), hasSession: () => true, retainProvisionalSession: vi.fn() };
    const manager = new SessionPanelManager(registry as never, {} as never, () => ({ dispose: vi.fn() }) as never);
    const createPanel = vi.mocked(vscode.window.createWebviewPanel);
    createPanel.mockClear();
    const a = fakePanel();
    const b = fakePanel();
    const reopened = fakePanel();
    for (const panel of [a, b, reopened]) createPanel.mockReturnValueOnce(panel.value as never);
    const closed: string[] = [];
    manager.onDidCloseTab((sessionId) => closed.push(sessionId));
    try {
      manager.open("a");
      manager.open("b");
      const aTab = webviewTab(createPanel.mock.calls[0]![0]);
      const bTab = webviewTab(createPanel.mock.calls[1]![0]);
      const bMoved = webviewTab(createPanel.mock.calls[1]![0]);
      tabEvents.groups = [{ tabs: [aTab] }, { tabs: [bMoved] }];
      changeTabs({ opened: [bMoved], closed: [bTab] });
      expect(closed).toEqual([]);

      // Disposal of the moved panel alone must not complete the old group's close.
      b.closeFromUser();
      expect(closed).toEqual([]);
      tabEvents.groups = [{ tabs: [aTab] }];
      changeTabs({ closed: [bMoved] });
      expect(closed).toEqual(["b"]);

      // The remaining panel delivers its two events in the reverse order.
      tabEvents.groups = [];
      changeTabs({ closed: [aTab] });
      a.closeFromUser();
      expect(closed).toEqual(["b", "a"]);

      manager.open("a");
      const newTab = webviewTab(createPanel.mock.calls[2]![0]);
      changeTabs({ closed: [aTab] });
      reopened.closeFromUser();
      expect(closed).toEqual(["b", "a"]);
      changeTabs({ closed: [newTab] });
      expect(closed).toEqual(["b", "a", "a"]);
    } finally {
      tabEvents.groups = [];
      manager.dispose();
    }
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
      expect.stringMatching(/^frostpi\.session\.[0-9]+$/),
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
  let title = "";
  const value = {
    get title() {
      if (disposed) throw new Error("Webview is disposed");
      return title;
    },
    set title(value: string) { title = value; },
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
