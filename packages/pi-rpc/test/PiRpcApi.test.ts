import { describe, expect, it, vi } from "vitest";

import { PiRpcApi } from "../src/PiRpcApi.js";

describe("PiRpcApi", () => {
  it("sends a fork request with the exact Pi entry id", async () => {
    const request = vi.fn().mockResolvedValue({ text: "retry this", cancelled: false });
    const api = new PiRpcApi({ request } as never);

    await expect(api.fork("entry-123")).resolves.toEqual({ text: "retry this", cancelled: false });
    expect(request).toHaveBeenCalledWith({ type: "fork", entryId: "entry-123" }, null);
  });

  it("replaces the session without a request deadline", async () => {
    // An extension may hold new_session behind a dialog; Pi still commits when it is answered.
    const request = vi.fn().mockResolvedValue({ cancelled: false });
    const api = new PiRpcApi({ request } as never);

    await expect(api.newSession()).resolves.toEqual({ cancelled: false });
    expect(request).toHaveBeenCalledWith({ type: "new_session" }, null);
  });

  it("executes extension commands through prompt without a request deadline", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const api = new PiRpcApi({ request } as never);

    await api.executeExtensionCommand("frostpi.session-tree", "encoded-request");

    expect(request).toHaveBeenCalledWith(
      { type: "prompt", message: "/frostpi.session-tree encoded-request" },
      null,
    );
  });

  it("preserves streaming behavior and image content in prompt commands", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const api = new PiRpcApi({ request } as never);

    await api.prompt("inspect", {
      streamingBehavior: "followUp",
      images: [{ type: "image", data: "abc", mimeType: "image/png" }],
    });

    expect(request).toHaveBeenCalledWith({
      type: "prompt",
      message: "inspect",
      streamingBehavior: "followUp",
      images: [{ type: "image", data: "abc", mimeType: "image/png" }],
    });
  });
});
