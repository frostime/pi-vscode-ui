import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WebviewToHostMessage } from "$shared/bridge/webviewToHost";
import ClientApp from "$ui/ClientApp.svelte";
import { applyHostMessage } from "$ui/bridge/applyHostMessage";
import { connectHostBridge, onHostMessage, postToHost } from "$ui/bridge/hostBridge";
import { composerDrafts, getDraft } from "$ui/features/composer/composerDraftStore.svelte";
import { setDraft } from "$ui/features/composer/composerDraftSync";
import type { LocalComposerCommands } from "$ui/features/composer/frostPiCommands";
import { queuedPromptRecoveryFeedback, queuedPromptRecoveryRequests } from "$ui/features/composer/queuedPromptRecoveryStore.svelte";
import { EMPTY_PRESENTATION, presentationStore, toastStore } from "$ui/state/sessionViewStore.svelte";
import { queuedRecoveryHost } from "../../../pi-client/test/fixtures/queuedRecoveryHost.js";

const png = {
  id: "new-image", name: "pixel.png", mimeType: "image/png" as const,
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7nkAAAAASUVORK5CYII=", size: 68,
};
const localCommands: LocalComposerCommands = { completions: (commands) => commands, handle: () => undefined };
const noUsage = { listProviders: () => Promise.resolve([]), queryUsage: () => Promise.resolve([]) };
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
Object.defineProperty(Element.prototype, "scrollTo", { configurable: true, writable: true, value: () => undefined });

const fixtures: Awaited<ReturnType<typeof queuedRecoveryHost>>[] = [];
let disconnect: (() => void) | undefined;
let unsubscribe: (() => void) | undefined;
beforeEach(() => {
  composerDrafts.set({});
  queuedPromptRecoveryRequests.set({});
  queuedPromptRecoveryFeedback.set({});
  presentationStore.set(EMPTY_PRESENTATION);
  toastStore.set([]);
});
afterEach(async () => {
  cleanup();
  unsubscribe?.();
  disconnect?.();
  unsubscribe = undefined;
  disconnect = undefined;
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()));
});

describe("Restore all across shared UI, Host, Runtime and actual child transport", () => {
  it.each(["pi", "oh-my-pi"] as const)("%s click recovers both queues into the latest draft without stopping or sending", async (runtime) => {
    const fixture = await queuedRecoveryHost(runtime, (dir) => ["--recovery-clear-release", join(dir, "clear")]);
    fixtures.push(fixture);
    const { registry, sessionId } = fixture;
    await registry.sendPrompt(sessionId, "active", []);
    await registry.sendPrompt(sessionId, "steer from child", [], "steer");
    await registry.sendPrompt(sessionId, "queue from child", runtime === "oh-my-pi" ? [png] : [], "followUp");
    setDraft(sessionId, "webview", { text: "existing draft", images: [] });
    const surface = fixture.presentation();
    const sent: WebviewToHostMessage[] = [];
    disconnect = connectHostBridge({
      ...surface.transport,
      postMessage: (message) => { sent.push(message); surface.transport.postMessage(message); },
    });
    unsubscribe = onHostMessage(applyHostMessage);
    const view = render(ClientApp, { props: { localComposerCommands: localCommands, providerUsageSource: noUsage } });
    postToHost({ type: "ready" });
    const restore = await view.findByRole("button", { name: "Restore all" });
    await fireEvent.click(restore);
    await waitFor(() => expect(registry.sessionView(sessionId)?.queuedPromptRecovery.state).toBe("recovering"));

    const editor = EditorView.findFromDOM(view.container.querySelector(".cm-editor")!)!;
    editor.dispatch({ changes: { from: editor.state.doc.length, insert: " edited while waiting" } });
    await waitFor(() => expect(getDraft(sessionId).text).toBe("existing draft edited while waiting"));
    await writeFile(join(fixture.directory, "clear"), "1");
    await waitFor(() => expect(getDraft(sessionId).text).toBe("steer from child\n\nqueue from child\n\nexisting draft edited while waiting"));
    await waitFor(() => expect(view.queryByRole("button", { name: "Restore all" })).toBeNull());
    await waitFor(() => expect(view.container.querySelector(".cm-editor")?.contains(document.activeElement)).toBe(true));
    expect(registry.sessionView(sessionId)?.isStreaming).toBe(true);
    expect(sent.filter((message) => message.type === "restoreQueuedPrompts")).toHaveLength(1);
    expect(sent.some((message) => message.type === "sendPrompt")).toBe(false);
    if (runtime === "oh-my-pi") {
      expect(getDraft(sessionId).images).toEqual([expect.objectContaining({ data: png.data, mimeType: png.mimeType })]);
      expect(getDraft(sessionId).images[0]?.dataUrl).toBe(`data:image/png;base64,${png.data}`);
    } else {
      expect(view.container.textContent).toContain("Sending the draft again creates a new message.");
    }
    expect(fixture.errors).toEqual([]);
  });
});
