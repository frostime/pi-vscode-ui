import { describe, expect, it, vi } from "vitest";

const vscodeMock = vi.hoisted(() => {
  class EventEmitter<T> {
    readonly listeners = new Set<(value: T) => void>();
    readonly event = (listener: (value: T) => void) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };
    fire(value: T): void { for (const listener of this.listeners) listener(value); }
    dispose(): void { this.listeners.clear(); }
  }

  return { EventEmitter, panels: [] as Array<ReturnType<typeof createPanel>> };
});

vi.mock("vscode", () => ({
  EventEmitter: vscodeMock.EventEmitter,
  Uri: {
    joinPath: (...parts: unknown[]) => ({ parts, toString: () => parts.join("/") }),
    file: (fsPath: string) => ({ fsPath }),
  },
  ViewColumn: { Active: 1 },
  commands: { executeCommand: vi.fn() },
  window: {
    createWebviewPanel: vi.fn(() => {
      const panel = createPanel();
      vscodeMock.panels.push(panel);
      return panel;
    }),
    showQuickPick: vi.fn(),
    showWarningMessage: vi.fn(),
    showTextDocument: vi.fn(),
    tabGroups: { onDidChangeTabs: vi.fn(() => ({ dispose: vi.fn() })) },
  },
  workspace: {
    textDocuments: [],
    onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    getConfiguration: vi.fn(() => ({ get: (_key: string, fallback: unknown) => fallback })),
  },
}));

const { SessionWebviewCoordinator, referenceDestinationItems } = await import("../../src/extension/webview-host/SessionWebviewCoordinator.js");

describe("Session Webview coordination", () => {
  it("delivers Registry toasts once to the Sidebar and never duplicates them in panels", async () => {
    const registryEvents = {
      change: new vscodeMock.EventEmitter<void>(),
      toast: new vscodeMock.EventEmitter<{ level: "info"; message: string }>(),
      composer: new vscodeMock.EventEmitter<{ sessionId: string; text: string }>(),
    };
    const sessions = new Map([
      ["sidebar", { id: "sidebar", title: "Sidebar", cwd: "/main" }],
      ["panel", { id: "panel", title: "Panel", cwd: "/panel" }],
    ]);
    const registry = {
      activeSessionId: "sidebar",
      snapshot: () => ({
        workspaceName: "workspace",
        workspacePath: "/main",
        sessions: [...sessions.values()],
        activeSessionId: "sidebar",
        activeSession: sessions.get("sidebar"),
        piAvailable: true,
      }),
      sessionView: (sessionId: string) => sessions.get(sessionId) ?? null,
      hasSession: (sessionId: string) => sessions.has(sessionId),
      retainProvisionalSession: vi.fn(),
      onDidChange: registryEvents.change.event,
      onDidToast: registryEvents.toast.event,
      onDidSetComposerText: registryEvents.composer.event,
    };
    const coordinator = new SessionWebviewCoordinator(
      registry as never,
      { error: vi.fn(), info: vi.fn() } as never,
      {} as never,
    );
    const sidebarMessages: unknown[] = [];
    coordinator.attachSidebar(sidebarEndpoint(sidebarMessages) as never);
    coordinator.openPanel("panel");
    const panelMessages = vscodeMock.panels.at(-1)!.messages;

    registryEvents.toast.fire({ level: "info", message: "Registry notice" });
    await vi.waitFor(() => expect(sidebarMessages).toContainEqual(expect.objectContaining({
      type: "toast",
      message: "Registry notice",
    })));
    expect(sidebarMessages.filter((message) => (message as { type?: string }).type === "toast")).toHaveLength(1);
    expect(panelMessages.filter((message) => (message as { type?: string }).type === "toast")).toEqual([]);

    coordinator.detachSidebar();
    registryEvents.toast.fire({ level: "info", message: "Best effort only" });
    expect(panelMessages.filter((message) => (message as { type?: string }).type === "toast")).toEqual([]);
    coordinator.dispose();
  });

  it("hands the latest externalized draft back to the Sidebar when its panel closes", async () => {
    const registryEvents = {
      change: new vscodeMock.EventEmitter<void>(),
      toast: new vscodeMock.EventEmitter<{ level: "info"; message: string }>(),
      composer: new vscodeMock.EventEmitter<{ sessionId: string; text: string }>(),
    };
    const session = { id: "session", title: "Session", cwd: "/main" };
    const registry = {
      activeSessionId: "session",
      snapshot: () => ({
        workspaceName: "workspace",
        workspacePath: "/main",
        sessions: [session],
        activeSessionId: "session",
        activeSession: session,
        piAvailable: true,
      }),
      sessionView: (sessionId: string) => sessionId === session.id ? session : null,
      hasSession: (sessionId: string) => sessionId === session.id,
      retainProvisionalSession: vi.fn(),
      onDidChange: registryEvents.change.event,
      onDidToast: registryEvents.toast.event,
      onDidSetComposerText: registryEvents.composer.event,
    };
    const coordinator = new SessionWebviewCoordinator(
      registry as never,
      { error: vi.fn(), info: vi.fn() } as never,
      {} as never,
    );
    const sidebarMessages: unknown[] = [];
    coordinator.attachSidebar(sidebarEndpoint(sidebarMessages) as never);
    coordinator.openPanel("session", {
      revision: 4,
      text: "move me",
      images: [{ id: "image", name: "shot.png", mimeType: "image/png", data: "AA==", size: 1 }],
    });

    vscodeMock.panels.at(-1)!.dispose();

    await vi.waitFor(() => expect(sidebarMessages.some((message) => {
      if (!message || typeof message !== "object") return false;
      const candidate = message as { type?: string; sessionId?: string; draft?: { revision?: number; text?: string } };
      return candidate.type === "draftReplacement"
        && candidate.sessionId === "session"
        && candidate.draft?.revision === 4
        && candidate.draft.text === "move me";
    })).toBe(true));
    coordinator.dispose();
  });

  it("distinguishes same-titled Sessions by surface and working directory", () => {
    const items = referenceDestinationItems([
      {
        sessionId: "sidebar",
        title: "Review",
        cwd: "/workspace/main",
        workingDirectoryLabel: "main",
        externalized: false,
      },
      {
        sessionId: "panel",
        title: "Review",
        cwd: "/workspace/worktrees/feature",
        workingDirectoryLabel: "feature",
        externalized: true,
      },
    ]);

    expect(items.map(({ label, description, detail }) => ({ label, description, detail }))).toEqual([
      { label: "Review", description: "FrostPi sidebar", detail: "main · /workspace/main" },
      { label: "Review", description: "Session Tab", detail: "feature · /workspace/worktrees/feature" },
    ]);
  });
});

function createPanel() {
  const messages: unknown[] = [];
  const disposeListeners = new Set<() => void>();
  return {
    messages,
    title: "",
    visible: true,
    viewColumn: 1,
    webview: webview(messages),
    reveal: vi.fn(),
    onDidDispose: (listener: () => void) => {
      disposeListeners.add(listener);
      return { dispose: () => disposeListeners.delete(listener) };
    },
    onDidChangeViewState: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(() => { for (const listener of disposeListeners) listener(); }),
  };
}

function sidebarEndpoint(messages: unknown[]) {
  return {
    surface: { kind: "sidebar" },
    webview: webview(messages),
    isVisible: () => true,
    onDidChangeVisibility: () => ({ dispose: vi.fn() }),
  };
}

function webview(messages: unknown[]) {
  return {
    html: "",
    cspSource: "test",
    options: {},
    asWebviewUri: (uri: unknown) => ({ toString: () => String(uri) }),
    onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
    postMessage: vi.fn((message: unknown) => {
      messages.push(message);
      return Promise.resolve(true);
    }),
  };
}
