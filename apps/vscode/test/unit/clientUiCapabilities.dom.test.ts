import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { HostToWebviewMessage } from "$shared/bridge/hostToWebview";
import type { SessionSummaryView } from "$shared/model/sessionViewModel";

import { applyHostMessage } from "$ui/bridge/applyHostMessage";
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

  it("hides the SessionHeader editor-tab menu entry when the host lacks session editor tabs", async () => {
    clientCapabilities.set({ ...VSCODE_CLIENT_UI_CAPABILITIES, sessionEditorTabs: false });
    const view = render(SessionHeader, { props: { sessions: [summary()], active: activeSession() } });
    await fireEvent.click(view.getByRole("button", { name: "Session actions" }));
    expect(view.queryByText("Open in editor tab")).toBeNull();
    expect(view.getByText("Rename")).toBeTruthy();
    cleanup();

    clientCapabilities.set(VSCODE_CLIENT_UI_CAPABILITIES);
    const capable = render(SessionHeader, { props: { sessions: [summary()], active: activeSession() } });
    await fireEvent.click(capable.getByRole("button", { name: "Session actions" }));
    expect(capable.getByText("Open in editor tab")).toBeTruthy();
    cleanup();
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
