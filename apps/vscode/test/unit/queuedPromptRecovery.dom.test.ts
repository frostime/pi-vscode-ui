import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { get } from "svelte/store";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BRIDGE_VERSION } from "$shared/bridge/bridgeVersion";
import type { HostToWebviewMessage, HostToWebviewPayload } from "$shared/bridge/hostToWebview";
import type { WebviewToHostPayload } from "$shared/bridge/webviewToHost";
import type { ImageAttachmentView, QueuedPromptView } from "$shared/model/conversationModel";
import type { QueuedPromptRecoveryView } from "$shared/model/queuedPromptRecoveryModel";
import type { SessionSummaryView, SessionViewModel } from "$shared/model/sessionViewModel";
import type { WebviewPresentationView } from "$shared/model/webviewPresentationModel";
import ClientApp from "$ui/ClientApp.svelte";
import { applyHostMessage } from "$ui/bridge/applyHostMessage";
import { connectHostBridge, onHostMessage } from "$ui/bridge/hostBridge";
import { composerDrafts, getDraft, type DraftImage } from "$ui/features/composer/composerDraftStore.svelte";
import { setDraft } from "$ui/features/composer/composerDraftSync";
import { queuedPromptRecoveryFeedback, queuedPromptRecoveryRequests } from "$ui/features/composer/queuedPromptRecoveryStore.svelte";
import { EMPTY_PRESENTATION, presentationStore, toastStore } from "$ui/state/sessionViewStore.svelte";

const postMessage = vi.fn<(message: WebviewToHostPayload) => void>();
let deliverHost: ((message: HostToWebviewMessage) => void) | undefined;
let disconnectHost: () => void;
let unsubscribeHostMessages: (() => void) | undefined;

beforeEach(() => {
  postMessage.mockClear();
  composerDrafts.set({});
  queuedPromptRecoveryRequests.set({});
  queuedPromptRecoveryFeedback.set({});
  toastStore.set([]);
  presentationStore.set(EMPTY_PRESENTATION);
  disconnectHost = connectHostBridge({
    postMessage,
    onMessage: (listener) => {
      deliverHost = listener;
      return () => { deliverHost = undefined; };
    },
  });
  // The webview entry applies transport messages through this same dispatcher.
  unsubscribeHostMessages = onHostMessage(applyHostMessage);
});

afterEach(() => {
  cleanup();
  unsubscribeHostMessages?.();
  unsubscribeHostMessages = undefined;
  disconnectHost();
});

function deliver(message: HostToWebviewPayload): void {
  if (!deliverHost) throw new Error("Host transport is not connected");
  deliverHost({ ...message, bridgeVersion: BRIDGE_VERSION });
}

function summary(id = "session"): SessionSummaryView {
  return {
    id, title: "Synthetic", cwd: "/synthetic", status: "running", isActive: true, isEphemeral: false,
    historyStatus: "loaded", requiresUserInput: false,
  };
}

function queuedPrompt(id: string, text: string, images: ImageAttachmentView[] = []): QueuedPromptView {
  return { id, text, images, timestamp: 1 };
}

const queuedImage: ImageAttachmentView = {
  id: "queued-image", name: "queued.png", mimeType: "image/png", dataUrl: "data:image/png;base64,AA==", size: 1,
};
const recoveredImage = { id: "recovered-image", name: "recovered.png", mimeType: "image/png" as const, data: "AA==", size: 1 };

function draftImage(id: string): DraftImage {
  return { id, name: `${id}.png`, mimeType: "image/png", data: "AA==", dataUrl: "data:image/png;base64,AA==", size: 1 };
}

function session(
  id = "session",
  options: { queued?: QueuedPromptView[]; recovery?: QueuedPromptRecoveryView; maxImages?: number } = {},
): SessionViewModel {
  const queued = options.queued ?? [queuedPrompt("steer", "first pending"), queuedPrompt("queue", "second pending")];
  return {
    id, title: "Synthetic session", cwd: "/synthetic", status: "running", isEphemeral: false,
    isStreaming: true, isCompacting: false, isForking: false, historyStatus: "loaded",
    model: { id: "model", provider: "example", supportsImages: true }, thinkingLevel: "off",
    availableModels: [], scopedModelIds: [], commands: [], attachmentLimits: { maxImages: options.maxImages ?? 4, maxImageBytes: 1_000 },
    collapseTurnTrace: false, composerStreamingBehavior: "steer",
    networkProxy: { mode: "direct", label: "Direct", restartRequired: false },
    questionTool: { configuredEnabled: false, appliedEnabled: false, restartRequired: false },
    conversationItems: [],
    queuedSteers: queued.filter((item) => item.id === "steer"),
    queuedFollowUps: queued.filter((item) => item.id !== "steer"),
    queuedPromptRecovery: options.recovery ?? { state: "ready" },
    pendingExtensionUi: [], extensionStatuses: [], extensionWidgets: [],
    sessionTreeAvailable: false, isNavigatingTree: false, isSummarizingTree: false, conversationContentRevision: 0,
  };
}

function presentation(kind: "sidebar" | "panel", displayed: SessionViewModel): WebviewPresentationView {
  return {
    ...EMPTY_PRESENTATION,
    workspaceName: "Project", workspacePath: "/synthetic",
    sessions: [summary(displayed.id)], activeSessionId: displayed.id, displayedSession: displayed,
    surface: kind === "panel" ? { kind, sessionId: displayed.id } : { kind },
    composerDraftAuthority: kind === "panel" ? "host" : "webview",
  };
}

const stubCommands = { completions: (commands: never[]) => commands, handle: () => undefined };

// jsdom has no ResizeObserver or element scrolling; these fixtures only need the lifecycle.
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
Object.defineProperty(Element.prototype, "scrollTo", { configurable: true, writable: true, value: () => undefined });

function restoreRequests(): Extract<WebviewToHostPayload, { type: "restoreQueuedPrompts" }>[] {
  return postMessage.mock.calls
    .map(([message]) => message)
    .filter((message): message is Extract<WebviewToHostPayload, { type: "restoreQueuedPrompts" }> => message.type === "restoreQueuedPrompts");
}

function restoreRequest(): Extract<WebviewToHostPayload, { type: "restoreQueuedPrompts" }> {
  const [request] = restoreRequests();
  if (!request) throw new Error("Expected one restoreQueuedPrompts request");
  return request;
}

function mergeResult(requestId: string, text: string, sessionId = "session"): HostToWebviewPayload {
  return {
    type: "restoreQueuedPromptsResult", requestId, sessionId, ok: true, draftTarget: "webview-merge",
    outcome: { certainty: "best-effort", content: { text, images: [] }, recoveredCount: 1, notRemovedCount: 0, warnings: [] },
  };
}

describe("pending message recovery entry", () => {
  it.each(["sidebar", "panel"] as const)("sends one correlated restore request from the %s pending group", async (kind) => {
    presentationStore.set(presentation(kind, session()));
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });

    await fireEvent.click(view.getByRole("button", { name: /Restore all/ }));
    expect(restoreRequest()).toMatchObject({ type: "restoreQueuedPrompts", sessionId: "session", draftImageCount: 0 });
    expect(restoreRequest().requestId.length).toBeGreaterThan(0);

    // A second click while the result is pending must not start another destructive operation.
    await fireEvent.click(view.getByRole("button", { name: /Restoring/ }));
    expect(restoreRequests()).toHaveLength(1);
    expect(view.queryByRole("button", { name: /Restore all/ })).toBeNull();
    expect(view.container.querySelectorAll(".pending-restore")).toHaveLength(1);
  });

  it("hides the pending group and its Restore all entry when nothing is queued", () => {
    presentationStore.set(presentation("sidebar", session("session", { queued: [] })));
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });
    expect(view.queryByRole("button", { name: /Restore all/ })).toBeNull();
    expect(view.queryByLabelText("Queued prompts")).toBeNull();
  });

  it("holds editor-tab externalization until the pending recovery result arrives", async () => {
    presentationStore.set(presentation("sidebar", session()));
    setDraft("session", "webview", { text: "sidebar draft", images: [] });
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });

    await fireEvent.click(view.getByRole("button", { name: /Restore all/ }));
    await fireEvent.click(view.getByRole("button", { name: "Session actions" }));
    await fireEvent.click(view.getByRole("button", { name: /Open in editor tab/ }));

    expect(get(toastStore).at(-1)?.message).toBe(
      "Wait for the pending message recovery to finish before opening this Session in an editor tab.",
    );
    expect(postMessage.mock.calls.map(([message]) => message.type)).not.toContain("openSessionPanel");
  });
});

describe("pending message recovery results", () => {
  it("prepends the result to the latest edited draft, focuses the Composer, and never submits", async () => {
    presentationStore.set(presentation("sidebar", session()));
    setDraft("session", "webview", { text: "keep me", images: [draftImage("draft-image")] });
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });
    // The Composer owns focus on mount; the result must restore it after the click moves it away.
    await waitFor(() => expect(view.container.querySelector(".cm-editor")?.contains(document.activeElement)).toBe(true));

    await fireEvent.click(view.getByRole("button", { name: /Restore all/ }));
    const { requestId } = restoreRequest();

    // Text editing stays available while the request is pending.
    const editor = EditorView.findFromDOM(view.container.querySelector(".cm-editor")!)!;
    editor.dispatch({ changes: { from: editor.state.doc.length, insert: " later" } });
    await waitFor(() => expect(getDraft("session").text).toBe("keep me later"));

    // Sending and new attachments are blocked, not text editing.
    expect(view.queryByRole("button", { name: /Send as/ })).toBeNull();
    await fireEvent.paste(view.container.querySelector(".cm-content")!, {
      clipboardData: { files: [new File(["synthetic"], "pasted.png", { type: "image/png" })] },
    });
    await tick();
    expect(getDraft("session").images.map(({ id }) => id)).toEqual(["draft-image"]);
    expect(get(toastStore).at(-1)?.message).toBe("Wait for pending message recovery to finish before adding images.");
    (document.activeElement as HTMLElement | null)?.blur();
    expect(view.container.querySelector(".cm-editor")?.contains(document.activeElement)).toBe(false);

    deliver({
      type: "restoreQueuedPromptsResult", requestId, sessionId: "session", ok: true, draftTarget: "webview-merge",
      outcome: {
        certainty: "best-effort",
        content: { text: "first recovered\n\nsecond recovered", images: [recoveredImage] },
        recoveredCount: 2, notRemovedCount: 0, warnings: ["delivery-uncertain"],
      },
    });

    await waitFor(() => expect(getDraft("session")).toMatchObject({
      text: "first recovered\n\nsecond recovered\n\nkeep me later",
      images: [{ id: "recovered-image" }, { id: "draft-image" }],
    }));
    expect(getDraft("session").images[0]?.dataUrl).toBe("data:image/png;base64,AA==");
    await waitFor(() => expect(view.container.querySelector(".cm-editor")?.contains(document.activeElement)).toBe(true));

    const text = view.container.textContent ?? "";
    expect(text).toContain("Returned text from 2 pending messages into the Composer. Nothing was sent.");
    expect(text).toContain("Pi may still deliver input it already accepted");
    expect(text).toContain("Sending the draft again creates a new message.");
    // The best-effort sentences already carry the delivery limit; do not repeat it as a warning.
    expect(text).not.toContain("uncertain");
    expect(postMessage.mock.calls.map(([message]) => message.type)).not.toContain("sendPrompt");
    // Sending becomes available again once the result is merged.
    expect(view.getByRole("button", { name: "Send as Steer" })).toBeTruthy();
  });

  it("ignores stale, mismatched and duplicate results before they reach a draft", async () => {
    presentationStore.set(presentation("sidebar", session()));
    setDraft("session", "webview", { text: "local draft", images: [] });
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });

    await fireEvent.click(view.getByRole("button", { name: /Restore all/ }));
    const { requestId } = restoreRequest();

    deliver(mergeResult("stale-request", "stale"));
    deliver(mergeResult(requestId, "wrong session", "other-session"));
    await tick();
    expect(getDraft("session").text).toBe("local draft");
    expect(getDraft("other-session").text).toBe("");
    // Replies that do not match the registered request leave it pending.
    expect(view.getByRole("button", { name: /Restoring/ })).toBeTruthy();

    deliver(mergeResult(requestId, "recovered"));
    await waitFor(() => expect(getDraft("session").text).toBe("recovered\n\nlocal draft"));

    deliver(mergeResult(requestId, "recovered"));
    await tick();
    expect(getDraft("session").text).toBe("recovered\n\nlocal draft");
    expect(view.container.querySelectorAll(".recovery-notice")).toHaveLength(1);
  });

  it.each([false, true])("leaves a Host-applied draft untouched and reports partial images truthfully (%s)", async (imagesDropped) => {
    presentationStore.set(presentation("panel", session()));
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });

    await fireEvent.click(view.getByRole("button", { name: /Restore all/ }));
    const { requestId } = restoreRequest();

    deliver({ type: "draftReplacement", sessionId: "session", draft: { revision: 4, text: "host merged", images: [] } });
    await tick();
    deliver({
      type: "restoreQueuedPromptsResult", requestId, sessionId: "session", ok: true, draftTarget: "host-applied",
      outcome: { certainty: "confirmed", recoveredCount: 1, notRemovedCount: 0, warnings: imagesDropped ? ["images-dropped"] : [] },
    });

    await waitFor(() => expect(view.container.textContent).toContain(imagesDropped
      ? "Removed 1 pending message. Image recovery was incomplete. Nothing was sent."
      : "Restored 1 pending message into the Composer. Nothing was sent."));
    expect(getDraft("session").text).toBe("host merged");
    expect(view.container.querySelectorAll(".recovery-notice")).toHaveLength(1);
    expect(postMessage.mock.calls.map(([message]) => message.type)).not.toContain("sendPrompt");
  });

  it("keeps the latest draft attachments when returned images no longer fit", async () => {
    presentationStore.set(presentation("sidebar", session("session", { maxImages: 4 })));
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });

    await fireEvent.click(view.getByRole("button", { name: /Restore all/ }));
    const { requestId } = restoreRequest();

    // Images added while waiting consume the capacity the request was sized against.
    setDraft("session", "webview", { text: "kept", images: ["d1", "d2", "d3", "d4"].map(draftImage) });
    deliver({
      type: "restoreQueuedPromptsResult", requestId, sessionId: "session", ok: true, draftTarget: "webview-merge",
      outcome: {
        certainty: "best-effort",
        content: { text: "recovered text", images: [recoveredImage] },
        recoveredCount: 1, notRemovedCount: 0, warnings: [],
      },
    });

    await waitFor(() => expect(getDraft("session").text).toBe("recovered text\n\nkept"));
    expect(getDraft("session").images.map(({ id }) => id)).toEqual(["d1", "d2", "d3", "d4"]);
    expect(view.container.textContent).toContain("Images could not be restored");
  });

  it("keeps restoring the originating Session draft while another Session is displayed", async () => {
    presentationStore.set(presentation("sidebar", session()));
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });

    await fireEvent.click(view.getByRole("button", { name: /Restore all/ }));
    const { requestId } = restoreRequest();

    presentationStore.update((current) => ({
      ...current,
      sessions: [...current.sessions, summary("other-session")],
      activeSessionId: "other-session",
      displayedSession: session("other-session", { queued: [] }),
    }));
    await tick();

    deliver(mergeResult(requestId, "recovered for origin"));
    await waitFor(() => expect(getDraft("session").text).toBe("recovered for origin"));
    expect(getDraft("other-session").text).toBe("");
    expect(view.container.textContent).not.toContain("Returned text from");
  });

  it("does not claim pending input survived an unconfirmed recovery", async () => {
    presentationStore.set(presentation("sidebar", session()));
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });

    await fireEvent.click(view.getByRole("button", { name: /Restore all/ }));
    const { requestId } = restoreRequest();
    deliver({ type: "restoreQueuedPromptsResult", requestId, sessionId: "session", ok: false, error: "The runtime did not confirm queue recovery." });

    await waitFor(() => expect(view.container.textContent).toContain("Could not confirm recovery."));
    expect(view.container.textContent).toContain("The runtime did not confirm queue recovery.");
    expect(view.container.textContent).not.toContain("were not restored");
    // The request is answered, so the pending group is actionable again.
    expect(restoreButton(view.container).disabled).toBe(false);
  });

  it("reports a confirmed removal without claiming its missing images were inserted", async () => {
    presentationStore.set(presentation("sidebar", session()));
    setDraft("session", "webview", { text: "latest draft", images: [] });
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });

    await fireEvent.click(view.getByRole("button", { name: /Restore all/ }));
    const { requestId } = restoreRequest();
    deliver({
      type: "restoreQueuedPromptsResult", requestId, sessionId: "session", ok: true, draftTarget: "webview-merge",
      outcome: {
        certainty: "confirmed", content: { text: "", images: [] },
        recoveredCount: 1, notRemovedCount: 1, warnings: ["images-dropped", "not-removed"],
      },
    });

    await waitFor(() => expect(view.container.textContent).toContain("Removed 1 pending message; nothing usable could be inserted into the Composer."));
    expect(view.container.textContent).toContain("Images could not be restored");
    expect(view.container.textContent).toContain("Removal was not confirmed for 1 pending message; delivery is unknown.");
    expect(view.container.textContent).not.toContain("Restored 1 pending message");
    expect(getDraft("session").text).toBe("latest draft");
  });
});

function restoreButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector(".pending-restore");
  if (!(button instanceof HTMLButtonElement)) throw new Error("Expected the pending group Restore all button");
  return button;
}

interface BlockedRecoveryCase {
  label: string;
  recovery: QueuedPromptRecoveryView;
  queued: QueuedPromptView[];
  maxImages: number;
  draftImages: DraftImage[];
  reason: string;
}

describe("pending message recovery availability", () => {
  it.each<BlockedRecoveryCase>([
    {
      label: "compaction",
      recovery: { state: "unavailable", reason: "compacting" },
      queued: [queuedPrompt("steer", "pending")],
      maxImages: 4,
      draftImages: [],
      reason: "Wait for compaction to finish",
    },
    {
      label: "runtime images",
      recovery: { state: "unavailable", reason: "images-not-supported" },
      queued: [queuedPrompt("steer", "pending", [queuedImage])],
      maxImages: 4,
      draftImages: [],
      reason: "Images in pending messages cannot be restored",
    },
    {
      label: "attachment limit",
      recovery: { state: "ready" },
      queued: [queuedPrompt("steer", "pending", [queuedImage, queuedImage])],
      maxImages: 4,
      draftImages: [draftImage("draft-image-1"), draftImage("draft-image-2"), draftImage("draft-image-3")],
      reason: "exceed the attachment limit",
    },
  ])("disables Restore all with a reason for $label", async ({ recovery, queued, maxImages, draftImages, reason }) => {
    presentationStore.set(presentation("sidebar", session("session", { queued, recovery, maxImages })));
    setDraft("session", "webview", { text: "draft", images: draftImages });
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });

    const button = restoreButton(view.container);
    expect(button.disabled).toBe(true);
    expect(view.container.textContent).toContain(reason);
    await fireEvent.click(button);
    expect(restoreRequests()).toHaveLength(0);
  });

  it("keeps Restore all available when pending and draft images fit the attachment limit", () => {
    presentationStore.set(presentation("sidebar", session("session", {
      queued: [queuedPrompt("steer", "pending", [queuedImage])],
      maxImages: 4,
    })));
    setDraft("session", "webview", { text: "draft", images: [draftImage("draft-image")] });
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });
    expect(restoreButton(view.container).disabled).toBe(false);
    expect(view.container.textContent).not.toContain("attachment limit");
  });

  it("shows the Host-recovering state as busy without a disabled reason", () => {
    presentationStore.set(presentation("sidebar", session("session", { recovery: { state: "recovering" } })));
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });
    const button = restoreButton(view.container);
    expect(button.textContent).toContain("Restoring…");
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(view.container.querySelector(".pending-reason")).toBeNull();
  });

  it("blocks Restore all while an accepted submission is still unresolved", async () => {
    presentationStore.set(presentation("sidebar", { ...session(), status: "ready", isStreaming: false }));
    setDraft("session", "webview", { text: "send me", images: [] });
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });

    await fireEvent.click(view.getByRole("button", { name: "Send to Pi" }));
    const submission = postMessage.mock.calls.map(([message]) => message).find((message) => message.type === "sendPrompt");
    if (submission?.type !== "sendPrompt") throw new Error("Expected a synthetic prompt submission");

    await waitFor(() => expect(view.container.textContent).toContain("Wait for the pending send to finish before restoring."));
    const button = restoreButton(view.container);
    expect(button.disabled).toBe(true);
    await fireEvent.click(button);
    expect(restoreRequests()).toHaveLength(0);

    deliver({ type: "promptResult", requestId: submission.requestId, ok: true });
    await waitFor(() => expect(restoreButton(view.container).disabled).toBe(false));
  });

  it("does not let another Session's pending submission block this Session's restore", async () => {
    presentationStore.set(presentation("sidebar", { ...session(), status: "ready", isStreaming: false }));
    setDraft("session", "webview", { text: "send me", images: [] });
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });

    await fireEvent.click(view.getByRole("button", { name: "Send to Pi" }));
    await waitFor(() => expect(view.container.textContent).toContain("Wait for the pending send to finish before restoring."));

    presentationStore.update((current) => ({
      ...current,
      sessions: [...current.sessions, summary("other-session")],
      activeSessionId: "other-session",
      displayedSession: session("other-session"),
    }));
    await tick();

    expect(view.container.textContent).not.toContain("Wait for the pending send to finish before restoring.");
    expect(restoreButton(view.container).disabled).toBe(false);
  });

  it("drops a paste whose image files finish loading after recovery started", async () => {
    presentationStore.set(presentation("sidebar", session()));
    setDraft("session", "webview", { text: "start", images: [] });
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });

    // The paste handler reaches FileReader before the recovery request is registered.
    void fireEvent.paste(view.container.querySelector(".cm-content")!, {
      clipboardData: { files: [new File(["synthetic"], "pasted.png", { type: "image/png" })] },
    });
    await fireEvent.click(view.getByRole("button", { name: /Restore all/ }));
    expect(restoreRequests()).toHaveLength(1);

    await waitFor(() => expect(get(toastStore).at(-1)?.message).toBe(
      "Wait for pending message recovery to finish before adding images.",
    ));
    expect(getDraft("session").images).toEqual([]);
    expect(getDraft("session").text).toBe("start");
  });
});
