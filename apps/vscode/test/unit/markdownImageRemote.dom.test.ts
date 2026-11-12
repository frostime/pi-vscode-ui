import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BRIDGE_VERSION } from "$shared/bridge/bridgeVersion";
import type { MarkdownImageLoadResult } from "$shared/bridge/hostToWebview";
import { applyHostMessage } from "$ui/bridge/applyHostMessage";
import { connectHostBridge } from "$ui/bridge/hostBridge";
import MarkdownImage from "$ui/features/conversation/markdown/MarkdownImage.svelte";
import { EMPTY_PRESENTATION, presentationStore } from "$ui/state/sessionViewStore.svelte";

const postMessage = vi.fn();
let disconnectHost: () => void;
let imageNumber = 0;

beforeEach(() => {
  postMessage.mockClear();
  disconnectHost = connectHostBridge({ postMessage, onMessage: () => () => undefined });
  presentationStore.set({ ...EMPTY_PRESENTATION, displayedSession: { id: "session-1" } as never });
  // jsdom has no Blob URL registry.
  URL.createObjectURL = vi.fn(() => "blob:frostpi/remote-image");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  disconnectHost();
  presentationStore.set(EMPTY_PRESENTATION);
});

function mount() {
  imageNumber += 1;
  const source = `https://images.example.com/chart-${imageNumber}.png?d=context`;
  const view = render(MarkdownImage, { source, alt: "Chart", title: undefined, linked: false });
  return { view, source };
}

function answer(requestId: string, result: MarkdownImageLoadResult): void {
  applyHostMessage({ bridgeVersion: BRIDGE_VERSION, type: "markdownImageResult", requestId, sessionId: "session-1", result });
}

describe("remote Markdown image", () => {
  it("contacts nothing until Load image, then shows Host-fetched bytes from memory", async () => {
    const { view, source } = mount();
    await Promise.resolve();
    expect(postMessage).not.toHaveBeenCalled();
    expect(view.container.querySelector("img")).toBeNull();

    await fireEvent.click(view.getByRole("button", { name: "Load image" }));

    expect(postMessage).toHaveBeenCalledOnce();
    const request = postMessage.mock.calls[0]![0] as { requestId: string };
    expect(request).toMatchObject({ type: "loadMarkdownImage", sessionId: "session-1", source, remote: true });
    // The browser is never pointed at the remote origin, before or after the answer.
    expect(view.container.querySelector("img")).toBeNull();
    expect(view.container.textContent).toContain("Loading image…");

    answer(request.requestId, { ok: true, mimeType: "image/png", data: "iVBORw0KGgo=" });
    await waitFor(() => expect(view.container.querySelector("img")?.getAttribute("src")).toBe("blob:frostpi/remote-image"));
    expect(view.container.innerHTML).not.toContain("images.example.com/chart");
  });

  it("reports a failed remote load inline and does not retry by itself", async () => {
    const { view } = mount();
    await fireEvent.click(view.getByRole("button", { name: "Load image" }));
    const request = postMessage.mock.calls[0]![0] as { requestId: string };

    answer(request.requestId, { ok: false, reason: "readFailed" });

    await waitFor(() => expect(view.container.textContent).toContain("Unable to load remote image"));
    expect(view.container.querySelector("img")).toBeNull();
    expect(postMessage).toHaveBeenCalledOnce();
  });
});
