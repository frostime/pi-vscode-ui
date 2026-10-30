import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostToWebviewMessage } from "@frostime/pi-client/shared/bridge/hostToWebview";
import { BRIDGE_VERSION } from "@frostime/pi-client/shared/bridge/bridgeVersion";
import { DESKTOP_MESSAGE_LIMIT_ERROR, DESKTOP_TRANSPORT_BLOCKED_CHANNEL } from "../src/shared/desktopTransport.js";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, EventListener>(),
  emit: undefined as undefined | ((event: { kind: string; channel: string; value: unknown }) => void),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: native.invoke,
  Channel: class { set onmessage(listener: (event: { kind: string; channel: string; value: unknown }) => void) { native.emit = listener; } },
}));
import { connectTauriDesktop } from "../src/renderer/tauriBridge.js";

beforeEach(() => {
  native.invoke.mockReset().mockResolvedValue(undefined);
  native.listeners.clear();
  vi.stubGlobal("window", { addEventListener: (name: string, listener: EventListener) => { native.listeners.set(name, listener); } });
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
  it("routes Windows zoom shortcuts and ignores IME, Alt and unmodified input", async () => {
    await connectTauriDesktop(); native.invoke.mockClear();
    const press = (overrides: Record<string, unknown>) => {
      const event = { ctrlKey: true, altKey: false, isComposing: false, key: "=", code: "Equal", preventDefault: vi.fn(), ...overrides };
      native.listeners.get("keydown")?.(event as unknown as Event);
      return event;
    };
    for (const overrides of [{ isComposing: true }, { altKey: true }, { ctrlKey: false }]) {
      expect(press(overrides).preventDefault).not.toHaveBeenCalled();
    }
    expect(native.invoke).not.toHaveBeenCalled();
    expect(press({ key: "Unidentified", code: "NumpadAdd" }).preventDefault).toHaveBeenCalled();
    press({ key: "-", code: "Minus" }); press({ key: "0", code: "Digit0" });
    expect(native.invoke.mock.calls.map((call) => (call[1] as { request: { args: unknown[] } }).request.args[0])).toEqual(["in", "out", "reset"]);
  });
});
