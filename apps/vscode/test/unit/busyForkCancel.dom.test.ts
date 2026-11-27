import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationMessageView } from "$shared/model/conversationModel";
import type { SessionViewModel } from "$shared/model/sessionViewModel";
import { BRIDGE_VERSION } from "$shared/bridge/bridgeVersion";
import { connectHostBridge } from "$ui/bridge/hostBridge";
import { resolveForkResult } from "$ui/features/conversation/forkMessageClient";
import UserMessage from "$ui/features/conversation/UserMessage.svelte";

const postMessage = vi.fn();
let disconnectHost: () => void;

beforeEach(() => {
  postMessage.mockClear();
  disconnectHost = connectHostBridge({ postMessage, onMessage: () => () => undefined });
});

afterEach(() => {
  cleanup();
  disconnectHost();
});

function session(overrides: Partial<SessionViewModel> = {}): SessionViewModel {
  return {
    id: "session", title: "Parser work", cwd: "/workspace", status: "running", isEphemeral: false,
    isStreaming: true, isCompacting: false, isForking: false, historyStatus: "loaded",
    model: null, thinkingLevel: "off", availableModels: [], scopedModelIds: [], commands: [],
    attachmentLimits: { maxImageBytes: 1, maxImages: 1 }, collapseTurnTrace: true, collapseRunningTurnTrace: true, composerSendOnEnter: true,
    composerStreamingBehavior: "steer", networkProxy: { mode: "inherit", label: "Inherited", restartRequired: false },
    questionTool: { configuredEnabled: false, appliedEnabled: false, restartRequired: false },
    conversationItems: [], queuedSteers: [], queuedFollowUps: [], queuedPromptRecovery: { state: "unavailable" } as never,
    pendingExtensionUi: [], extensionStatuses: [], extensionWidgets: [], sessionTreeAvailable: true,
    isNavigatingTree: false, isSummarizingTree: false, conversationContentRevision: 0,
    ...overrides,
  };
}

const message: ConversationMessageView = {
  id: "m1", role: "user", sourceEntryId: "entry-1", timestamp: 0, blocks: [{ type: "text", text: "earlier prompt" }],
} as ConversationMessageView;

function posted(): Array<Record<string, unknown>> {
  return postMessage.mock.calls.map(([sent]) => sent as Record<string, unknown>);
}

describe("Fork from a busy session", () => {
  it("turns its Fork button into Cancel Fork until the Host answers", async () => {
    const view = render(UserMessage, { message, session: session() });

    await fireEvent.click(view.getByRole("button", { name: "Fork session from this message" }));
    const request = posted().find((sent) => sent.type === "forkMessage")!;
    expect(request).toMatchObject({ sessionId: "session", entryId: "entry-1" });

    await fireEvent.click(view.getByRole("button", { name: "Cancel Fork" }));
    expect(posted().at(-1)).toMatchObject({ type: "cancelFork", sessionId: "session" });

    resolveForkResult({ type: "forkResult", bridgeVersion: BRIDGE_VERSION, requestId: request.requestId as string, ok: true, cancelled: true });
    await Promise.resolve();
    expect(view.queryByRole("button", { name: "Cancel Fork" })).toBeNull();
    expect(view.getByRole("button", { name: "Fork session from this message" })).toBeTruthy();
  });

  it("leaves cancelling an idle-session Fork to the Composer", async () => {
    const view = render(UserMessage, { message, session: session({ status: "ready", isStreaming: false }) });
    await fireEvent.click(view.getByRole("button", { name: "Fork session from this message" }));
    const request = posted().find((sent) => sent.type === "forkMessage")!;

    // The Host marks the Session as forking; its Composer shows Cancel Fork instead.
    await view.rerender({ message, session: session({ status: "ready", isStreaming: false, isForking: true }) });
    expect(view.queryByRole("button", { name: "Cancel Fork" })).toBeNull();
    expect(view.getByRole("button", { name: "Fork session from this message" }).textContent).toContain("Forking…");
    resolveForkResult({ type: "forkResult", bridgeVersion: BRIDGE_VERSION, requestId: request.requestId as string, ok: true, cancelled: true });
  });
});
