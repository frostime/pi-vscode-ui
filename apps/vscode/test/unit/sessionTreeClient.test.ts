import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { composerDrafts } from "../../src/webview/features/composer/composerDraftStore.svelte.js";

const bridge = vi.hoisted(() => ({ postToHost: vi.fn() }));
vi.mock("../../src/webview/bridge/vscodeBridge.js", () => bridge);

const { requestBranchHere, requestBranchSwitch } = await import(
  "../../src/webview/features/conversation/sessionTreeClient.js"
);

beforeEach(() => {
  bridge.postToHost.mockReset();
  composerDrafts.set({});
});

describe("session tree Webview actions", () => {
  it("sends stable ids and whether the current Composer has a draft", () => {
    composerDrafts.set({ session: { revision: 1, text: "unsent", images: [] } });
    requestBranchHere(
      { id: "session" } as never,
      { sourceEntryId: "entry", blocks: [] } as never,
    );

    expect(bridge.postToHost).toHaveBeenCalledWith({
      type: "branchHere",
      sessionId: "session",
      entryId: "entry",
      hasDraft: true,
    });
    expect(JSON.stringify(bridge.postToHost.mock.calls[0]?.[0])).not.toContain("unsent");
  });

  it("reports an empty draft for virtual-root branch switching without mutating it", () => {
    requestBranchSwitch({ id: "session" } as never, null);

    expect(bridge.postToHost).toHaveBeenCalledWith({
      type: "switchBranch",
      sessionId: "session",
      branchPointId: null,
      hasDraft: false,
    });
    expect(get(composerDrafts)).toEqual({});
  });
});
