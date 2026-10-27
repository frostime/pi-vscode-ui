import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostToWebviewMessage } from "@frostime/pi-client/shared/bridge/hostToWebview";
import { BRIDGE_VERSION } from "@frostime/pi-client/shared/bridge/bridgeVersion";
import { DESKTOP_MESSAGE_LIMIT_ERROR, DESKTOP_TRANSPORT_BLOCKED_CHANNEL } from "../src/shared/desktopTransport.js";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  emit: undefined as undefined | ((event: { kind: string; channel: string; value: unknown }) => void),
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: native.invoke,
  Channel: class { set onmessage(listener: (event: { kind: string; channel: string; value: unknown }) => void) { native.emit = listener; } },
}));
import { connectTauriDesktop } from "../src/renderer/tauriBridge.js";

beforeEach(() => {
  native.invoke.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("window", { addEventListener: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe("Tauri local rejection", () => {
  it("settles a rejected prompt through the existing failure/restore path, then accepts another request", async () => {
    await connectTauriDesktop();
    const messages: HostToWebviewMessage[] = [];
    window.frostpiDesktop.onClientMessage((message) => messages.push(message));
    const prompt = { type: "sendPrompt" as const, bridgeVersion: BRIDGE_VERSION, requestId: "p1", sessionId: "s", text: "text", images: [], draftRevision: 1, streamingBehavior: "steer" as const };
    native.invoke.mockRejectedValueOnce("Desktop message is too large");
    window.frostpiDesktop.postClientMessage(prompt);
    await vi.waitFor(() => expect(messages).toEqual([{ bridgeVersion: BRIDGE_VERSION, type: "promptResult", requestId: "p1", ok: false, error: DESKTOP_MESSAGE_LIMIT_ERROR }]));
    window.frostpiDesktop.postClientMessage({ ...prompt, requestId: "p2" });
    await Promise.resolve();
    expect(native.invoke).toHaveBeenLastCalledWith("desktop_request", { request: { channel: "frostpi:client:in", args: [{ ...prompt, requestId: "p2" }] } });
  });
  it("keeps presentation failure on the Desktop private event rather than the shared message protocol", async () => {
    await connectTauriDesktop();
    const blocked: boolean[] = []; const messages: HostToWebviewMessage[] = [];
    window.frostpiDesktop.onClientMessage((message) => messages.push(message));
    const unsubscribe = window.frostpiDesktop.onTransportBlocked((value) => blocked.push(value));
    native.emit?.({ kind: "event", channel: DESKTOP_TRANSPORT_BLOCKED_CHANNEL, value: true });
    native.emit?.({ kind: "event", channel: DESKTOP_TRANSPORT_BLOCKED_CHANNEL, value: false });
    unsubscribe();
    native.emit?.({ kind: "event", channel: DESKTOP_TRANSPORT_BLOCKED_CHANNEL, value: true });
    expect(blocked).toEqual([true, false]); expect(messages).toEqual([]);
  });
});
