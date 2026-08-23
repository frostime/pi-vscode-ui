import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WebviewToHostPayload } from "../../src/shared/bridge/webviewToHost.js";

const bridge = vi.hoisted(() => ({ postToHost: vi.fn<(message: WebviewToHostPayload) => void>() }));
vi.mock("../../src/webview/bridge/vscodeBridge.js", () => bridge);

const { composerDrafts } = await import("../../src/webview/features/composer/composerDraftStore.svelte.js");
const { applyHostDraft, updateDraft } = await import("../../src/webview/features/composer/composerDraftSync.js");

describe("Webview Composer draft synchronization", () => {
  beforeEach(() => {
    composerDrafts.set({});
    bridge.postToHost.mockClear();
  });

  it("keeps ordinary Sidebar mutations local", () => {
    updateDraft("session", "webview", (draft) => ({ ...draft, text: "local" }));

    expect(get(composerDrafts).session?.text).toBe("local");
    expect(bridge.postToHost).not.toHaveBeenCalled();
  });

  it("posts externalized mutations immediately with a monotonically increasing revision", () => {
    updateDraft("session", "host", (draft) => ({ ...draft, text: "a" }));
    updateDraft("session", "host", (draft) => ({ ...draft, text: "ab" }));

    const revisions = bridge.postToHost.mock.calls.map(([message]) =>
      message.type === "updateComposerDraft" ? message.draft.revision : -1);
    expect(revisions).toEqual([1, 2]);
    expect(bridge.postToHost.mock.calls[1]?.[0]).toMatchObject({
      type: "updateComposerDraft",
      sessionId: "session",
      draft: { text: "ab" },
    });
  });

  it("sends image bytes only when an attachment is added", () => {
    updateDraft("session", "host", (draft) => ({
      ...draft,
      images: [{ id: "image", name: "shot.png", mimeType: "image/png", data: "AA==", dataUrl: "data:image/png;base64,AA==", size: 1 }],
    }));
    updateDraft("session", "host", (draft) => ({ ...draft, text: "describe it" }));

    const first = bridge.postToHost.mock.calls[0]?.[0];
    const second = bridge.postToHost.mock.calls[1]?.[0];
    expect(first?.type === "updateComposerDraft" && first.draft.addedImages).toHaveLength(1);
    expect(second?.type === "updateComposerDraft" && second.draft.addedImages).toEqual([]);
    expect(second?.type === "updateComposerDraft" && second.draft.imageIds).toEqual(["image"]);
  });

  it("applies authoritative Host replacements without echoing them", () => {
    applyHostDraft("session", {
      revision: 7,
      text: "host draft",
      images: [{ id: "image", name: "shot.png", mimeType: "image/png", data: "AA==", size: 1 }],
    });

    expect(get(composerDrafts).session).toEqual({
      revision: 7,
      text: "host draft",
      images: [expect.objectContaining({ id: "image", dataUrl: "data:image/png;base64,AA==" })],
    });
    expect(bridge.postToHost).not.toHaveBeenCalled();

    applyHostDraft("session", { revision: 6, text: "stale", images: [] });
    expect(get(composerDrafts).session?.text).toBe("host draft");
  });
});
