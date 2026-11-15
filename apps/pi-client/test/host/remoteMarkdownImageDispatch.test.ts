import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostToWebviewPayload } from "@frostime/pi-client/shared/bridge/hostToWebview";

import type { loadRemoteMarkdownImage } from "../../src/host/bridge/markdown-images/RemoteMarkdownImageLoader.js";

const loader = vi.hoisted(() => ({ loadRemoteMarkdownImage: vi.fn<typeof loadRemoteMarkdownImage>() }));
vi.mock("../../src/host/bridge/markdown-images/RemoteMarkdownImageLoader.js", () => loader);
const settings = vi.hoisted(() => ({ mode: "inherit", endpoint: "", vscodeProxy: "", getProxyCredentials: vi.fn() }));

const { WebviewActionDispatcher } = await import("../../src/host/bridge/WebviewActionDispatcher.js");

const PROXY_KEYS = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"];
const image = { ok: true as const, mimeType: "image/png" as const, data: "AA==" };

function setup() {
  const posted: HostToWebviewPayload[] = [];
  const connection = {
    surface: { kind: "panel" as const, sessionId: "session" },
    sessionId: "session", fileSearch: {}, insertPromptText: vi.fn(), deliverQueuedPromptRecovery: vi.fn(),
    beginProviderUsageRequest: vi.fn(), cancelProviderUsageRequest: vi.fn(), finishProviderUsageRequest: vi.fn(),
    post: (message: HostToWebviewPayload) => posted.push(message),
  };
  const dispatcher = new WebviewActionDispatcher({
    registry: {
      hasSession: () => true,
      sessionView: () => ({ cwd: "/workspace/project", attachmentLimits: { maxImageBytes: 4096 } }),
      snapshot: () => ({ workspacePath: "/workspace" }),
    } as never,
    host: {
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
    } as never,
    getProxyCredentials: settings.getProxyCredentials,
    logger: { error: vi.fn(), info: vi.fn() }, drafts: {} as never,
    openPanel: vi.fn(), revealPanel: vi.fn(), openComposerEditor: vi.fn(),
  });
  const request = (fields: Record<string, unknown>) => dispatcher.dispatch({
    type: "loadMarkdownImage", bridgeVersion: "test", requestId: "image-1", sessionId: "session", ...fields,
  } as never, connection as never);
  return { request, posted };
}

beforeEach(() => {
  vi.resetAllMocks();
  settings.mode = "inherit";
  settings.endpoint = "";
  settings.vscodeProxy = "";
  settings.getProxyCredentials.mockResolvedValue(undefined);
  for (const key of PROXY_KEYS) vi.stubEnv(key, "");
  loader.loadRemoteMarkdownImage.mockResolvedValue(image);
});

afterEach(() => vi.unstubAllEnvs());

describe("remote Markdown image dispatch", () => {
  it("never fetches an HTTPS source that arrives without the explicit remote flag", async () => {
    const { request, posted } = setup();
    await request({ source: "https://images.example.com/a.png" });

    expect(loader.loadRemoteMarkdownImage).not.toHaveBeenCalled();
    expect(posted).toEqual([{
      type: "markdownImageResult", requestId: "image-1", sessionId: "session",
      result: { ok: false, reason: "invalidSource" },
    }]);
  });

  it("fetches an explicit remote request within the Session's image limit and answers its Connection", async () => {
    const { request, posted } = setup();
    await request({ source: "https://images.example.com/a.png", remote: true });

    expect(loader.loadRemoteMarkdownImage).toHaveBeenCalledOnce();
    const [source, options] = loader.loadRemoteMarkdownImage.mock.calls[0]!;
    expect(source).toBe("https://images.example.com/a.png");
    expect(options.maxBytes).toBe(4096);
    expect(posted).toEqual([{ type: "markdownImageResult", requestId: "image-1", sessionId: "session", result: image }]);
  });

  it("applies the current workspace proxy and stored credentials to the request environment", async () => {
    settings.mode = "custom";
    settings.endpoint = "http://proxy.example.test:8080";
    settings.getProxyCredentials.mockResolvedValue({ username: "user", password: "secret" });
    vi.stubEnv("HTTPS_PROXY", "http://inherited.example.test:3128");
    vi.stubEnv("ALL_PROXY", "socks5://inherited.example.test:1080");
    const { request } = setup();
    await request({ source: "https://images.example.com/a.png", remote: true });

    const { environment } = loader.loadRemoteMarkdownImage.mock.calls[0]![1];
    expect(environment.HTTPS_PROXY).toBe("http://user:secret@proxy.example.test:8080/");
    expect(environment.https_proxy).toBe("http://user:secret@proxy.example.test:8080/");
    expect(environment.ALL_PROXY).toBeUndefined();
  });

  it.each([
    ["custom", "", ""],
    ["vscode", "", ""],
  ])("fails closed without a request when the selected %s proxy is not configured", async (mode, endpoint, vscodeProxy) => {
    Object.assign(settings, { mode, endpoint, vscodeProxy });
    const { request, posted } = setup();
    await request({ source: "https://images.example.com/a.png", remote: true });

    expect(loader.loadRemoteMarkdownImage).not.toHaveBeenCalled();
    expect(posted).toEqual([{
      type: "markdownImageResult", requestId: "image-1", sessionId: "session",
      result: { ok: false, reason: "readFailed" },
    }]);
  });

  it("refuses a remote request that targets a Session other than the displayed one", async () => {
    const { request, posted } = setup();
    await request({ source: "https://images.example.com/a.png", remote: true, sessionId: "another-session" });

    expect(loader.loadRemoteMarkdownImage).not.toHaveBeenCalled();
    expect(posted).toEqual([{
      type: "markdownImageResult", requestId: "image-1", sessionId: "another-session",
      result: { ok: false, reason: "invalidSource" },
    }]);
  });
});
