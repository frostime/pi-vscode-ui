import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionSummaryView, SessionViewModel, SideQuestionView } from "$shared/model/sessionViewModel";
import { VSCODE_CLIENT_UI_CAPABILITIES } from "$shared/model/clientUiCapabilities";
import { connectHostBridge } from "$ui/bridge/hostBridge";
import PanelSessionHeader from "$ui/features/sessions/PanelSessionHeader.svelte";
import SessionHeader from "$ui/features/sessions/SessionHeader.svelte";
import SideQuestionCard from "$ui/features/side-question/SideQuestionCard.svelte";
import { clientCapabilities } from "$ui/state/clientCapabilities.svelte";

const postMessage = vi.fn();
let disconnectHost: () => void;

beforeEach(() => {
  postMessage.mockClear();
  disconnectHost = connectHostBridge({ postMessage, onMessage: () => () => undefined });
});

afterEach(() => {
  cleanup();
  disconnectHost();
  clientCapabilities.set(VSCODE_CLIENT_UI_CAPABILITIES);
});

function session(overrides: Partial<SessionViewModel> = {}): SessionViewModel {
  return {
    id: "session", title: "Parser work", cwd: "/workspace", status: "running", isEphemeral: false,
    isStreaming: true, isCompacting: false, isForking: false, historyStatus: "loaded",
    model: null, thinkingLevel: "off", availableModels: [], scopedModelIds: [], commands: [],
    attachmentLimits: { maxImageBytes: 1, maxImages: 1 }, collapseTurnTrace: true, focusView: true,
    composerStreamingBehavior: "steer", networkProxy: { mode: "inherit", label: "Inherited", restartRequired: false },
    questionTool: { configuredEnabled: false, appliedEnabled: false, restartRequired: false },
    conversationItems: [], queuedSteers: [], queuedFollowUps: [], queuedPromptRecovery: { state: "unavailable" } as never,
    pendingExtensionUi: [], extensionStatuses: [], extensionWidgets: [], sessionTreeAvailable: true,
    isNavigatingTree: false, isSummarizingTree: false, conversationContentRevision: 0,
    ...overrides,
  };
}

function posted(): unknown[] {
  return postMessage.mock.calls.map(([message]) => Object.fromEntries(
    Object.entries(message as Record<string, unknown>).filter(([key]) => key !== "bridgeVersion"),
  ));
}

describe("Session Tab header", () => {
  it("renames the pinned Session while its turn is running", async () => {
    const view = render(PanelSessionHeader, { session: session() });
    expect(view.container.textContent).toContain("· running");

    await fireEvent.click(view.getByRole("button", { name: "Rename session Parser work" }));
    const input = view.getByRole("textbox", { name: "Session name" });
    expect((input as HTMLInputElement).value).toBe("Parser work");
    await fireEvent.input(input, { target: { value: "  Tokenizer rewrite  " } });
    await fireEvent.keyDown(input, { key: "Enter" });
    // Enter removes the input; the blur that follows must not send the rename again.
    await fireEvent.blur(input);

    expect(posted()).toEqual([{ type: "renameSession", sessionId: "session", name: "Tokenizer rewrite" }]);
    expect(view.queryByRole("textbox")).toBeNull();
  });

  it("commits on blur and sends nothing for Escape, an empty name or an unchanged name", async () => {
    const view = render(PanelSessionHeader, { session: session() });
    const edit = async (value: string, finish: (input: HTMLElement) => Promise<unknown>): Promise<void> => {
      await fireEvent.click(view.getByRole("button", { name: "Rename session Parser work" }));
      const input = view.getByRole("textbox", { name: "Session name" });
      await fireEvent.input(input, { target: { value } });
      await finish(input);
    };

    await edit("Discarded", (input) => fireEvent.keyDown(input, { key: "Escape" }));
    await edit("   ", (input) => fireEvent.keyDown(input, { key: "Enter" }));
    await edit("Parser work", (input) => fireEvent.blur(input));
    expect(posted()).toEqual([]);

    await edit("By blur", (input) => fireEvent.blur(input));
    expect(posted()).toEqual([{ type: "renameSession", sessionId: "session", name: "By blur" }]);
  });

  it("opens a new Session in an editor tab from the tab itself", async () => {
    const view = render(PanelSessionHeader, { session: session() });
    await fireEvent.click(view.getByRole("button", { name: "New session in editor tab" }));
    expect(posted()).toEqual([{ type: "createSessionPanel" }]);
  });
});

describe("sidebar launcher", () => {
  const summary: SessionSummaryView = {
    id: "session", title: "Parser work", cwd: "/workspace", status: "ready", isActive: true, isEphemeral: false,
    historyStatus: "loaded", requiresUserInput: false,
  };

  it("offers a new Session in an editor tab only on a host with editor tabs", async () => {
    const view = render(SessionHeader, { sessions: [summary], active: session({ status: "ready", isStreaming: false }) });
    await fireEvent.click(view.getByRole("button", { name: "New or resume session" }));
    await fireEvent.click(view.getByRole("button", { name: "More ways to start a session" }));
    await fireEvent.click(view.getByRole("button", { name: /New session in editor tab/ }));
    expect(posted()).toEqual([{ type: "createSessionPanel" }]);
    cleanup();

    clientCapabilities.set({ ...VSCODE_CLIENT_UI_CAPABILITIES, sessionEditorTabs: false });
    const withoutTabs = render(SessionHeader, { sessions: [summary], active: session({ status: "ready", isStreaming: false }) });
    await fireEvent.click(withoutTabs.getByRole("button", { name: "New or resume session" }));
    await fireEvent.click(withoutTabs.getByRole("button", { name: "More ways to start a session" }));
    expect(withoutTabs.queryByRole("button", { name: /New session in editor tab/ })).toBeNull();
    expect(withoutTabs.getByRole("button", { name: /New temporary session/ })).toBeTruthy();
  });
});

describe("side-question card", () => {
  const base: SideQuestionView = { id: "side-question-3", question: "Which file has the parser?", status: "pending", askedAt: 0 };

  it("shows the pending question and dismisses it by id", async () => {
    const view = render(SideQuestionCard, { sessionId: "session", question: base });
    expect(view.getByRole("status").textContent).toContain("Answering");
    expect(view.container.textContent).toContain("Which file has the parser?");
    expect(view.container.textContent).toContain("not added to the conversation");
    expect(view.queryByRole("button", { name: "Copy answer" })).toBeNull();

    await fireEvent.click(view.getByRole("button", { name: "Dismiss side question" }));
    expect(posted()).toEqual([{ type: "dismissSideQuestion", sessionId: "session", questionId: "side-question-3" }]);
  });

  it("renders the answer as sanitized Markdown with its source and token use", async () => {
    const view = render(SideQuestionCard, {
      sessionId: "session",
      question: {
        ...base, status: "answered", truncated: true, model: "anthropic/claude",
        answer: "It is in `parser.ts`.\n\n<img src=x onerror=alert(1)>",
        usage: { input: 320, output: 1_250, cacheRead: 41_000 },
      },
    });

    expect(view.container.querySelector(".side-question-answer code")?.textContent).toBe("parser.ts");
    expect(view.container.querySelector(".side-question-answer img")).toBeNull();
    expect(view.container.querySelector("[onerror]")).toBeNull();
    expect(view.container.textContent).toContain("anthropic/claude · 41.3k in (41.0k cached) · 1.3k out");
    expect(view.container.textContent).toContain("The answer was cut at the length limit.");

    await fireEvent.click(view.getByRole("button", { name: "Copy answer" }));
    expect(posted()).toEqual([{ type: "copyText", text: "It is in `parser.ts`.\n\n<img src=x onerror=alert(1)>" }]);
  });

  it("says when the answer may be partial, and why", () => {
    const answered = { ...base, status: "answered" as const, answer: "Let me check." };
    const toolCall = render(SideQuestionCard, { sessionId: "session", question: { ...answered, incomplete: "tool-call" } });
    expect(toolCall.getByRole("note").textContent).toContain("tried to use a tool");
    cleanup();

    const cutOff = render(SideQuestionCard, { sessionId: "session", question: { ...answered, incomplete: "length" } });
    expect(cutOff.getByRole("note").textContent).toContain("reached its output limit");
    cleanup();

    expect(render(SideQuestionCard, { sessionId: "session", question: answered }).queryByRole("note")).toBeNull();
  });

  it("reports a failure in place", () => {
    const view = render(SideQuestionCard, { sessionId: "session", question: { ...base, status: "failed", error: "429 rate limited" } });
    expect(view.getByRole("alert").textContent).toBe("429 rate limited");
    expect(view.queryByRole("status")).toBeNull();
  });
});
