import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  EventEmitter: class<T> {
    listeners = new Set<(value: T) => void>();
    event = (listener: (value: T) => void) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };
    fire(value: T): void { for (const listener of this.listeners) listener(value); }
    dispose(): void { this.listeners.clear(); }
  },
}));

const { ComposerDraftCache } = await import("../../src/extension/webview-host/ComposerDraftCache.js");

describe("Host Composer draft handoff", () => {
  let cache: InstanceType<typeof ComposerDraftCache>;

  beforeEach(() => {
    cache = new ComposerDraftCache();
  });

  it("accepts only newer revisions and retains images across text replacement", () => {
    expect(cache.replace("session", {
      revision: 2,
      text: "draft",
      images: [{ id: "image", name: "shot.png", mimeType: "image/png", data: "AA==", size: 1 }],
    })).toBe(true);
    expect(cache.replace("session", { revision: 1, text: "stale", images: [] })).toBe(false);

    cache.replaceText("session", "from editor");
    expect(cache.get("session")).toMatchObject({
      revision: 3,
      text: "from editor",
      images: [expect.objectContaining({ id: "image" })],
    });
  });

  it("reuses cached image bytes for text-only mutations", () => {
    cache.applyMutation("session", {
      revision: 1,
      text: "",
      imageIds: ["image"],
      addedImages: [{ id: "image", name: "shot.png", mimeType: "image/png", data: "AA==", size: 1 }],
    });
    cache.applyMutation("session", {
      revision: 2,
      text: "describe it",
      imageIds: ["image"],
      addedImages: [],
    });

    expect(cache.get("session")).toMatchObject({
      revision: 2,
      text: "describe it",
      images: [expect.objectContaining({ id: "image", data: "AA==" })],
    });
  });

  it("restores a failed submission only when no newer draft exists", () => {
    cache.replace("session", { revision: 4, text: "send me", images: [] });
    cache.beginSubmission("session", "request-1", cache.get("session"));
    expect(cache.get("session")).toMatchObject({ revision: 5, text: "" });

    cache.resolveSubmission("session", "request-1", false);
    expect(cache.get("session")).toMatchObject({ revision: 6, text: "send me" });

    cache.beginSubmission("session", "request-2", cache.get("session"));
    cache.replace("session", { revision: 8, text: "newer", images: [] });
    cache.resolveSubmission("session", "request-2", false);
    expect(cache.get("session")).toMatchObject({ revision: 8, text: "newer" });
  });

  it("releases both current and failure state with the Session", () => {
    cache.replace("session", { revision: 1, text: "draft", images: [] });
    cache.beginSubmission("session", "request", cache.get("session"));
    cache.release("session");
    cache.resolveSubmission("session", "request", false);
    expect(cache.get("session")).toEqual({ revision: 0, text: "", images: [] });
  });
});
