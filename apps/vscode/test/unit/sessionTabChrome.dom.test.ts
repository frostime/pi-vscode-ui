import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionSummaryView, SessionViewModel } from "$shared/model/sessionViewModel";
import { VSCODE_CLIENT_UI_CAPABILITIES } from "$shared/model/clientUiCapabilities";
import { connectHostBridge } from "$ui/bridge/hostBridge";
import PanelSessionHeader from "$ui/features/sessions/PanelSessionHeader.svelte";
import SessionHeader from "$ui/features/sessions/SessionHeader.svelte";
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

  it("opens a new Session, saved or temporary, in an editor tab from the tab itself", async () => {
    const view = render(PanelSessionHeader, { session: session() });
    await fireEvent.click(view.getByRole("button", { name: "New session in editor tab" }));
    await fireEvent.click(view.getByRole("button", { name: "New temporary session in editor tab" }));
    expect(posted()).toEqual([{ type: "createSessionPanel" }, { type: "createSessionPanel", ephemeral: true }]);
  });
});

describe("sidebar launcher", () => {
  const summary: SessionSummaryView = {
    id: "session", title: "Parser work", cwd: "/workspace", status: "ready", isActive: true, isEphemeral: false,
    historyStatus: "loaded", requiresUserInput: false,
  };

  it("renames the sidebar's Session from its rename button or a double-click on the title", async () => {
    const summary = { id: "session", title: "Parser work", cwd: "/workspace", status: "running", isEphemeral: false } as SessionSummaryView;
    const view = render(SessionHeader, { sessions: [summary], active: session() });

    await fireEvent.click(view.getByRole("button", { name: "Rename session" }));
    let input = view.getByRole("textbox", { name: "Session name" });
    await fireEvent.input(input, { target: { value: "Tokenizer" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    await fireEvent.blur(input);

    await fireEvent.dblClick(view.getByText("Parser work"));
    input = view.getByRole("textbox", { name: "Session name" });
    await fireEvent.input(input, { target: { value: "Discarded" } });
    await fireEvent.keyDown(input, { key: "Escape" });
    await fireEvent.blur(input);

    expect(posted()).toEqual([{ type: "renameSession", sessionId: "session", name: "Tokenizer" }]);
  });

  it("lists every way to start in one flat menu, each new-session entry with its temporary variant beside it", async () => {
    const view = render(SessionHeader, { sessions: [summary], active: session({ status: "ready", isStreaming: false }) });
    const open = (): Promise<boolean> => fireEvent.click(view.getByRole("button", { name: "New or resume session" }));

    await open();
    const menu = view.container.querySelector(".session-launcher-menu")!;
    expect([...menu.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? button.querySelector("strong")?.textContent)).toEqual([
      "New session", "New temporary session",
      "New session in editor tab", "New temporary session in editor tab",
      "New session with arguments…", "Resume session",
    ]);
    expect(view.queryByRole("button", { name: "More ways to start a session" })).toBeNull();

    for (const name of ["New session", "New temporary session", "New session in editor tab", "New temporary session in editor tab"]) {
      await fireEvent.click(view.getByRole("button", { name: name === "New session" || name === "New session in editor tab" ? new RegExp(`^${name} Start`) : name }));
      if (name !== "New temporary session in editor tab") await open();
    }
    expect(posted()).toEqual([
      { type: "createSession" },
      { type: "createSession", ephemeral: true },
      { type: "createSessionPanel" },
      { type: "createSessionPanel", ephemeral: true },
    ]);
  });

  it("leaves out the editor tab entries on a host without editor tabs", async () => {
    clientCapabilities.set({ ...VSCODE_CLIENT_UI_CAPABILITIES, sessionEditorTabs: false });
    const view = render(SessionHeader, { sessions: [summary], active: session({ status: "ready", isStreaming: false }) });
    await fireEvent.click(view.getByRole("button", { name: "New or resume session" }));
    expect(view.queryByRole("button", { name: /in editor tab/ })).toBeNull();
    expect(view.getByRole("button", { name: "New temporary session" })).toBeTruthy();
    expect(view.getByRole("button", { name: /New session with arguments/ })).toBeTruthy();
  });
});
