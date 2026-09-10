import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postToHost = vi.fn();
vi.mock("../../src/webview/bridge/vscodeBridge", () => ({ postToHost }));

const { deliverMarkdownImageResult, loadLocalMarkdownImage } = await import(
  "../../src/webview/features/conversation/markdown/markdownImageClient.js"
);
const { EMPTY_PRESENTATION, presentationStore } = await import("../../src/webview/state/sessionViewStore.svelte.js");

beforeEach(() => {
  postToHost.mockClear();
  presentationStore.set({
    ...EMPTY_PRESENTATION,
    displayedSession: { id: "session-1" } as never,
  });
});

afterEach(() => vi.useRealTimers());

describe("markdownImageClient", () => {
  it("deduplicates an in-flight Session image and resolves its correlated result", async () => {
    const first = loadLocalMarkdownImage("./diagram.png");
    const second = loadLocalMarkdownImage("./diagram.png");
    expect(second).toBe(first);
    expect(postToHost).toHaveBeenCalledTimes(1);

    const request = postToHost.mock.calls[0]![0] as { requestId: string };
    const result = { ok: true as const, mimeType: "image/png" as const, data: "AA==", width: 1, height: 1 };
    deliverMarkdownImageResult(request.requestId, "session-1", result);

    await expect(first).resolves.toEqual(result);
  });

  it("settles a request when the Host response is lost and ignores its late result", async () => {
    vi.useFakeTimers();
    const request = loadLocalMarkdownImage(`./timeout-${Date.now()}.png`);
    const requestId = (postToHost.mock.calls[0]![0] as { requestId: string }).requestId;

    await vi.advanceTimersByTimeAsync(15_000);
    await expect(request).resolves.toEqual({ ok: false, reason: "readFailed" });
    deliverMarkdownImageResult(requestId, "session-1", {
      ok: true,
      mimeType: "image/png",
      data: "AA==",
      width: 1,
      height: 1,
    });
  });

  it("does not reuse cached image bytes for another Session", async () => {
    const source = `./session-image-${Date.now()}.png`;
    const first = loadLocalMarkdownImage(source);
    const firstRequest = postToHost.mock.calls[0]![0] as { requestId: string };
    deliverMarkdownImageResult(firstRequest.requestId, "session-1", { ok: false, reason: "notFound" });
    await first;

    presentationStore.set({ ...EMPTY_PRESENTATION, displayedSession: { id: "session-2" } as never });
    void loadLocalMarkdownImage(source);

    expect(postToHost).toHaveBeenCalledTimes(2);
    expect((postToHost.mock.calls[1]![0] as { sessionId: string }).sessionId).toBe("session-2");
  });
});
