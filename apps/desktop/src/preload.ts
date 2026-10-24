import { contextBridge, ipcRenderer } from "electron";

import type { DesktopApi, DesktopDialog, DesktopProjectsView, DesktopResumeView } from "./shared/desktopBridge.js";
import type { HostToWebviewMessage } from "@frostime/pi-client/shared/bridge/hostToWebview";
import type { DesktopSettingsResult, DesktopSettingsTarget, DesktopSettingsView } from "./shared/desktopSettings.js";

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: T): void => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: DesktopApi = {
  postClientMessage: (message) => ipcRenderer.send("frostpi:client:in", message),
  onClientMessage: (listener) => subscribe<HostToWebviewMessage>("frostpi:client:out", listener),
  requestProjects: () => ipcRenderer.send("frostpi:projects:request"),
  addProject: () => ipcRenderer.send("frostpi:projects:add"),
  removeProject: (id) => ipcRenderer.send("frostpi:projects:remove", id),
  selectProject: (id) => ipcRenderer.send("frostpi:projects:select", id),
  setSidebar: (layout) => ipcRenderer.send("frostpi:sidebar:set", layout),
  onProjects: (listener) => subscribe<DesktopProjectsView>("frostpi:projects:view", listener),
  onDialog: (listener) => subscribe<DesktopDialog | null>("frostpi:dialog:view", listener),
  respondDialog: (id, value) => ipcRenderer.send("frostpi:dialog:response", id, value),
  onResume: (listener) => subscribe<DesktopResumeView | null>("frostpi:resume:view", listener),
  requestResume: () => ipcRenderer.send("frostpi:resume:request"),
  showResume: (id) => ipcRenderer.send("frostpi:resume:show", id),
  dismissResume: (id) => ipcRenderer.send("frostpi:resume:dismiss", id),
  settings: async (action) => {
    let result: DesktopSettingsResult;
    try {
      result = await ipcRenderer.invoke("frostpi:settings:action", action) as DesktopSettingsResult;
    } catch {
      throw new Error("Could not reach the Desktop settings service.");
    }
    // Business errors have already been sanitized by the main process, not Electron's exception wrapper.
    if (!result.ok) throw new Error(result.error);
    return result.view;
  },
  onSettings: (listener) => subscribe<DesktopSettingsView>("frostpi:settings:view", listener),
  onOpenSettings: (listener) => subscribe<DesktopSettingsTarget>("frostpi:settings:open", listener),
};

contextBridge.exposeInMainWorld("frostpiDesktop", api);
