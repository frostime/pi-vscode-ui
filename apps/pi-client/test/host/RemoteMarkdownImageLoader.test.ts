import { describe, expect, it, vi } from "vitest";

import {
  loadRemoteMarkdownImage,
  type RemoteImageFetch,
  type RemoteImageResponse,
} from "../../src/host/bridge/markdown-images/RemoteMarkdownImageLoader.js";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function response(body: Uint8Array | string | null, init: { status?: number; headers?: Record<string, string> } = {}): RemoteImageResponse {
  return new Response(body, { status: init.status ?? 200, headers: init.headers ?? {} }) as unknown as RemoteImageResponse;
}

function load(source: string, fetch: RemoteImageFetch, maxBytes = 1024) {
  return loadRemoteMarkdownImage(source, { maxBytes, environment: {}, fetch });
}

describe("loadRemoteMarkdownImage", () => {
  it("returns image bytes identified by content, without credentials or a referrer", async () => {
    const fetch = vi.fn<RemoteImageFetch>().mockResolvedValue(response(PNG, { headers: { "content-type": "text/plain" } }));

    await expect(load("https://images.example.com/a?size=2", fetch)).resolves.toEqual({
      ok: true,
      mimeType: "image/png",
      data: Buffer.from(PNG).toString("base64"),
    });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, request] = fetch.mock.calls[0]!;
    expect(url).toBe("https://images.example.com/a?size=2");
    expect(request).toMatchObject({ method: "GET", redirect: "manual", referrerPolicy: "no-referrer" });
    expect(Object.keys(request.headers).map((name) => name.toLowerCase()).sort()).toEqual(["accept", "user-agent"]);
  });

  it.each([
    "http://images.example.com/a.png",
    "https://user:secret@images.example.com/a.png",
    "ftp://images.example.com/a.png",
    "file:///etc/passwd",
    "data:image/png;base64,AA==",
    "//images.example.com/a.png",
    "images/a.png",
    "not a url",
  ])("never requests %s", async (source) => {
    const fetch = vi.fn<RemoteImageFetch>();

    await expect(load(source, fetch)).resolves.toEqual({ ok: false, reason: "invalidSource" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("follows HTTPS redirects, including relative ones", async () => {
    const fetch = vi.fn<RemoteImageFetch>()
      .mockResolvedValueOnce(response(null, { status: 302, headers: { location: "/moved.png" } }))
      .mockResolvedValueOnce(response(null, { status: 307, headers: { location: "https://cdn.example.net/final.png" } }))
      .mockResolvedValueOnce(response(PNG));

    await expect(load("https://images.example.com/a.png", fetch)).resolves.toMatchObject({ ok: true });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://images.example.com/a.png",
      "https://images.example.com/moved.png",
      "https://cdn.example.net/final.png",
    ]);
  });

  it.each([
    ["a plain HTTP downgrade", "http://images.example.com/a.png"],
    ["embedded credentials", "https://user:secret@images.example.com/a.png"],
    ["a non-network scheme", "file:///etc/passwd"],
  ])("stops at a redirect to %s", async (_kind, location) => {
    const fetch = vi.fn<RemoteImageFetch>()
      .mockResolvedValueOnce(response(null, { status: 301, headers: { location } }))
      .mockResolvedValue(response(PNG));

    await expect(load("https://images.example.com/a.png", fetch)).resolves.toEqual({ ok: false, reason: "readFailed" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("gives up on a redirect loop", async () => {
    const fetch = vi.fn<RemoteImageFetch>(() => Promise.resolve(response(null, { status: 302, headers: { location: "/again" } })));

    await expect(load("https://images.example.com/a.png", fetch)).resolves.toEqual({ ok: false, reason: "readFailed" });
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it("refuses an oversized image from its declared length and from its actual body", async () => {
    const declared = vi.fn<RemoteImageFetch>().mockResolvedValue(response(PNG, { headers: { "content-length": "4096" } }));
    await expect(load("https://images.example.com/a.png", declared, 1024)).resolves.toEqual({ ok: false, reason: "tooLarge" });

    const big = new Uint8Array(64);
    big.set(PNG);
    let delivered = 0;
    const streamed = vi.fn<RemoteImageFetch>().mockResolvedValue({
      status: 200,
      headers: { get: () => null },
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          delivered += 1;
          controller.enqueue(big);
        },
      }, { highWaterMark: 0 }),
    } as unknown as RemoteImageResponse);
    await expect(load("https://images.example.com/endless.png", streamed, 100)).resolves.toEqual({ ok: false, reason: "tooLarge" });
    // The unbounded stream was abandoned as soon as it crossed the limit.
    expect(delivered).toBeLessThanOrEqual(3);
  });

  it("maps response classes to stable inline failures", async () => {
    const answer = (status: number, body: string | null = "<html>") => vi.fn<RemoteImageFetch>().mockResolvedValue(response(body, { status }));

    await expect(load("https://images.example.com/a.png", answer(404))).resolves.toEqual({ ok: false, reason: "notFound" });
    await expect(load("https://images.example.com/a.png", answer(410))).resolves.toEqual({ ok: false, reason: "notFound" });
    await expect(load("https://images.example.com/a.png", answer(403))).resolves.toEqual({ ok: false, reason: "readFailed" });
    await expect(load("https://images.example.com/a.png", answer(500))).resolves.toEqual({ ok: false, reason: "readFailed" });
    await expect(load("https://images.example.com/a.png", answer(200))).resolves.toEqual({ ok: false, reason: "unsupportedType" });
    await expect(load("https://images.example.com/a.png", answer(200, null))).resolves.toEqual({ ok: false, reason: "unsupportedType" });
    await expect(load("https://images.example.com/a.svg", answer(200, '<svg xmlns="http://www.w3.org/2000/svg"/>')))
      .resolves.toMatchObject({ ok: true, mimeType: "image/svg+xml" });
  });

  it("reports a network failure or a timeout without detail", async () => {
    const offline = vi.fn<RemoteImageFetch>().mockRejectedValue(new Error("getaddrinfo ENOTFOUND images.example.com"));
    await expect(load("https://images.example.com/a.png", offline)).resolves.toEqual({ ok: false, reason: "readFailed" });

    const stalled = vi.fn<RemoteImageFetch>((_url, request) => new Promise((_resolve, reject) => {
      request.signal.addEventListener("abort", () => reject(request.signal.reason as Error), { once: true });
    }));
    await expect(loadRemoteMarkdownImage("https://images.example.com/a.png", {
      maxBytes: 1024, environment: {}, fetch: stalled, timeoutMs: 20,
    })).resolves.toEqual({ ok: false, reason: "readFailed" });
  });

  it("fails closed instead of connecting directly when the configured proxy is unusable", async () => {
    // No fetch override: these must be rejected while building the proxy dispatcher,
    // before any socket is opened.
    for (const environment of [
      { ALL_PROXY: "socks5://127.0.0.1:1080" },
      { HTTPS_PROXY: "socks5://127.0.0.1:1080" },
      { https_proxy: "not a url" },
    ]) {
      await expect(loadRemoteMarkdownImage("https://images.example.com/a.png", { maxBytes: 1024, environment }))
        .resolves.toEqual({ ok: false, reason: "readFailed" });
    }
  });
});
