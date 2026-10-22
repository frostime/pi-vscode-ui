import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostToWebviewMessage } from "$shared/bridge/hostToWebview";
import type { SessionSummaryView } from "$shared/model/sessionViewModel";

import { applyHostMessage } from "$ui/bridge/applyHostMessage";
import { connectHostBridge } from "$ui/bridge/hostBridge";
import ToolActivity from "$ui/features/conversation/ToolActivity.svelte";
import MarkdownHtml from "$ui/features/conversation/markdown/MarkdownHtml.svelte";
import type { ToolActivityView } from "$shared/model/conversationModel";
import { clientCapabilities } from "$ui/state/clientCapabilities.svelte";
import SessionHeader from "$ui/features/sessions/SessionHeader.svelte";
import SessionList from "$ui/features/sessions/SessionList.svelte";
import SidebarShell from "$ui/shell/SidebarShell.svelte";
import type { SessionViewModel } from "$shared/model/sessionViewModel";
import type { ProviderUsageSource } from "$ui/features/provider-usage/providerUsageSource";
import { composerDrafts } from "$ui/features/composer/composerDraftStore.svelte";
import { toastStore } from "$ui/state/sessionViewStore.svelte";
import { VSCODE_CLIENT_UI_CAPABILITIES } from "$shared/model/clientUiCapabilities";
import type * as FileSuggestionClient from "$ui/features/composer/fileSuggestionClient";

const noCapabilities = {
  sessionEditorTabs: false,
  editorMentionSpecials: false,
  openReferencedLocation: false,
  exportDiagnostics: false,
};

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

const deliverSuggestions = vi.fn();
vi.mock("$ui/features/composer/fileSuggestionClient", async (importOriginal) => ({
  ...(await importOriginal<typeof FileSuggestionClient>()),
  deliverWorkspaceFileSuggestions: (...args: unknown[]): void => { deliverSuggestions(...args); },
}));

function summary(id = "session"): SessionSummaryView {
  return {
    id, title: "Synthetic", cwd: "/synthetic", status: "ready", isActive: true, isEphemeral: false,
    historyStatus: "loaded", requiresUserInput: false,
  };
}

function activeSession(id = "session"): SessionViewModel {
  return {
    id, title: "Synthetic session", cwd: "/synthetic", status: "ready", isEphemeral: false,
    isStreaming: false, isCompacting: false, isForking: false, historyStatus: "loaded",
    model: { id: "model", provider: "example", supportsImages: true }, thinkingLevel: "off",
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

const stubCommands = { completions: (commands: never[]) => commands, handle: () => undefined };

// jsdom has no ResizeObserver; ConversationView only needs the observe lifecycle.
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

function sidebarShell(providerUsageSource: ProviderUsageSource | undefined) {
  return render(SidebarShell, {
    props: {
      sessions: [summary()], session: activeSession(), externalized: false,
      draftAuthority: "webview", localCommands: stubCommands, providerUsageSource,
    },
  });
}

describe("injected provider usage source", () => {
  it("threads the ClientApp-injected source into session metrics instead of forcing the bridge source", async () => {
    clientCapabilities.set(VSCODE_CLIENT_UI_CAPABILITIES);
    composerDrafts.set({});
    toastStore.set([]);
    const listProviders = vi.fn(() => Promise.resolve([]));

    const view = sidebarShell({ listProviders, queryUsage: () => Promise.resolve([]) });
    await fireEvent.click(view.getByRole("button", { name: "Provider usage" }));
    await waitFor(() => expect(listProviders).toHaveBeenCalled());
    view.unmount();
  });
});

describe("explicit client UI capabilities", () => {
  it("hides the SessionList editor-tab affordance when the host lacks session editor tabs", () => {
    clientCapabilities.set({ ...VSCODE_CLIENT_UI_CAPABILITIES, sessionEditorTabs: false });
    const hidden = render(SessionList, {
      props: {
        sessions: [summary()], activeId: "session",
        onselect: vi.fn(), onclose: vi.fn(), onexternalize: undefined, oncreate: vi.fn(), onresume: vi.fn(),
      },
    });
    expect(hidden.queryByTitle("Open in editor tab")).toBeNull();
    cleanup();

    clientCapabilities.set(VSCODE_CLIENT_UI_CAPABILITIES);
    const shown = render(SessionList, {
      props: {
        sessions: [summary()], activeId: "session",
        onselect: vi.fn(), onclose: vi.fn(), onexternalize: vi.fn(), oncreate: vi.fn(), onresume: vi.fn(),
      },
    });
    expect(shown.getByTitle("Open in editor tab")).toBeTruthy();
    cleanup();
  });

  // These fixtures cover the listed affordances, not automatic discovery of future ungated UI.
  it("hides unavailable header actions but keeps rename and settings usable", async () => {
    clientCapabilities.set(noCapabilities);
    const view = render(SessionHeader, { props: { sessions: [summary()], active: activeSession() } });
    await fireEvent.click(view.getByRole("button", { name: "Session actions" }));
    expect(view.queryByText("Open in editor tab")).toBeNull();
    expect(view.queryByText("Export diagnostics")).toBeNull();
    await fireEvent.click(view.getByRole("button", { name: "Rename" }));
    await fireEvent.input(view.getByRole("textbox", { name: "Session name" }), { target: { value: "Renamed" } });
    await fireEvent.keyDown(view.getByRole("textbox", { name: "Session name" }), { key: "Enter" });
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "renameSession", sessionId: "session", name: "Renamed" }));
    await fireEvent.click(view.getByRole("button", { name: "Session actions" }));
    await fireEvent.click(view.getByRole("button", { name: /Network & proxy/ }));
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "openProxySettings" }));
    await fireEvent.click(view.getByRole("button", { name: "Session actions" }));
    await fireEvent.click(view.getByRole("button", { name: "FrostPi extensions" }));
    await fireEvent.click(view.getByRole("button", { name: /Question tool/ }));
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "openSettings" }));
    cleanup();

    clientCapabilities.set(VSCODE_CLIENT_UI_CAPABILITIES);
    const capable = render(SessionHeader, { props: { sessions: [summary()], active: activeSession() } });
    await fireEvent.click(capable.getByRole("button", { name: "Session actions" }));
    expect(capable.getByText("Open in editor tab")).toBeTruthy();
    await fireEvent.click(capable.getByRole("button", { name: "Export diagnostics" }));
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "exportDiagnostics" }));
    cleanup();
  });

  it.each([false, true])("gates actual tool and Markdown file references (enabled=%s) without disabling external links or copy", async (enabled) => {
    clientCapabilities.set(enabled ? VSCODE_CLIENT_UI_CAPABILITIES : noCapabilities);
    const activity: ToolActivityView = {
      id: "read-activity", type: "tool", timestamp: 1,
      tool: {
        id: "read-call", state: "bound", name: "read", label: "src/a.ts:7",
        status: "complete", isError: false, startedAt: 1,
        args: { path: "src/a.ts", line: 7 }, output: "const answer = 42;",
        recognized: { location: { path: "src/a.ts", line: 7 } },
      },
    };
    const card = render(ToolActivity, { props: { activity } });
    await fireEvent.click(card.getByRole("button", { name: /read src\/a.ts:7/ }));
    const fileAction = card.getByRole("button", { name: enabled ? "Open file" : "src/a.ts:7" }) as HTMLButtonElement;
    expect(fileAction.disabled).toBe(!enabled);
    await fireEvent.click(fileAction);
    if (enabled) {
      expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "openFile", path: "src/a.ts", line: 7 }));
    } else {
      expect(postMessage).not.toHaveBeenCalled();
    }
    postMessage.mockClear();

    const markdown = render(MarkdownHtml, {
      props: { content: "[source](src/a.ts#L7) and [website](https://example.com)\n\n```ts\nconst answer = 42;\n```" },
    });
    const fileLink = markdown.getByText("source");
    expect(fileLink.textContent).toBe("source");
    expect(fileLink.hasAttribute("href")).toBe(enabled);
    expect(fileLink.getAttribute("aria-disabled")).toBe(enabled ? null : "true");
    await fireEvent.click(fileLink);
    if (enabled) {
      expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "openFile", path: "src/a.ts", line: 7 }));
    } else {
      expect(postMessage).not.toHaveBeenCalled();
    }
    await fireEvent.click(markdown.getByRole("link", { name: "website" }));
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "openExternal", url: "https://example.com" }));
    await fireEvent.click(markdown.getByTitle("Copy code"));
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "copyText", text: "const answer = 42;\n" }));
  });

  it("drops editor mention specials from workspace suggestions when the host lacks editor mentions", () => {
    const message: HostToWebviewMessage = {
      bridgeVersion: "3.3",
      type: "workspaceFileSuggestions",
      requestId: "request",
      items: [{ path: "src/a.ts", name: "a.ts", directory: "src", score: 800, isDirectory: false }],
      specials: [{ id: "selection", label: "Selection", detail: "a.ts · selection", insertText: "@a.ts:1-2 " }],
    };

    clientCapabilities.set({ ...VSCODE_CLIENT_UI_CAPABILITIES, editorMentionSpecials: false });
    applyHostMessage(message);
    expect(deliverSuggestions).toHaveBeenLastCalledWith("request", message.items, undefined, undefined);

    clientCapabilities.set(VSCODE_CLIENT_UI_CAPABILITIES);
    applyHostMessage(message);
    expect(deliverSuggestions).toHaveBeenLastCalledWith("request", message.items, undefined, message.specials);
  });
});
