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
import { annotationReviewDrafts } from "$ui/features/annotation-review/annotationReviewStore.svelte";
import { connectHostBridge, onHostMessage } from "$ui/bridge/hostBridge";
import { composerDrafts, getDraft, type DraftImage } from "$ui/features/composer/composerDraftStore.svelte";
import { setDraft } from "$ui/features/composer/composerDraftSync";
import { queuedPromptRecoveryRequests } from "$ui/features/composer/queuedPromptRecoveryStore.svelte";
import { EMPTY_PRESENTATION, presentationStore, toastStore } from "$ui/state/sessionViewStore.svelte";

const postMessage = vi.fn<(message: WebviewToHostPayload) => void>();
let deliverHost: ((message: HostToWebviewMessage) => void) | undefined;
let disconnectHost: () => void;
let unsubscribeHostMessages: (() => void) | undefined;

beforeEach(() => {
  postMessage.mockClear();
  composerDrafts.set({});
  annotationReviewDrafts.set({});
  queuedPromptRecoveryRequests.set({});
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
    collapseTurnTrace: false, focusView: false, composerStreamingBehavior: "steer",
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
  it("sends one correlated restore request from the pending group", async () => {
    presentationStore.set(presentation("sidebar", session()));
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });

    await fireEvent.click(view.getByRole("button", { name: /Restore all/ }));
    expect(restoreRequest()).toMatchObject({ type: "restoreQueuedPrompts", sessionId: "session", draftImageCount: 0 });

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

    expect(postMessage.mock.calls.map(([message]) => message.type)).not.toContain("openSessionPanel");
  });
});

describe("pending message recovery results", () => {
  it("locks draft editing until the result is merged, then restores editing without submitting", async () => {
    presentationStore.set(presentation("sidebar", session()));
    setDraft("session", "webview", { text: "keep me", images: [draftImage("draft-image")] });
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });
    // The Composer owns focus on mount; the result must restore it after the click moves it away.
    await waitFor(() => expect(view.container.querySelector(".cm-editor")?.contains(document.activeElement)).toBe(true));

    await fireEvent.click(view.getByRole("button", { name: /Restore all/ }));
    const { requestId } = restoreRequest();

    const content = view.container.querySelector<HTMLElement>(".cm-content")!;
    expect(content.getAttribute("contenteditable")).toBe("false");
    const editor = EditorView.findFromDOM(view.container.querySelector(".cm-editor")!)!;
    // Read-only must block editing transactions too (undo/completion), not just DOM typing.
    editor.dispatch({ changes: { from: editor.state.doc.length, insert: " should not appear" } });
    await tick();
    expect(editor.state.doc.toString()).toBe("keep me");
    expect(getDraft("session").text).toBe("keep me");
    expect(view.getByRole("button", { name: "Remove draft-image.png" })).toHaveProperty("disabled", true);

    // Sending and attachments stay blocked until the recovered draft is displayed.
    expect(view.queryByRole("button", { name: /Send as/ })).toBeNull();
    await fireEvent.paste(view.container.querySelector(".cm-content")!, {
      clipboardData: { files: [new File(["synthetic"], "pasted.png", { type: "image/png" })] },
    });
    await tick();
    expect(getDraft("session").images.map(({ id }) => id)).toEqual(["draft-image"]);
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
      text: "first recovered\n\nsecond recovered\n\nkeep me",
      images: [{ id: "recovered-image" }, { id: "draft-image" }],
    }));
    expect(getDraft("session").images[0]?.dataUrl).toBe("data:image/png;base64,AA==");
    await waitFor(() => expect(view.container.querySelector(".cm-editor")?.contains(document.activeElement)).toBe(true));

    expect(postMessage.mock.calls.map(([message]) => message.type)).not.toContain("sendPrompt");
    // Editing and sending become available only after the result is merged.
    expect(content.getAttribute("contenteditable")).toBe("true");
    editor.dispatch({ changes: { from: editor.state.doc.length, insert: " after recovery" } });
    await waitFor(() => expect(getDraft("session").text).toBe("first recovered\n\nsecond recovered\n\nkeep me after recovery"));
    expect(view.getByRole("button", { name: "Send as Steer" })).toBeTruthy();
  });

  it("shows one result toast that expires automatically", async () => {
    presentationStore.set(presentation("sidebar", session()));
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });
    await fireEvent.click(view.getByRole("button", { name: /Restore all/ }));
    const { requestId } = restoreRequest();
    vi.useFakeTimers();
    try {
      deliver(mergeResult(requestId, "recovered"));
      await tick();
      expect(view.container.querySelectorAll(".toast")).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(5_000);
      await tick();
      expect(view.container.querySelector(".toast")).toBeNull();
      expect(getDraft("session").text).toBe("recovered");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps annotation insertion from editing a locked draft without discarding the review", async () => {
    presentationStore.set(presentation("sidebar", session()));
    setDraft("session", "webview", { text: "existing", images: [] });
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });
    await fireEvent.click(view.getByRole("button", { name: /Restore all/ }));
    const { requestId } = restoreRequest();
    annotationReviewDrafts.set({ session: {
      source: "Answer", annotations: [{ id: "note", start: 0, end: 6, comment: "Review this", createdOrder: 0 }],
      pending: null, activeAnnotationId: null, nextCreatedOrder: 1,
    } });
    await tick();
    await fireEvent.click(view.getByRole("button", { name: "Insert into Composer" }));
    expect(getDraft("session").text).toBe("existing");
    expect(get(annotationReviewDrafts).session?.annotations[0]?.comment).toBe("Review this");
    deliver(mergeResult(requestId, "recovered"));
    await tick();
    await fireEvent.click(view.getByRole("button", { name: "Insert into Composer" }));
    await waitFor(() => expect(getDraft("session").text).toContain("Review this"));
    expect(getDraft("session").text).toContain("recovered\n\nexisting");
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
    expect(view.container.querySelectorAll(".toast")).toHaveLength(0);
    // Replies that do not match the registered request leave it pending.
    expect(view.getByRole("button", { name: /Restoring/ })).toBeTruthy();

    deliver(mergeResult(requestId, "recovered"));
    await waitFor(() => expect(getDraft("session").text).toBe("recovered\n\nlocal draft"));

    deliver(mergeResult(requestId, "recovered"));
    await tick();
    expect(getDraft("session").text).toBe("recovered\n\nlocal draft");
    expect(view.container.querySelectorAll(".toast")).toHaveLength(1);
  });

  it("leaves a Host-applied draft untouched while the merge stays local", async () => {
    presentationStore.set(presentation("panel", session()));
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });

    await fireEvent.click(view.getByRole("button", { name: /Restore all/ }));
    const { requestId } = restoreRequest();

    // Runtime completion can precede delivery. The local request must keep the editor locked.
    deliver({ type: "snapshot", presentation: presentation("panel", session()), draft: null });
    await tick();
    const content = view.container.querySelector<HTMLElement>(".cm-content")!;
    expect(content.getAttribute("contenteditable")).toBe("false");
    deliver({ type: "draftReplacement", sessionId: "session", draft: { revision: 4, text: "host merged", images: [] } });
    await tick();
    expect(content.getAttribute("contenteditable")).toBe("false");
    deliver({
      type: "restoreQueuedPromptsResult", requestId, sessionId: "session", ok: true, draftTarget: "host-applied",
      outcome: { certainty: "confirmed", recoveredCount: 1, notRemovedCount: 0, warnings: ["images-dropped"] },
    });

    await waitFor(() => expect(content.getAttribute("contenteditable")).toBe("true"));
    expect(getDraft("session").text).toBe("host merged");
    expect(view.container.querySelectorAll(".toast-warning")).toHaveLength(1);
    expect(postMessage.mock.calls.map(([message]) => message.type)).not.toContain("sendPrompt");
  });

  it("preserves existing attachments when the backend returns more images than fit", async () => {
    presentationStore.set(presentation("sidebar", session("session", { maxImages: 4 })));
    setDraft("session", "webview", { text: "kept", images: ["d1", "d2", "d3"].map(draftImage) });
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });

    await fireEvent.click(view.getByRole("button", { name: /Restore all/ }));
    const { requestId } = restoreRequest();
    deliver({
      type: "restoreQueuedPromptsResult", requestId, sessionId: "session", ok: true, draftTarget: "webview-merge",
      outcome: {
        certainty: "best-effort",
        content: { text: "recovered text", images: [recoveredImage, { ...recoveredImage, id: "second-returned-image" }] },
        recoveredCount: 1, notRemovedCount: 0, warnings: [],
      },
    });

    await waitFor(() => expect(getDraft("session").text).toBe("recovered text\n\nkept"));
    expect(getDraft("session").images.map(({ id }) => id)).toEqual(["d1", "d2", "d3"]);
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
    expect(view.container.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("true");

    deliver(mergeResult(requestId, "recovered for origin"));
    await waitFor(() => expect(getDraft("session").text).toBe("recovered for origin"));
    expect(getDraft("other-session").text).toBe("");
    expect(view.container.querySelectorAll(".toast")).toHaveLength(1);
  });

  it("unlocks the Composer and recovery action after a failed result", async () => {
    presentationStore.set(presentation("sidebar", session()));
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });

    await fireEvent.click(view.getByRole("button", { name: /Restore all/ }));
    const { requestId } = restoreRequest();
    deliver({ type: "restoreQueuedPromptsResult", requestId, sessionId: "session", ok: false, error: "The runtime did not confirm queue recovery." });

    await waitFor(() => expect(restoreButton(view.container).disabled).toBe(false));
    // Failure must release both the input lock and the recovery action.
    expect(view.container.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("true");
  });
});

function restoreButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector(".pending-restore");
  if (!(button instanceof HTMLButtonElement)) throw new Error("Expected the pending group Restore all button");
  return button;
}

describe("pending message recovery availability", () => {
  it.each<[string, QueuedPromptRecoveryView, QueuedPromptView[], DraftImage[]]>([
    ["compaction", { state: "unavailable", reason: "compacting" }, [queuedPrompt("steer", "pending")], []],
    [
      "attachment limit",
      { state: "ready" },
      [queuedPrompt("steer", "pending", [queuedImage, queuedImage])],
      [draftImage("draft-image-1"), draftImage("draft-image-2"), draftImage("draft-image-3")],
    ],
  ])("disables Restore all with a reason while blocked by %s", async (_blocked, recovery, queued, draftImages) => {
    presentationStore.set(presentation("sidebar", session("session", { queued, recovery, maxImages: 4 })));
    setDraft("session", "webview", { text: "draft", images: draftImages });
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });

    const button = restoreButton(view.container);
    expect(button.disabled).toBe(true);
    expect(view.container.querySelector(".pending-reason")?.textContent?.trim()).toBeTruthy();
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

    await waitFor(() => expect(restoreButton(view.container).disabled).toBe(true));
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
    await waitFor(() => expect(restoreButton(view.container).disabled).toBe(true));

    presentationStore.update((current) => ({
      ...current,
      sessions: [...current.sessions, summary("other-session")],
      activeSessionId: "other-session",
      displayedSession: session("other-session"),
    }));
    await tick();

    expect(restoreButton(view.container).disabled).toBe(false);
  });

  it("drops a paste whose image files finish loading after recovery started", async () => {
    presentationStore.set(presentation("sidebar", session()));
    setDraft("session", "webview", { text: "start", images: [] });
    const view = render(ClientApp, { props: { localComposerCommands: stubCommands } });

    // eslint-disable-next-line @typescript-eslint/unbound-method -- Called below with the original reader via call().
    const nativeRead = FileReader.prototype.readAsDataURL;
    let finishReading: (() => Promise<void>) | undefined;
    const read = vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader, file: Blob) {
      finishReading = () => new Promise<void>((resolve) => {
        this.addEventListener("loadend", () => resolve(), { once: true });
        nativeRead.call(this, file);
      });
    });
    try {
      await fireEvent.paste(view.container.querySelector(".cm-content")!, {
        clipboardData: { files: [new File(["synthetic"], "pasted.png", { type: "image/png" })] },
      });
      if (!finishReading) throw new Error("Expected the paste to start reading an image");
      await fireEvent.click(view.getByRole("button", { name: /Restore all/ }));
      await finishReading();
      await tick();
      expect(getDraft("session").images).toEqual([]);
      expect(getDraft("session").text).toBe("start");
    } finally {
      read.mockRestore();
    }
  });
});
