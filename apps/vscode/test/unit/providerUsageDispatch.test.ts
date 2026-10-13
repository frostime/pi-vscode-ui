import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostToWebviewPayload } from "../../src/shared/bridge/hostToWebview.js";
import { BRIDGE_VERSION } from "../../src/shared/bridge/bridgeVersion.js";
import { webviewToHostSchema } from "../../src/shared/bridge/webviewToHost.js";

const usage = vi.hoisted(() => ({ listProviders: vi.fn(), queryUsage: vi.fn() }));
vi.mock("@frostime/provider-usage", () => usage);
vi.mock("vscode", () => ({ workspace: {}, commands: {}, env: {}, window: {} }));
const { WebviewActionDispatcher } = await import("../../src/extension/webview-host/WebviewActionDispatcher.js");

const providers = [{ providerId: "deepseek", displayName: "DeepSeek", availability: "ready", source: "auth.json", reason: "" }];
const results = [{ providerId: "deepseek", source: "auth.json", status: "query-failed", reason: "Provider rejected the request." }];

function setup(kind: "sidebar" | "panel" = "sidebar") {
  let pending: { id: string; controller: AbortController } | undefined;
  const posted: HostToWebviewPayload[] = [];
  const connection = {
    surface: kind === "sidebar" ? { kind: "sidebar" as const } : { kind: "panel" as const, sessionId: "session" },
    sessionId: "session", fileSearch: {} as never, insertPromptText: vi.fn(),
    post: (message: HostToWebviewPayload) => posted.push(message),
    beginProviderUsageRequest(id: string) { pending?.controller.abort(); pending = { id, controller: new AbortController() }; return pending.controller.signal; },
    cancelProviderUsageRequest(id: string) { if (pending?.id === id) { pending.controller.abort(); pending = undefined; } },
    finishProviderUsageRequest(id: string, signal: AbortSignal) {
      if (signal.aborted || pending?.id !== id || pending.controller.signal !== signal) return false;
      pending = undefined; return true;
    },
  };
  const dispatcher = new WebviewActionDispatcher({
    registry: { snapshot: () => ({ workspacePath: "C:/workspace" }) } as never,
    logger: {} as never, drafts: {} as never, openPanel: vi.fn(), revealPanel: vi.fn(), openComposerEditor: vi.fn(),
  });
  return { dispatcher, connection, posted };
}

beforeEach(() => {
  vi.resetAllMocks();
  usage.listProviders.mockResolvedValue(providers);
  usage.queryUsage.mockResolvedValue(results);
});

describe("provider usage Host boundary", () => {
  it("validates bounded requests and rejects credentials/paths supplied by the browser", () => {
    const request = { type: "queryProviderUsage", requestId: "query", scope: "deepseek", bridgeVersion: BRIDGE_VERSION };
    expect(webviewToHostSchema.safeParse(request).success).toBe(true);
    expect(webviewToHostSchema.safeParse({ ...request, authPath: "untrusted" }).success).toBe(false);
    expect(webviewToHostSchema.safeParse({ ...request, environment: {} }).success).toBe(false);
    expect(webviewToHostSchema.safeParse({ ...request, requestId: "x".repeat(129) }).success).toBe(false);
    expect(webviewToHostSchema.safeParse({ ...request, bridgeVersion: "old" }).success).toBe(false);
  });

  it("returns safe descriptors and results only to the requesting sidebar", async () => {
    const { dispatcher, connection, posted } = setup();
    await dispatcher.dispatch({ type: "listUsageProviders", requestId: "list", bridgeVersion: BRIDGE_VERSION }, connection);
    await dispatcher.dispatch({ type: "queryProviderUsage", requestId: "query", scope: "deepseek", bridgeVersion: BRIDGE_VERSION }, connection);
    expect(posted).toEqual([
      { type: "usageProvidersResult", requestId: "list", providers },
      { type: "providerUsageResult", requestId: "query", results },
    ]);
  });

  it("rejects panel requests and unconfigured provider IDs before querying", async () => {
    const panel = setup("panel");
    await expect(panel.dispatcher.dispatch({ type: "listUsageProviders", requestId: "p", bridgeVersion: BRIDGE_VERSION }, panel.connection)).rejects.toThrow("sidebar");
    expect(usage.listProviders).not.toHaveBeenCalled();
    const sidebar = setup();
    await sidebar.dispatcher.dispatch({ type: "queryProviderUsage", requestId: "q", scope: "unknown", bridgeVersion: BRIDGE_VERSION }, sidebar.connection);
    expect(usage.queryUsage).not.toHaveBeenCalled();
    expect(sidebar.posted).toEqual([{ type: "providerUsageError", requestId: "q", message: "Could not retrieve provider usage. Try again." }]);
  });

  it("cancels old work and suppresses late results without cancelling its replacement", async () => {
    let complete!: (value: unknown) => void;
    usage.queryUsage.mockImplementationOnce(() => new Promise((resolve) => complete = resolve));
    const { dispatcher, connection, posted } = setup();
    const old = dispatcher.dispatch({ type: "queryProviderUsage", requestId: "old", scope: "deepseek", bridgeVersion: BRIDGE_VERSION }, connection);
    await vi.waitFor(() => expect(usage.queryUsage).toHaveBeenCalledTimes(1));
    await dispatcher.dispatch({ type: "listUsageProviders", requestId: "new", bridgeVersion: BRIDGE_VERSION }, connection);
    complete(results);
    await old;
    expect(posted).toEqual([{ type: "usageProvidersResult", requestId: "new", providers }]);
  });

  it("does not publish cancelled work or expose raw errors", async () => {
    let complete!: (value: unknown) => void;
    usage.listProviders.mockImplementationOnce(() => new Promise((resolve) => complete = resolve));
    const { dispatcher, connection, posted } = setup();
    const old = dispatcher.dispatch({ type: "listUsageProviders", requestId: "old", bridgeVersion: BRIDGE_VERSION }, connection);
    await dispatcher.dispatch({ type: "cancelProviderUsage", requestId: "old", bridgeVersion: BRIDGE_VERSION }, connection);
    complete(providers); await old;
    expect(posted).toEqual([]);
    usage.listProviders.mockRejectedValueOnce(new Error("Synthetic raw error that must stay private"));
    await dispatcher.dispatch({ type: "listUsageProviders", requestId: "failed", bridgeVersion: BRIDGE_VERSION }, connection);
    expect(JSON.stringify(posted)).not.toContain("Synthetic raw");
    expect(posted[0]).toMatchObject({ type: "providerUsageError", requestId: "failed" });
  });
});
