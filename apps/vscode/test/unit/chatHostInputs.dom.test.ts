import { EditorView } from "@codemirror/view";
import { currentCompletions, startCompletion } from "@codemirror/autocomplete";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionViewModel } from "$shared/model/sessionViewModel";
import type { WebviewToHostPayload } from "$shared/bridge/webviewToHost";
import Composer from "$ui/features/composer/Composer.svelte";
import { composerDrafts, getDraft, type DraftImage } from "$ui/features/composer/composerDraftStore.svelte";
import { setDraft } from "$ui/features/composer/composerDraftSync";
import { promptSubmissionResult } from "$ui/features/composer/promptSubmissionStore.svelte";
import type { LocalComposerCommands } from "$ui/features/composer/frostPiCommands";
import { EMPTY_PRESENTATION, presentationStore, toastStore } from "$ui/state/sessionViewStore.svelte";
import { createVsCodeComposerCommands } from "../../src/webview/shell/vscodeComposerCommands";
import SessionMetrics from "$ui/shell/SessionMetrics.svelte";
import type { ProviderUsageSource } from "$ui/features/provider-usage/providerUsageSource";
import type { ProviderUsageResult } from "@frostime/provider-usage";

const bridge = vi.hoisted(() => ({ post: vi.fn<(message: WebviewToHostPayload) => void>() }));
vi.mock("$ui/bridge/hostBridge", () => ({ postToHost: bridge.post }));

function session(id = "session", provider = "example"): SessionViewModel {
  return {
    id, title: "Synthetic session", cwd: "/synthetic", status: "ready", isEphemeral: false,
    isStreaming: false, isCompacting: false, isForking: false, historyStatus: "loaded",
    model: { id: "model", provider, supportsImages: true }, thinkingLevel: "off",
    availableModels: [], scopedModelIds: [], commands: [], attachmentLimits: { maxImages: 4, maxImageBytes: 1_000 },
    collapseTurnTrace: false, composerStreamingBehavior: "steer",
    networkProxy: { mode: "direct", label: "Direct", restartRequired: false },
    questionTool: { configuredEnabled: false, appliedEnabled: false, restartRequired: false },
    conversationItems: [], queuedSteers: [], queuedFollowUps: [], pendingExtensionUi: [], extensionStatuses: [], extensionWidgets: [],
    sessionTreeAvailable: false, isNavigatingTree: false, isSummarizingTree: false, conversationContentRevision: 0,
    stats: {
      userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0, totalMessages: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0,
    },
  };
}

const image: DraftImage = { id: "image", name: "synthetic.png", mimeType: "image/png", data: "AA==", dataUrl: "data:image/png;base64,AA==", size: 1 };

function composer(panel = false, localCommands = createVsCodeComposerCommands()) {
  return render(Composer, {
    session: session(), localCommands, draftAuthority: panel ? "host" : "webview", restoreFailedSubmissionLocally: !panel,
  });
}

function lastSubmission(): { requestId: string; text: string; images: unknown[] } {
  const message = bridge.post.mock.calls.map(([value]) => value).reverse().find((value) => value.type === "sendPrompt");
  if (message?.type !== "sendPrompt") throw new Error("Expected a synthetic prompt submission");
  return message;
}

beforeEach(() => {
  composerDrafts.set({});
  promptSubmissionResult.set(null);
  toastStore.set([]);
  presentationStore.set(EMPTY_PRESENTATION);
  bridge.post.mockReset();
});
afterEach(() => cleanup());

describe("explicit Composer host inputs", () => {
  it("applies a supplied local command result before its action without guessing the command name", async () => {
    setDraft("session", "webview", { text: "/custom", images: [image] });
    const observed: string[] = [];
    const localCommands: LocalComposerCommands = {
      completions: (commands) => commands,
      handle: ({ text }) => text === "/custom"
        ? { draft: { text: "replacement" }, execute: () => observed.push(getDraft("session").text) }
        : undefined,
    };
    const view = composer(false, localCommands);
    await fireEvent.click(view.getByRole("button", { name: "Send to Pi" }));
    expect(observed).toEqual(["replacement"]);
    expect(getDraft("session").images).toEqual([image]);
    expect(bridge.post).not.toHaveBeenCalled();
  });

  it("clears sidebar resume before opening it and keeps panel rejection local", async () => {
    setDraft("session", "webview", { text: " /resume ", images: [] });
    const draftsAtResume: string[] = [];
    bridge.post.mockImplementation((message) => {
      if (message.type === "resumeSession") draftsAtResume.push(getDraft("session").text);
    });
    const sidebar = composer(false, createVsCodeComposerCommands({ allowResume: () => true }));
    await fireEvent.click(sidebar.getByRole("button", { name: "Send to Pi" }));
    expect(draftsAtResume).toEqual([""]);
    expect(bridge.post).toHaveBeenCalledWith({ type: "resumeSession" });
    sidebar.unmount();
    bridge.post.mockClear();
    setDraft("session", "webview", { text: "/resume", images: [] });
    const panel = composer(true, createVsCodeComposerCommands({ allowResume: () => false }));
    await fireEvent.click(panel.getByRole("button", { name: "Send to Pi" }));
    expect(getDraft("session").text).toBe("/resume");
    expect(get(toastStore).at(-1)?.message).toBe("Open the FrostPi sidebar to resume a session.");
    expect(bridge.post).not.toHaveBeenCalled();
  });

  it.each([true, false])("keeps VS Code command ownership and ordering with resume allowed: %s", (allowResume) => {
    const commands = createVsCodeComposerCommands({ allowResume: () => allowResume }).completions([
      { name: "compact", source: "extension" },
      { name: "editor", source: "extension" },
      { name: "resume", source: "extension" },
      { name: "inspect", source: "prompt" },
    ]);
    expect(commands.map(({ name, source }) => ({ name, source }))).toEqual([
      { name: "compact", source: "frostpi" },
      { name: "editor", source: "frostpi" },
      ...(allowResume ? [{ name: "resume", source: "frostpi" }] : []),
      { name: "inspect", source: "prompt" },
    ]);
  });

  it.each([false, true])("keeps the actual editor completion list selected by its product adapter (panel=%s)", async (panel) => {
    setDraft("session", "webview", { text: "/", images: [] });
    const view = composer(panel, createVsCodeComposerCommands({ allowResume: () => !panel }));
    const editor = EditorView.findFromDOM(view.container.querySelector(".cm-editor")!)!;
    editor.dispatch({ selection: { anchor: 1 } });
    startCompletion(editor);
    await waitFor(() => expect(currentCompletions(editor.state).map((item) => item.label))
      .toEqual(panel ? ["/compact", "/editor"] : ["/compact", "/editor", "/resume"]));
  });

  it("derives panel resume rejection from the presentation surface without test overrides", () => {
    presentationStore.set({ ...EMPTY_PRESENTATION, surface: { kind: "panel", sessionId: "session" } });
    const commands = createVsCodeComposerCommands();
    const handled = commands.handle({ sessionId: "session", text: "/resume", hasImages: false });
    expect(handled?.draft).toEqual("keep");
    handled?.execute();
    expect(get(toastStore).at(-1)?.message).toBe("Open the FrostPi sidebar to resume a session.");
    expect(bridge.post).not.toHaveBeenCalled();
  });

  it.each([false, true])("replaces editor text before dispatch and retains images in panel: %s; image resume stays a prompt", async (panel) => {
    setDraft("session", "webview", { text: "/editor\u2003replacement", images: [image] });
    let draftAtOpen: unknown;
    bridge.post.mockImplementation((message) => {
      if (message.type === "openComposerEditor") draftAtOpen = getDraft("session");
    });
    const view = composer(panel);
    await fireEvent.click(view.getByRole("button", { name: "Send to Pi" }));
    expect(draftAtOpen).toMatchObject({ text: "replacement", images: [image] });
    expect(bridge.post.mock.calls.map(([message]) => message.type)).toEqual(
      panel ? ["updateComposerDraft", "openComposerEditor"] : ["openComposerEditor"],
    );
    expect(bridge.post).toHaveBeenLastCalledWith({ type: "openComposerEditor", sessionId: "session", text: "replacement" });
    setDraft("session", "webview", { text: "/resume", images: [image] });
    await tick();
    await fireEvent.click(view.getByRole("button", { name: "Send to Pi" }));
    expect(lastSubmission()).toMatchObject({ text: "/resume", images: [{ id: "image", data: "AA==" }] });
    expect(getDraft("session")).toMatchObject({ text: "", images: [] });
  });

  it("restores only correlated local failures and does not overwrite newer edits, even an empty edit", async () => {
    setDraft("session", "webview", { text: "submitted", images: [image] });
    const view = composer();
    await fireEvent.click(view.getByRole("button", { name: "Send to Pi" }));
    const first = lastSubmission();
    promptSubmissionResult.set({ requestId: "unrelated", ok: false });
    await tick();
    expect(getDraft("session")).toMatchObject({ text: "", images: [] });
    promptSubmissionResult.set({ requestId: first.requestId, ok: false });
    await tick();
    expect(getDraft("session")).toMatchObject({ text: "submitted", images: [image] });
    await fireEvent.click(view.getByRole("button", { name: "Send to Pi" }));
    const second = lastSubmission();
    const editor = EditorView.findFromDOM(view.container.querySelector(".cm-editor")!)!;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "newer" } });
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "" } });
    promptSubmissionResult.set({ requestId: second.requestId, ok: false });
    await tick();
    expect(getDraft("session")).toMatchObject({ text: "", images: [] });
  });

  it("leaves host-owned failure recovery to the host and never clears later text on success", async () => {
    setDraft("session", "webview", { text: "host draft", images: [] });
    const view = composer(true);
    await fireEvent.click(view.getByRole("button", { name: "Send to Pi" }));
    promptSubmissionResult.set({ requestId: lastSubmission().requestId, ok: false });
    await tick();
    expect(getDraft("session").text).toBe("");
    setDraft("session", "webview", { text: "retry", images: [] });
    await tick();
    await fireEvent.click(view.getByRole("button", { name: "Send to Pi" }));
    setDraft("session", "webview", { text: "later host replacement", images: [image] });
    promptSubmissionResult.set({ requestId: lastSubmission().requestId, ok: true });
    await tick();
    expect(getDraft("session")).toMatchObject({ text: "later host replacement", images: [image] });
  });
});

function snapshot(providerId: string): ProviderUsageResult {
  return {
    providerId, source: "auth.json", status: "ready", report: {
      providerId, providerName: providerId, capturedAt: 1_700_000_000_000, source: "synthetic",
      semantics: { kind: "api-key", label: "Synthetic" }, buckets: [], notes: [],
      metrics: [{ id: "balance", label: "Balance", value: `snapshot-${providerId}` }],
    },
  };
}

describe("metrics source injection", () => {
  it("retains provider-keyed snapshots across close, session/model changes, but not a new metrics mount", async () => {
    const queryUsage = vi.fn<ProviderUsageSource["queryUsage"]>((scope) => Promise.resolve([snapshot(scope)]));
    const providerUsageSource: ProviderUsageSource = {
      listProviders: () => Promise.resolve(["example", "other"].map((providerId) => ({
        providerId, displayName: providerId, availability: "ready", source: "auth.json", reason: "",
      }))),
      queryUsage,
    };
    const view = render(SessionMetrics, { session: session(), providerUsageSource });
    await fireEvent.click(view.getByRole("button", { name: "Provider usage" }));
    await waitFor(() => expect(view.queryByText("snapshot-example")).not.toBeNull());
    await fireEvent.click(view.getByRole("button", { name: "Close provider usage" }));
    await view.rerender({ session: session("second"), providerUsageSource });
    await fireEvent.click(view.getByRole("button", { name: "Provider usage" }));
    await waitFor(() => expect(view.queryByText("snapshot-example")).not.toBeNull());
    expect(queryUsage).toHaveBeenCalledTimes(1);
    await view.rerender({ session: session("second", "other"), providerUsageSource });
    await waitFor(() => expect(view.queryByText("snapshot-other")).not.toBeNull());
    await view.rerender({ session: session("third"), providerUsageSource });
    await waitFor(() => expect(view.queryByText("snapshot-example")).not.toBeNull());
    expect(queryUsage).toHaveBeenCalledTimes(2);
    view.unmount();
    const remounted = render(SessionMetrics, { session: session(), providerUsageSource });
    await fireEvent.click(remounted.getByRole("button", { name: "Provider usage" }));
    await waitFor(() => expect(remounted.queryByText("snapshot-example")).not.toBeNull());
    expect(queryUsage).toHaveBeenCalledTimes(3);
  });

  it("omits Usage without a source and cancels pending work when the injected view closes", async () => {
    const restricted = render(SessionMetrics, { session: session() });
    expect(restricted.queryByRole("button", { name: "Provider usage" })).toBeNull();
    restricted.unmount();
    let signal: AbortSignal | undefined;
    const providerUsageSource: ProviderUsageSource = {
      listProviders: () => Promise.resolve([{ providerId: "example", displayName: "Example", availability: "ready", source: "auth.json", reason: "" }]),
      queryUsage: (_scope, nextSignal) => { signal = nextSignal; return new Promise(() => {}); },
    };
    const view = render(SessionMetrics, { session: session(), providerUsageSource });
    await fireEvent.click(view.getByRole("button", { name: "Provider usage" }));
    await waitFor(() => expect(signal).toBeDefined());
    await fireEvent.click(view.getByRole("button", { name: "Close provider usage" }));
    expect(signal?.aborted).toBe(true);
  });
});
