import { join } from "node:path";

import { BrowserWindow, dialog, ipcMain } from "electron";
import { ComposerDraftCache, SessionRegistry, WebviewActionDispatcher, WebviewConnection, WorkspaceFileSearch, readChatTypography } from "@frostime/pi-client/host";
import type { RuntimeLogger } from "@frostime/pi-client/core/diagnostics/RuntimeLogger";
import { DesktopDialogs } from "./dialogs.js";
import { createDesktopHost } from "./desktopHost.js";
import { DesktopProjects } from "./desktopProjects.js";
import type { DesktopProjectsView } from "../shared/desktopBridge.js";

export interface DesktopAppOptions {
  directories?: readonly string[];
  settings?: Record<string, unknown>;
  show?: boolean;
}

export async function createDesktopApp(options: DesktopAppOptions = {}) {
  const projects = new DesktopProjects();
  for (const directory of options.directories ?? []) await projects.addProject(directory);
  const window = new BrowserWindow({
    width: 1100, height: 800, minWidth: 280, minHeight: 400, show: options.show ?? true,
    title: "FrostPi Desktop — development preview",
    backgroundColor: "#181a1f",
    webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  const logger: RuntimeLogger = {
    info: () => undefined,
    error: () => console.error("FrostPi Desktop client operation failed."),
  };
  const interactions = new DesktopDialogs((request) => {
    if (!window.isDestroyed()) window.webContents.send("frostpi:dialog:view", request);
  });
  const addProject = async (directory?: string): Promise<void> => {
    if (directory) { await projects.addProject(directory); return; }
    const result = await dialog.showOpenDialog(window, { title: "Add Project", properties: ["openDirectory"] });
    if (!result.canceled && result.filePaths[0]) await projects.addProject(result.filePaths[0]);
  };
  const host = createDesktopHost({ window, projects, interactions, openFolder: addProject, ...(options.settings ? { settings: options.settings } : {}) });
  const registry = new SessionRegistry(host, {
    logger,
    sessionTreeArtifactPath: join(__dirname, "pi-extensions/session-tree.js"),
    questionToolArtifactPath: join(__dirname, "pi-extensions/question-tool.js"),
  });
  const drafts = new ComposerDraftCache(host);
  const unsupportedEditor = (): never => { throw new Error("Editor tabs are not supported in Desktop."); };
  const dispatcher = new WebviewActionDispatcher({
    host, registry, logger, drafts,
    getProxyCredentials: () => host.proxyCredentials.get(),
    openPanel: unsupportedEditor, revealPanel: unsupportedEditor, openComposerEditor: unsupportedEditor,
  });
  const incoming = host.createEventEmitter<unknown>();
  const visibility = host.createEventEmitter<boolean>();
  const connection = new WebviewConnection(registry, {
    surface: { kind: "sidebar" },
    isVisible: () => !window.isDestroyed() && !window.isMinimized(),
    postMessage: (message) => {
      if (window.isDestroyed()) return Promise.resolve(false);
      window.webContents.send("frostpi:client:out", message);
      return Promise.resolve(true);
    },
    onDidReceiveMessage: incoming.event,
    onDidChangeVisibility: visibility.event,
  }, dispatcher, drafts, logger, () => false, () => false, {
    fileSearch: new WorkspaceFileSearch(),
    readChatTypography: () => readChatTypography(host.configuration.getConfiguration("chat")),
  });
  const projectsView = (): DesktopProjectsView => ({ projects: [...projects.list()], activeProjectId: projects.selected?.id ?? null });
  const publishProjects = (): void => {
    if (!window.isDestroyed()) window.webContents.send("frostpi:projects:view", projectsView());
    connection.refresh();
  };
  const subscriptions = [
    registry.onDidChange(() => connection.refresh()),
    registry.onDidToast((toast) => connection.post({ type: "toast", ...toast })),
    registry.onDidSetComposerText(({ sessionId, text }) => connection.queueComposerText(sessionId, text, () => undefined)),
  ];
  const unsubscribeProjects = projects.onDidChange(publishProjects);
  const ipcListeners: Array<{ channel: string; listener: (event: Electron.IpcMainEvent, ...values: unknown[]) => void }> = [];
  const listen = (channel: string, action: (...values: unknown[]) => void | Promise<void>): void => {
    const listener = (event: Electron.IpcMainEvent, ...values: unknown[]): void => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return;
      void Promise.resolve().then(() => action(...values)).catch((error: unknown) => {
        connection.post({ type: "toast", level: "error", message: error instanceof Error ? error.message : "The desktop operation could not be completed." });
      });
    };
    ipcMain.on(channel, listener);
    ipcListeners.push({ channel, listener });
  };
  listen("frostpi:client:in", (message) => incoming.fire(message));
  listen("frostpi:projects:request", publishProjects);
  listen("frostpi:projects:add", () => addProject());
  listen("frostpi:projects:select", (id) => { if (typeof id === "string" && id.length < 4096) projects.selectProject(id); });
  listen("frostpi:dialog:response", (id, value) => interactions.respond(id, value));
  window.on("minimize", () => visibility.fire(false));
  window.on("restore", () => visibility.fire(true));

  let disposal: Promise<void> | undefined;
  const dispose = (): Promise<void> => disposal ??= (async () => {
    interactions.dispose();
    for (const { channel, listener } of ipcListeners) ipcMain.removeListener(channel, listener);
    unsubscribeProjects();
    for (const subscription of subscriptions) subscription.dispose();
    connection.dispose(); drafts.dispose(); incoming.dispose(); visibility.dispose();
    await registry.dispose();
  })();
  window.on("close", (event) => {
    if (disposal) return;
    event.preventDefault();
    void dispose().finally(() => { if (!window.isDestroyed()) window.destroy(); });
  });
  window.webContents.on("render-process-gone", () => {
    void dispose().finally(() => { if (!window.isDestroyed()) window.destroy(); });
  });
  try {
    await registry.ensureInitialSession();
    await window.loadFile(join(__dirname, "renderer/index.html"));
  } catch (error) {
    await dispose();
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
  return { window, registry, projects, connection, dispose };
}
