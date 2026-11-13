import { describe, expect, it, vi } from "vitest";

import { BRIDGE_VERSION } from "../../src/shared/bridge/bridgeVersion.js";

const { WebviewActionDispatcher } = await import("../../src/host/bridge/WebviewActionDispatcher.js");

function fakeHost(editor: Record<string, unknown> = {}) {
  return { editor, exportDiagnostics: undefined, systemToast: undefined } as never;
}

describe("Session Tab Host authorization", () => {
  function setup(editorTabs = true) {
    const registry = {
      hasSession: vi.fn(() => true),
      sessionView: vi.fn(() => ({ cwd: "C:/workspace", attachmentLimits: { maxImageBytes: 1024 } })),
      createSession: vi.fn(),
      activateSession: vi.fn(),
      closeSession: vi.fn(),
      startIfStopped: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn(),
      sendPrompt: vi.fn().mockResolvedValue(undefined),
      forkMessage: vi.fn().mockResolvedValue({ cancelled: false, forkSessionId: "fork" }),
    };
    const logger = { error: vi.fn(), info: vi.fn() };
    const openPanel = vi.fn().mockResolvedValue(undefined);
    const createSessionPanel = vi.fn().mockResolvedValue("created");
    const openComposerEditor = vi.fn().mockResolvedValue("opened");
    const drafts = {
      applyMutation: vi.fn(),
      beginSubmission: vi.fn(),
      resolveSubmission: vi.fn(),
      hasPendingSubmission: vi.fn(() => false),
      hasPendingRecovery: vi.fn(() => false),
    };
    const dispatcher = new WebviewActionDispatcher({
      registry: registry as never,
      getProxyCredentials: () => Promise.resolve(undefined),
      logger: logger,
      drafts: drafts as never,
      openPanel,
      revealPanel: vi.fn(),
      openComposerEditor,
      ...(editorTabs ? { createSessionPanel } : {}),
      host: fakeHost(),
    });
    const posted: unknown[] = [];
    const connection = {
      surface: { kind: "panel" as const, sessionId: "source" },
      sessionId: "source",
      fileSearch: {} as never,
      beginProviderUsageRequest: vi.fn(() => new AbortController().signal),
      cancelProviderUsageRequest: vi.fn(),
      finishProviderUsageRequest: vi.fn(() => true),
      post: (message: unknown) => posted.push(message),
      insertPromptText: vi.fn(),
      deliverQueuedPromptRecovery: vi.fn(),
    };
    const sidebarConnection = {
      ...connection,
      surface: { kind: "sidebar" as const },
      sessionId: "source",
    };
    return { dispatcher, registry, drafts, logger, openPanel, createSessionPanel, openComposerEditor, posted, connection, sidebarConnection };
  }

  it("lets a Session Tab rename only the Session it is pinned to", async () => {
    const { dispatcher, registry, connection, sidebarConnection } = setup();

    await dispatcher.dispatch({ type: "renameSession", bridgeVersion: BRIDGE_VERSION, sessionId: "source", name: "Parser work" } as never, connection);
    expect(registry.rename).toHaveBeenCalledWith("source", "Parser work");

    await expect(dispatcher.dispatch({ type: "renameSession", bridgeVersion: BRIDGE_VERSION, sessionId: "other", name: "Hijack" } as never, connection))
      .rejects.toThrow("does not target the Session displayed by this surface");
    expect(registry.rename).toHaveBeenCalledOnce();

    // The sidebar still manages every listed Session.
    await dispatcher.dispatch({ type: "renameSession", bridgeVersion: BRIDGE_VERSION, sessionId: "other", name: "Listed" } as never, sidebarConnection);
    expect(registry.rename).toHaveBeenLastCalledWith("other", "Listed");
  });

  it("creates a Session Tab beside the asking tab, or in the active group for the sidebar", async () => {
    const { dispatcher, registry, createSessionPanel, connection, sidebarConnection } = setup();

    await dispatcher.dispatch({ type: "createSessionPanel", bridgeVersion: BRIDGE_VERSION } as never, connection);
    expect(createSessionPanel).toHaveBeenLastCalledWith("source");

    await dispatcher.dispatch({ type: "createSessionPanel", bridgeVersion: BRIDGE_VERSION } as never, sidebarConnection);
    expect(createSessionPanel).toHaveBeenLastCalledWith(null);
    // Placement and creation belong to the product; the shared path creates nothing itself.
    expect(registry.createSession).not.toHaveBeenCalled();
  });

  it("refuses Session Tab creation on a host without editor tabs before creating anything", async () => {
    const { dispatcher, registry, sidebarConnection } = setup(false);
    await expect(dispatcher.dispatch({ type: "createSessionPanel", bridgeVersion: BRIDGE_VERSION } as never, sidebarConnection))
      .rejects.toThrow('"createSessionPanel" is not supported in this host.');
    expect(registry.createSession).not.toHaveBeenCalled();
  });

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

  it("returns local Markdown image failures inline to the originating connection", async () => {
    const { dispatcher, posted, connection } = setup();
    await dispatcher.dispatch({
      type: "loadMarkdownImage",
      bridgeVersion: "3.1",
      requestId: "image-1",
      sessionId: "source",
      source: "missing.png",
    } as never, connection);

    expect(posted).toEqual([{
      type: "markdownImageResult",
      requestId: "image-1",
      sessionId: "source",
      result: { ok: false, reason: "notFound" },
    }]);
  });

  it("returns a correlated inline failure when the displayed Session changes before an image read", async () => {
    const { dispatcher, posted, connection } = setup();
    await dispatcher.dispatch({
      type: "loadMarkdownImage",
      bridgeVersion: "3.1",
      requestId: "image-stale",
      sessionId: "previous-session",
      source: "image.png",
    } as never, connection);

    expect(posted).toEqual([{
      type: "markdownImageResult",
      requestId: "image-stale",
      sessionId: "previous-session",
      result: { ok: false, reason: "invalidSource" },
    }]);
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

  it("opens any listed Session in a tab from the sidebar, also one it does not display", async () => {
    const { dispatcher, openPanel, registry, sidebarConnection } = setup();
    await dispatcher.dispatch({ type: "openSessionPanel", bridgeVersion: "3.0", sessionId: "other" } as never, sidebarConnection);
    expect(openPanel).toHaveBeenCalledWith("other");
    expect(registry.startIfStopped).toHaveBeenCalledWith("other");

    vi.mocked(registry.hasSession).mockReturnValueOnce(false);
    await expect(dispatcher.dispatch({ type: "openSessionPanel", bridgeVersion: "3.0", sessionId: "gone" } as never, sidebarConnection))
      .rejects.toThrow("no longer exists");
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

    expect(posted).toMatchObject([{ type: "toast", level: "info" }]);
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
    expect(toast?.message).toContain("Fork result");
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error.mock.calls[0]?.[0]).toContain("fork");
    expect(logger.error.mock.calls[0]?.[1]).toBeInstanceOf(Error);
  });
});

describe("unsupported host editor actions", () => {
  function setup() {
    const registry = { hasSession: vi.fn(() => true) };
    const posted: unknown[] = [];
    const connection = {
      surface: { kind: "sidebar" as const },
      sessionId: null,
      fileSearch: {} as never,
      beginProviderUsageRequest: vi.fn(() => new AbortController().signal),
      cancelProviderUsageRequest: vi.fn(),
      finishProviderUsageRequest: vi.fn(() => true),
      post: (message: unknown) => posted.push(message),
      insertPromptText: vi.fn(),
      deliverQueuedPromptRecovery: vi.fn(),
    };
    const dispatcher = new WebviewActionDispatcher({
      host: fakeHost(),
      registry: registry as never,
      getProxyCredentials: () => Promise.resolve(undefined),
      logger: { error: vi.fn(), info: vi.fn() },
      drafts: {
        applyMutation: vi.fn(),
        beginSubmission: vi.fn(),
        resolveSubmission: vi.fn(),
        hasPendingSubmission: vi.fn(() => false),
        hasPendingRecovery: vi.fn(() => false),
      } as never,
      openPanel: vi.fn(),
      revealPanel: vi.fn(),
      openComposerEditor: vi.fn().mockResolvedValue("opened"),
    });
    return { dispatcher, connection, posted };
  }

  it("fails explicitly when the host cannot copy text", async () => {
    const { dispatcher, connection, posted } = setup();
    await expect(dispatcher.dispatch({
      type: "copyText",
      bridgeVersion: "3.0",
      text: "hello",
    } as never, connection)).rejects.toThrow("\"copyText\" is not supported in this host.");
    expect(posted).toEqual([]);
  });

  it("fails explicitly when the host cannot open folders or settings", async () => {
    const { dispatcher, connection } = setup();
    await expect(dispatcher.dispatch({ type: "openFolder", bridgeVersion: "3.0" } as never, connection))
      .rejects.toThrow("openFolder");
    await expect(dispatcher.dispatch({ type: "openSettings", bridgeVersion: "3.0" } as never, connection))
      .rejects.toThrow("openSettings");
  });

  it("still works when the host provides the editor capability its actions need", async () => {
    const { connection, posted } = setup();
    const dispatcherWithClipboard = new WebviewActionDispatcher({
      host: fakeHost({ writeClipboard: vi.fn().mockResolvedValue(undefined) }),
      registry: { hasSession: vi.fn(() => true) } as never,
      getProxyCredentials: () => Promise.resolve(undefined),
      logger: { error: vi.fn(), info: vi.fn() },
      drafts: {
        applyMutation: vi.fn(),
        beginSubmission: vi.fn(),
        resolveSubmission: vi.fn(),
        hasPendingSubmission: vi.fn(() => false),
      } as never,
      openPanel: vi.fn(),
      revealPanel: vi.fn(),
      openComposerEditor: vi.fn().mockResolvedValue("opened"),
    });
    await dispatcherWithClipboard.dispatch({ type: "copyText", bridgeVersion: "3.0", text: "hi" } as never, connection);
    expect(posted).toContainEqual(expect.objectContaining({ type: "toast", level: "info" }));
  });
});
