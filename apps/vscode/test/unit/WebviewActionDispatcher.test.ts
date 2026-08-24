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
      activateSession: vi.fn(),
      closeSession: vi.fn(),
      abort: vi.fn(),
      sendPrompt: vi.fn().mockResolvedValue(undefined),
      forkMessage: vi.fn().mockResolvedValue({ cancelled: false, forkSessionId: "fork" }),
    };
    const logger = { error: vi.fn(), info: vi.fn() };
    const openPanel = vi.fn().mockResolvedValue(undefined);
    const openComposerEditor = vi.fn().mockResolvedValue("opened");
    const drafts = {
      applyMutation: vi.fn(),
      beginSubmission: vi.fn(),
      resolveSubmission: vi.fn(),
      hasPendingSubmission: vi.fn(() => false),
    };
    const dispatcher = new WebviewActionDispatcher({
      registry: registry as never,
      logger: logger as never,
      drafts: drafts as never,
      openPanel,
      revealPanel: vi.fn(),
      openComposerEditor,
    });
    const posted: unknown[] = [];
    const connection = {
      surface: { kind: "panel" as const, sessionId: "source" },
      sessionId: "source",
      fileSearch: {} as never,
      post: (message: unknown) => posted.push(message),
      insertPromptText: vi.fn(),
    };
    const sidebarConnection = {
      ...connection,
      surface: { kind: "sidebar" as const },
      sessionId: "source",
    };
    return { dispatcher, registry, drafts, logger, openPanel, openComposerEditor, posted, connection, sidebarConnection };
  }

  it("rejects sidebar management actions from a pinned panel", async () => {
    const { dispatcher, registry, connection } = setup();
    await expect(dispatcher.dispatch({ type: "createSession", bridgeVersion: "3.0" } as never, connection)).rejects.toThrow(
      "available only from the FrostPi sidebar",
    );
    expect(registry.createSession).not.toHaveBeenCalled();
  });

  it("allows sidebar collection management to target listed non-active Sessions", async () => {
    const { dispatcher, registry, sidebarConnection } = setup();
    await dispatcher.dispatch({ type: "activateSession", bridgeVersion: "3.0", sessionId: "other" } as never, sidebarConnection);
    await dispatcher.dispatch({ type: "closeSession", bridgeVersion: "3.0", sessionId: "other" } as never, sidebarConnection);

    expect(registry.activateSession).toHaveBeenCalledWith("other");
    expect(registry.closeSession).toHaveBeenCalledWith("other");
  });

  it("transfers the displayed Sidebar draft when opening a panel", async () => {
    const { dispatcher, openPanel, sidebarConnection } = setup();
    const draft = { revision: 3, text: "handoff", images: [] };

    await dispatcher.dispatch({
      type: "openSessionPanel",
      bridgeVersion: "3.0",
      sessionId: "source",
      draft,
    } as never, sidebarConnection);

    expect(openPanel).toHaveBeenCalledWith("source", draft);
  });

  it("keeps ordinary Sidebar drafts out of the Host cache", async () => {
    const { dispatcher, registry, drafts, posted, sidebarConnection } = setup();
    await expect(dispatcher.dispatch({
      type: "updateComposerDraft",
      bridgeVersion: "3.0",
      sessionId: "source",
      draft: { revision: 1, text: "local", imageIds: [], addedImages: [] },
    } as never, sidebarConnection)).rejects.toThrow("Only an externalized Composer");

    await dispatcher.dispatch({
      type: "sendPrompt",
      bridgeVersion: "3.0",
      requestId: "prompt",
      sessionId: "source",
      text: "local",
      images: [],
      draftRevision: 1,
      streamingBehavior: "followUp",
    } as never, sidebarConnection);

    expect(drafts.applyMutation).not.toHaveBeenCalled();
    expect(drafts.beginSubmission).not.toHaveBeenCalled();
    expect(drafts.resolveSubmission).not.toHaveBeenCalled();
    expect(registry.sendPrompt).toHaveBeenCalledWith("source", "local", [], "followUp");
    expect(posted).toContainEqual(expect.objectContaining({ type: "promptResult", ok: true }));
  });

  it("keeps sidebar conversation actions scoped to the displayed Session", async () => {
    const { dispatcher, registry, sidebarConnection } = setup();
    await expect(dispatcher.dispatch({
      type: "abort",
      bridgeVersion: "3.0",
      sessionId: "other",
    } as never, sidebarConnection)).rejects.toThrow("does not target the Session displayed");
    expect(registry.abort).not.toHaveBeenCalled();
  });

  it("keeps panel actions pinned and rejects collection management", async () => {
    const { dispatcher, registry, connection } = setup();
    await expect(dispatcher.dispatch({
      type: "abort",
      bridgeVersion: "3.0",
      sessionId: "other",
    } as never, connection)).rejects.toThrow("does not target the Session displayed");
    await expect(dispatcher.dispatch({
      type: "closeSession",
      bridgeVersion: "3.0",
      sessionId: "other",
    } as never, connection)).rejects.toThrow("available only from the FrostPi sidebar");
    expect(registry.abort).not.toHaveBeenCalled();
    expect(registry.closeSession).not.toHaveBeenCalled();
  });

  it("returns Composer editor contention to the originating panel", async () => {
    const { dispatcher, openComposerEditor, posted, connection } = setup();
    openComposerEditor.mockResolvedValueOnce("already-open");

    await dispatcher.dispatch({
      type: "openComposerEditor",
      bridgeVersion: "3.0",
      sessionId: "source",
      text: "draft",
    } as never, connection);

    expect(posted).toEqual([{
      type: "toast",
      level: "info",
      message: "Finish the open composer editor tab first.",
    }]);
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

  it("reports logical Fork success when opening the result panel fails", async () => {
    const { dispatcher, registry, logger, openPanel, posted, connection } = setup();
    openPanel.mockRejectedValueOnce(new Error("panel failed"));

    await dispatcher.dispatch({
      type: "forkMessage",
      bridgeVersion: "3.0",
      requestId: "request",
      sessionId: "source",
      entryId: "entry",
    } as never, connection);

    expect(registry.forkMessage).toHaveBeenCalledOnce();
    expect(posted).toContainEqual(expect.objectContaining({ type: "forkResult", ok: true, forkSessionId: "fork" }));
    expect(posted).not.toContainEqual(expect.objectContaining({ type: "forkResult", ok: false }));
    const toast = posted.find((value): value is { type: "toast"; level: "error"; message: string } =>
      typeof value === "object" && value !== null && "type" in value && value.type === "toast");
    expect(toast?.level).toBe("error");
    expect(toast?.message).toContain("Select the Fork result in the sidebar");
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error.mock.calls[0]?.[0]).toContain("fork");
    expect(logger.error.mock.calls[0]?.[1]).toBeInstanceOf(Error);
  });
});
