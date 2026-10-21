import { contextBridge, ipcRenderer } from "electron";

import type { DesktopApi, DesktopDialog, DesktopProjectsView } from "./shared/desktopBridge.js";
import type { HostToWebviewMessage } from "@frostime/pi-client/shared/bridge/hostToWebview";

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
  selectProject: (id) => ipcRenderer.send("frostpi:projects:select", id),
  onProjects: (listener) => subscribe<DesktopProjectsView>("frostpi:projects:view", listener),
  onDialog: (listener) => subscribe<DesktopDialog | null>("frostpi:dialog:view", listener),
  respondDialog: (id, value) => ipcRenderer.send("frostpi:dialog:response", id, value),
};

contextBridge.exposeInMainWorld("frostpiDesktop", api);
