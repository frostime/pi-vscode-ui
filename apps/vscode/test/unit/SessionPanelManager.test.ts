import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
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
  window: { createWebviewPanel: vi.fn() },
}));

const { SessionPanelManager } = await import("../../src/extension/webview-host/SessionPanelManager.js");

describe("Session panel lifecycle", () => {
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
