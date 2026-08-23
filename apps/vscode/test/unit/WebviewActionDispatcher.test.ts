import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  commands: { executeCommand: vi.fn() },
  env: { clipboard: { writeText: vi.fn() }, openExternal: vi.fn() },
  Uri: { parse: vi.fn((value: string) => ({ scheme: value.split(":")[0] })) },
  window: {},
  workspace: {},
}));

const { WebviewActionDispatcher } = await import("../../src/extension/webview-host/WebviewActionDispatcher.js");

describe("Session Tab Host authorization", () => {
  function setup() {
    const registry = {
      hasSession: vi.fn(() => true),
      createSession: vi.fn(),
      abort: vi.fn(),
      forkMessage: vi.fn().mockResolvedValue({ cancelled: false, forkSessionId: "fork" }),
    };
    const openPanel = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new WebviewActionDispatcher({
      registry: registry as never,
      logger: { error: vi.fn(), info: vi.fn() } as never,
      drafts: {} as never,
      openPanel,
      revealPanel: vi.fn(),
      openComposerEditor: vi.fn(),
    });
    const posted: unknown[] = [];
    const connection = {
      surface: { kind: "panel" as const, sessionId: "source" },
      sessionId: "source",
      fileSearch: {} as never,
      post: (message: unknown) => posted.push(message),
      insertPromptText: vi.fn(),
    };
    return { dispatcher, registry, openPanel, posted, connection };
  }

  it("rejects sidebar management actions from a pinned panel", async () => {
    const { dispatcher, registry, connection } = setup();
    await expect(dispatcher.dispatch({ type: "createSession", bridgeVersion: "3.0" } as never, connection)).rejects.toThrow(
      "available only from the FrostPi sidebar",
    );
    expect(registry.createSession).not.toHaveBeenCalled();
  });

  it("rejects a client-supplied Session id outside the panel pin", async () => {
    const { dispatcher, registry, connection } = setup();
    await expect(dispatcher.dispatch({
      type: "abort",
      bridgeVersion: "3.0",
      sessionId: "other",
    } as never, connection)).rejects.toThrow("does not target the Session displayed");
    expect(registry.abort).not.toHaveBeenCalled();
  });

  it("preserves sidebar selection policy for panel Fork and opens the distinct result tab", async () => {
    const { dispatcher, registry, openPanel, posted, connection } = setup();
    await dispatcher.dispatch({
      type: "forkMessage",
      bridgeVersion: "3.0",
      requestId: "request",
      sessionId: "source",
      entryId: "entry",
    } as never, connection);

    expect(registry.forkMessage).toHaveBeenCalledWith("source", "entry", "preserve-sidebar-selection");
    expect(openPanel).toHaveBeenCalledWith("fork");
    expect(posted).toContainEqual(expect.objectContaining({ type: "forkResult", ok: true, forkSessionId: "fork" }));
  });
});
