import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryUsageOptions } from "@frostime/provider-usage";
import type { HostToWebviewPayload } from "@frostime/pi-client/shared/bridge/hostToWebview";
import { BRIDGE_VERSION } from "@frostime/pi-client/shared/bridge/bridgeVersion";
import { webviewToHostSchema } from "@frostime/pi-client/shared/bridge/webviewToHost";

const usage = vi.hoisted(() => ({ listProviders: vi.fn(), queryUsage: vi.fn() }));
vi.mock("@frostime/provider-usage", () => usage);
const settings = vi.hoisted(() => ({
  mode: "inherit", endpoint: "", vscodeProxy: "", getProxyCredentials: vi.fn(),
}));
vi.mock("@frostime/provider-usage", () => usage);

const { WebviewActionDispatcher } = await import("../../src/host/bridge/WebviewActionDispatcher.js");

function configurationHost(): never {
  return {
    configuration: {
      getConfiguration: (section: string) => ({
        get: (key: string, fallback: unknown) => {
          if (section === "http" && key === "proxy") return settings.vscodeProxy;
          if (key === "network.proxy.mode") return settings.mode;
          if (key === "network.proxy.endpoint") return settings.endpoint;
          return fallback;
        },
      }),
    },
  } as never;
}

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
    host: configurationHost(),
    getProxyCredentials: settings.getProxyCredentials,
    logger: {} as never, drafts: {} as never, openPanel: vi.fn(), revealPanel: vi.fn(), openComposerEditor: vi.fn(),
  });
  return { dispatcher, connection, posted };
}

beforeEach(() => {
  vi.resetAllMocks();
  settings.mode = "inherit";
  settings.endpoint = "";
  settings.vscodeProxy = "";
  settings.getProxyCredentials.mockResolvedValue(undefined);
  for (const key of ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"]) {
    vi.stubEnv(key, "");
  }
  usage.listProviders.mockResolvedValue(providers);
  usage.queryUsage.mockResolvedValue(results);
});

afterEach(() => vi.unstubAllEnvs());

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

  it("passes current configured proxy and stored credentials to each new query without exposing them", async () => {
    const credentials = { username: "synthetic-user", password: "synthetic-password" };
    settings.getProxyCredentials.mockResolvedValue(credentials);
    settings.mode = "custom";
    settings.endpoint = "127.0.0.1:7890";
    const { dispatcher, connection, posted } = setup();
    const query = () => dispatcher.dispatch({ type: "queryProviderUsage", requestId: "query", scope: "deepseek", bridgeVersion: BRIDGE_VERSION }, connection);
    await query();
    const firstInput = usage.queryUsage.mock.calls[0]?.[1] as QueryUsageOptions;
    const url = new URL(firstInput.environment!.HTTPS_PROXY!);
    expect(url.hostname === "127.0.0.1" && url.port === "7890"
      && url.username === credentials.username && url.password === credentials.password).toBe(true);
    settings.mode = "vscode";
    settings.vscodeProxy = "http://127.0.0.1:9000";
    await query();
    const secondInput = usage.queryUsage.mock.calls[1]?.[1] as QueryUsageOptions;
    expect(new URL(secondInput.environment!.HTTPS_PROXY!).port === "9000").toBe(true);
    expect(JSON.stringify(posted).includes(credentials.password)).toBe(false);
  });

  it("does not start a query cancelled while proxy credentials are being read", async () => {
    let complete!: (value: undefined) => void;
    settings.mode = "custom";
    settings.endpoint = "127.0.0.1:7890";
    settings.getProxyCredentials.mockImplementation(() => new Promise((resolve) => complete = resolve));
    const { dispatcher, connection, posted } = setup();
    const pending = dispatcher.dispatch({ type: "queryProviderUsage", requestId: "old", scope: "deepseek", bridgeVersion: BRIDGE_VERSION }, connection);
    await vi.waitFor(() => expect(settings.getProxyCredentials).toHaveBeenCalled());
    await dispatcher.dispatch({ type: "cancelProviderUsage", requestId: "old", bridgeVersion: BRIDGE_VERSION }, connection);
    complete(undefined);
    await pending;
    expect(usage.queryUsage).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
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
