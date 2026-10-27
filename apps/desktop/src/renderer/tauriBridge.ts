import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { BRIDGE_VERSION } from "@frostime/pi-client/shared/bridge/bridgeVersion";
import type { DesktopApi } from "../shared/desktopBridge.js";
import type { DesktopSettingsResult } from "../shared/desktopSettings.js";

/** Only this adapter imports Tauri. Shared ClientApp keeps its existing DesktopApi. */
export async function connectTauriDesktop(): Promise<void> {
  if (!isTauri()) return;
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const subscribe = <T>(channel: string, listener: (value: T) => void): (() => void) => {
    const callback = (value: unknown): void => listener(value as T);
    const group = listeners.get(channel) ?? new Set(); group.add(callback); listeners.set(channel, group);
    return () => { group.delete(callback); };
  };
  const channel = new Channel<{ kind: string; channel: string; value: unknown }>();
  channel.onmessage = (event) => {
    if (event.kind === "event") for (const listener of listeners.get(event.channel) ?? []) listener(event.value);
  };
  const request = (channel: string, ...args: unknown[]): Promise<unknown> => invoke("desktop_request", { request: { channel, args } });
  const send = (channel: string, ...args: unknown[]): void => {
    void request(channel, ...args).catch(() => {
      for (const listener of listeners.get("frostpi:client:out") ?? []) listener({ bridgeVersion: BRIDGE_VERSION, type: "toast", level: "error", message: "Could not reach the Desktop service." });
    });
  };
  const api: DesktopApi = {
    postClientMessage: (message) => send("frostpi:client:in", message),
    onClientMessage: (listener) => subscribe("frostpi:client:out", listener),
    requestProjects: () => send("frostpi:projects:request"),
    addProject: () => send("frostpi:projects:add"),
    removeProject: (id) => send("frostpi:projects:remove", id),
    selectProject: (id) => send("frostpi:projects:select", id),
    setSidebar: (layout) => send("frostpi:sidebar:set", layout),
    onProjects: (listener) => subscribe("frostpi:projects:view", listener),
    onDialog: (listener) => subscribe("frostpi:dialog:view", listener),
    respondDialog: (id, value) => send("frostpi:dialog:response", id, value),
    onResume: (listener) => subscribe("frostpi:resume:view", listener),
    requestResume: () => send("frostpi:resume:request"),
    showResume: (id) => send("frostpi:resume:show", id),
    dismissResume: (id) => send("frostpi:resume:dismiss", id),
    settings: async (action) => {
      const result = await request("frostpi:settings:action", action) as DesktopSettingsResult;
      if (!result.ok) throw new Error(result.error);
      return result.view;
    },
    onSettings: (listener) => subscribe("frostpi:settings:view", listener),
    onOpenSettings: (listener) => subscribe("frostpi:settings:open", listener),
  };
  await invoke("desktop_connect", { channel });
  window.frostpiDesktop = Object.freeze(api);
  window.addEventListener("keydown", (event) => {
    if (!event.ctrlKey || event.altKey || event.isComposing) return;
    const action = ["+", "="].includes(event.key) ? "in" : event.key === "-" ? "out" : event.key === "0" ? "reset" : undefined;
    if (action) { event.preventDefault(); send("frostpi:zoom", action); }
  }, { capture: true });
  window.addEventListener("wheel", (event) => {
    if (event.ctrlKey) { event.preventDefault(); send("frostpi:zoom", event.deltaY < 0 ? "in" : "out"); }
  }, { passive: false, capture: true });
}
