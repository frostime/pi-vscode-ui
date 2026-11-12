import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postToHost = vi.fn();
vi.mock("$ui/bridge/hostBridge", () => ({ postToHost }));

const { deliverMarkdownImageResult, loadLocalMarkdownImage, loadRemoteMarkdownImage } = await import(
  "$ui/features/conversation/markdown/markdownImageClient.js"
);
const { EMPTY_PRESENTATION, presentationStore } = await import("$ui/state/sessionViewStore.svelte.js");

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
    const result = { ok: true as const, mimeType: "image/png" as const, data: "AA==" };
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

  it("marks only an explicit remote load for the Host and keeps it apart from a local read", async () => {
    const source = `https://images.example.com/${Date.now()}.png`;
    const local = loadLocalMarkdownImage(source);
    const remote = loadRemoteMarkdownImage(source);

    expect(postToHost).toHaveBeenCalledTimes(2);
    const [localRequest, remoteRequest] = postToHost.mock.calls.map(([message]) => message as { requestId: string; remote?: true });
    expect(localRequest).not.toHaveProperty("remote");
    expect(remoteRequest).toMatchObject({ type: "loadMarkdownImage", sessionId: "session-1", source, remote: true });

    const image = { ok: true as const, mimeType: "image/png" as const, data: "AA==" };
    deliverMarkdownImageResult(localRequest!.requestId, "session-1", { ok: false, reason: "invalidSource" });
    deliverMarkdownImageResult(remoteRequest!.requestId, "session-1", image);
    await expect(local).resolves.toEqual({ ok: false, reason: "invalidSource" });
    await expect(remote).resolves.toEqual(image);

    // The cached remote bytes must not satisfy a later local request for the same text.
    void loadLocalMarkdownImage(source);
    expect(postToHost).toHaveBeenCalledTimes(3);
    expect(postToHost.mock.calls[2]![0]).not.toHaveProperty("remote");
  });

  it("waits longer for a remote load than for a local read before giving up", async () => {
    vi.useFakeTimers();
    const request = loadRemoteMarkdownImage(`https://images.example.com/slow-${Date.now()}.png`);
    let settled = false;
    void request.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(15_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(request).resolves.toEqual({ ok: false, reason: "readFailed" });
  });
});
