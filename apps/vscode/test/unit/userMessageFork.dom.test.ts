/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConversationMessageView } from "$shared/model/conversationModel";
import type { SessionViewModel } from "$shared/model/sessionViewModel";
import { resolveForkResult } from "$ui/features/conversation/forkMessageClient";
import UserMessage from "$ui/features/conversation/UserMessage.svelte";

const bridge = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("$ui/bridge/hostBridge", () => ({ postToHost: bridge.post }));

function session(overrides: Partial<SessionViewModel>): SessionViewModel {
  return {
    id: "session-1",
    status: "ready",
    isStreaming: false,
    isCompacting: false,
    isForking: false,
    isNavigatingTree: false,
    historyStatus: "loaded",
    pendingExtensionUi: [],
    queuedSteers: [],
    queuedFollowUps: [],
    sessionTreeAvailable: true,
    ...overrides,
  } as SessionViewModel;
}

const live: ConversationMessageView = { id: "local-user-1", role: "user", blocks: [{ type: "text", text: "Try another way" }], status: "complete", timestamp: 1 };

afterEach(() => {
  cleanup();
  bridge.post.mockReset();
});

describe("Fork from a user message", () => {
  it("forks the message of the running turn by its view id", async () => {
    const view = render(UserMessage, { props: { message: live, session: session({ status: "running", isStreaming: true }) } });
    expect(view.queryByRole("button", { name: "Branch from this prompt in the same session" })).toBeNull();

    await fireEvent.click(view.getByRole("button", { name: "Fork session from this message" }));
    const request = bridge.post.mock.calls[0]?.[0] as { requestId: string };
    expect(request).toMatchObject({ type: "forkMessage", sessionId: "session-1", messageId: "local-user-1" });
    expect(request).not.toHaveProperty("entryId");
    // The Fork is made in a second process; until Pi forks, the message offers Cancel Fork.
    expect(view.getByRole("button", { name: "Cancel Fork" })).toBeTruthy();
    resolveForkResult({ type: "forkResult", requestId: request.requestId, ok: true } as never);
  });

  it("forks a saved message by its Pi entry id, and offers nothing for an unsaved one when idle", async () => {
    const saved = { ...live, sourceEntryId: "entry-1" };
    const view = render(UserMessage, { props: { message: saved, session: session({}) } });
    await fireEvent.click(view.getByRole("button", { name: "Fork session from this message" }));
    const request = bridge.post.mock.calls[0]?.[0] as { requestId: string };
    expect(request).toMatchObject({ type: "forkMessage", entryId: "entry-1" });
    expect(request).not.toHaveProperty("messageId");
    resolveForkResult({ type: "forkResult", requestId: request.requestId, ok: true } as never);
    cleanup();

    const idle = render(UserMessage, { props: { message: live, session: session({}) } });
    expect(idle.queryByRole("button", { name: "Fork session from this message" })).toBeNull();
  });
});
