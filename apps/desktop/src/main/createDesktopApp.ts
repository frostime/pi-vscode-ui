import { join } from "node:path";
import { homedir } from "node:os";

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { ComposerDraftCache, SessionRegistry, WebviewConnection, WorkspaceFileSearch, readChatTypography } from "@frostime/pi-client/host";
import type { SessionRegistryOptions } from "@frostime/pi-client/host";
import type { RuntimeLogger } from "@frostime/pi-client/core/diagnostics/RuntimeLogger";
import { DesktopDialogs } from "./dialogs.js";
import { DesktopResume } from "./DesktopResume.js";
import { DesktopActionDispatcher } from "./DesktopActionDispatcher.js";
import { DesktopProjectNavigation } from "./DesktopProjectNavigation.js";
import { createDesktopHost } from "./desktopHost.js";
import { DesktopProjects } from "./desktopProjects.js";
import type { DesktopProjectsView } from "../shared/desktopBridge.js";
import { DesktopSettingsStore } from "./settings/DesktopSettingsStore.js";
import { DesktopSettingsController } from "./settings/DesktopSettingsController.js";
import { defaultVscodeSettingsPath, importVscodeSettings } from "./settings/importVscodeSettings.js";
import { DesktopSettingsError, settingsErrorMessage } from "./settings/DesktopSettingsError.js";
import type { DesktopSettingsResult } from "../shared/desktopSettings.js";
import { DesktopStateStore, DesktopStateWriteError } from "./storage/DesktopStateStore.js";

export interface DesktopAppOptions {
  directories?: readonly string[];
  settingsStore?: DesktopSettingsStore;
  stateStore?: DesktopStateStore;
  /** Trusted main-process test input, never accepted over IPC. */
  vscodeSettingsPath?: string;
  /** Trusted main-process seam for controlled discovery delays/failures. */
  discoverWorkingDirectories?: SessionRegistryOptions["discoverWorkingDirectories"];
  show?: boolean;
}

export async function createDesktopApp(options: DesktopAppOptions = {}) {
  const settingsStore = options.settingsStore ?? await DesktopSettingsStore.open(join(app.getPath("userData"), "settings.json"));
  const settings = new DesktopSettingsController(settingsStore, {
    importDefaults: () => importVscodeSettings(options.vscodeSettingsPath ?? defaultVscodeSettingsPath(
      process.platform, homedir(), process.env.APPDATA, process.env.XDG_CONFIG_HOME,
    )),
    openFile: async (path) => {
      const error = await shell.openPath(path);
      if (error) throw new DesktopSettingsError("Could not open Desktop settings.json with the system editor.");
    },
  });
  const stateStore = options.stateStore ?? await DesktopStateStore.open(join(app.getPath("userData"), "state.json"));
  const projects = new DesktopProjects();
  await projects.restore(stateStore.projects);
  let firstStartupProject: string | undefined;
  for (const directory of options.directories ?? []) {
    const project = await projects.addProject(directory);
    firstStartupProject ??= project.id;
  }
  if (firstStartupProject) projects.selectProject(firstStartupProject);
  const projectState = (): DesktopProjectsView => ({ projects: [...projects.list()], activeProjectId: projects.selected?.id ?? null });
  // Preserve loaded client metadata while registering roots before Registry construction.
  await stateStore.saveProjects(projectState()).catch(() => undefined);
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
  const resume = new DesktopResume({
    project: () => projects.selected,
    session: (id) => registry.sessionView(id),
    publish: (view) => {
      if (!window.isDestroyed()) window.webContents.send("frostpi:resume:view", view);
    },
  });
  const interactions = new DesktopDialogs((request) => {
    resume.dialogShown(request);
    if (!window.isDestroyed()) window.webContents.send("frostpi:dialog:view", request);
  });
  const addProject = async (directory?: string): Promise<void> => {
    if (!directory) {
      const result = await dialog.showOpenDialog(window, { title: "Add Project", properties: ["openDirectory"] });
      if (result.canceled || !result.filePaths[0]) return;
      directory = result.filePaths[0];
    }
    const project = await projects.addProject(directory);
    await navigation.selectProject(project.id);
    resume.hide();
  };
  const host = createDesktopHost({
    window, projects, interactions, resume, openFolder: addProject, settingsStore, storage: stateStore,
    // app.getVersion() is the packaged manifest version; in development it reports Electron's version instead.
    clientVersion: app.isPackaged ? app.getVersion() : "unknown",
    openSettings: (target) => {
      if (window.isDestroyed()) return Promise.reject(new DesktopSettingsError("The Desktop settings window is closed."));
      window.webContents.send("frostpi:settings:open", target);
      return Promise.resolve();
    },
  });
  const registry = new SessionRegistry(host, {
    logger,
    restoreSelection: "saved-only",
    onSessionOpened: (id, sourceId) => navigation.sessionOpened(id, sourceId),
    ...(options.discoverWorkingDirectories ? { discoverWorkingDirectories: options.discoverWorkingDirectories } : {}),
    sessionTreeArtifactPath: join(__dirname, "pi-extensions/session-tree.js"),
    questionToolArtifactPath: join(__dirname, "pi-extensions/question-tool.js"),
  });
  const navigation = new DesktopProjectNavigation({
    projects, registry, storage: stateStore,
    publish: () => publishProjects(),
    reportError: (error) => {
      logger.error("Desktop navigation could not be saved or restored.", error);
      connection.post({ type: "toast", level: "error", message: "Could not save or restore Desktop navigation. Check the Project directory and state.json." });
    },
  });
  const drafts = new ComposerDraftCache(host);
  const unsupportedEditor = (): never => { throw new Error("Editor tabs are not supported in Desktop."); };
  const dispatcher = new DesktopActionDispatcher({
    host, registry, logger, drafts,
    getProxyCredentials: () => host.proxyCredentials.get(),
    openPanel: unsupportedEditor, revealPanel: unsupportedEditor, openComposerEditor: unsupportedEditor,
  }, resume, navigation);
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
  const projectsView = (): DesktopProjectsView => ({
    ...projectState(),
    navigation: navigation.view,
    ...(stateStore.error ? { stateError: `${stateStore.error} State file: ${stateStore.filePath}` } : {}),
  });
  const publishProjects = (): void => {
    if (!window.isDestroyed()) window.webContents.send("frostpi:projects:view", projectsView());
    connection.refresh();
  };
  const subscriptions = [
    registry.onDidChange(() => { navigation.refresh(); resume.refresh(); }),
    registry.onDidToast((toast) => connection.post({ type: "toast", ...toast })),
    registry.onDidSetComposerText(({ sessionId, text }) => connection.queueComposerText(sessionId, text, () => undefined)),
  ];
  const unsubscribeProjects = projects.onDidChange(() => {
    publishProjects();
    // Store errors are published through projectsView; do not turn them into unhandled promises.
    void stateStore.saveProjects(projectState()).catch(() => undefined);
  });
  const unsubscribeState = stateStore.onDidChange(publishProjects);
  const unsubscribeSettings = settingsStore.onDidChange(() => {
    registry.refreshConfigurationState();
    connection.post({ type: "setChatTypography", typography: readChatTypography(host.configuration.getConfiguration("chat")) });
    connection.refresh();
    if (!window.isDestroyed()) window.webContents.send("frostpi:settings:view", settings.view());
  });
  ipcMain.handle("frostpi:settings:action", async (event, action: unknown): Promise<DesktopSettingsResult> => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error("Unauthorized Desktop settings request.");
    }
    try {
      return { ok: true, view: await settings.handle(action) };
    } catch (error) {
      return { ok: false, error: settingsErrorMessage(error) };
    }
  });
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
  listen("frostpi:projects:remove", async (id) => {
    if (typeof id !== "string" || id.length >= 4096) return;
    const project = projects.list().find((candidate) => candidate.id === id);
    if (!project) throw new Error("This Desktop Project is no longer available.");
    const sessions = registry.snapshot().sessions.filter((session) => navigation.view.sessionProjects[session.id] === id);
    try {
      await navigation.removeProject(id, async () => await host.window.showWarningDialog(
        `Remove Project "${project.name}" and close its open sessions? Unsent drafts and temporary conversations will be discarded. Running tasks will stop and pending input will be cancelled. The directory and saved Pi history will not be deleted.`,
        ["Remove Project"],
      ) === "Remove Project");
      if (!projects.list().some((candidate) => candidate.id === id) && resume.view?.projectId === id) resume.hide();
    } finally {
      for (const session of sessions) if (!registry.hasSession(session.id)) drafts.release(session.id);
    }
  });
  listen("frostpi:projects:select", async (id) => {
    if (typeof id === "string" && id.length < 4096) { await navigation.selectProject(id); resume.hide(); }
  });
  listen("frostpi:sidebar:set", (layout) => navigation.setSidebar(layout));
  listen("frostpi:dialog:response", (id, value) => interactions.respond(id, value));
  listen("frostpi:resume:request", () => resume.publish());
  listen("frostpi:resume:show", async (id) => {
    const view = resume.view;
    if (typeof id !== "string" || view?.id !== id) return;
    if (view.projectId && view.projectId !== projects.selected?.id) await navigation.selectProject(view.projectId);
    resume.show(id);
  });
  listen("frostpi:resume:dismiss", (id) => resume.dismiss(id));
  window.on("minimize", () => visibility.fire(false));
  window.on("restore", () => visibility.fire(true));

  let disposal: Promise<void> | undefined;
  let closeRequested = false;
  const dispose = (): Promise<void> => disposal ??= (async () => {
    resume.dispose();
    navigation.dispose();
    interactions.dispose();
    for (const { channel, listener } of ipcListeners) ipcMain.removeListener(channel, listener);
    unsubscribeProjects();
    unsubscribeState();
    unsubscribeSettings();
    ipcMain.removeHandler("frostpi:settings:action");
    for (const subscription of subscriptions) subscription.dispose();
    connection.dispose(); drafts.dispose(); incoming.dispose(); visibility.dispose();
    await registry.dispose();
    // Registry queues its Memento updates before the file store sees them.
    let metadataNotCaptured = false;
    try { await registry.flushPersistence(); }
    catch (error) { metadataNotCaptured = !(error instanceof DesktopStateWriteError); }
    await navigation.flush();
    await stateStore.flush();
    // File retries recover accepted writes, not rejected metadata/serialization attempts.
    if (metadataNotCaptured) throw new Error("Session metadata could not be saved.");
  })();
  let closing: Promise<void> | undefined;
  const closeWindow = (): Promise<void> => closing ??= (async () => {
    try {
      await dispose();
    } catch {
      dialog.showErrorBox("FrostPi Desktop state", `Desktop could not finish saving its application state. The existing state file was not reset. Check the file and folder permissions before reopening:\n${stateStore.filePath}`);
    } finally {
      if (!window.isDestroyed()) window.destroy();
    }
  })();
  window.on("close", (event) => {
    event.preventDefault();
    closeRequested = true;
    void closeWindow();
  });
  window.webContents.on("render-process-gone", () => { void closeWindow(); });
  try {
    await navigation.initialize({ explicitProjectSelection: Boolean(firstStartupProject) });
    await registry.ensureInitialSession();
    await window.loadFile(join(__dirname, "renderer/index.html"));
  } catch (error) {
    await dispose().catch(() => undefined);
    if (!window.isDestroyed()) window.destroy();
    if (!closeRequested) throw error;
  }
  return { window, registry, projects, connection, settingsStore, stateStore, navigation, dispose };
}
