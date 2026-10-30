import { join } from "node:path";
import { homedir } from "node:os";

import type { DesktopNative, DesktopTransport } from "./desktopNative.js";
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
import { desktopThemes, desktopZoom, readDesktopTheme, readDesktopZoom, type DesktopSettingsResult } from "../shared/desktopSettings.js";
import { DesktopStateStore, DesktopStateWriteError } from "./storage/DesktopStateStore.js";


export interface DesktopBackendOptions {
  profile: string;
  artifacts: string;
  clientVersion: string;
  native: DesktopNative;
  transport: DesktopTransport;
  directories?: readonly string[];
  settingsStore?: DesktopSettingsStore;
  stateStore?: DesktopStateStore;
  /** Trusted main-process test input, never accepted over IPC. */
  vscodeSettingsPath?: string;
  /** Trusted main-process seam for controlled discovery delays/failures. */
  discoverWorkingDirectories?: SessionRegistryOptions["discoverWorkingDirectories"];
}

export async function createDesktopBackend(options: DesktopBackendOptions) {
  const { native, transport } = options;
  const settingsStore = options.settingsStore ?? await DesktopSettingsStore.open(join(options.profile, "settings.json"));
  const settings = new DesktopSettingsController(settingsStore, {
    importDefaults: () => importVscodeSettings(options.vscodeSettingsPath ?? defaultVscodeSettingsPath(
      process.platform, homedir(), process.env.APPDATA, process.env.XDG_CONFIG_HOME,
    )),
    openFile: async (path) => {
      const error = await native.openPath(path);
      if (error) throw new DesktopSettingsError("Could not open Desktop settings.json with the system editor.");
    },
  });
  const stateStore = options.stateStore ?? await DesktopStateStore.open(join(options.profile, "state.json"));
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
  let disposed = false;
  const publish = (channel: string, value: unknown): boolean => !disposed && transport.publish(channel, value);
  const applyAppearance = (): void => {
    const theme = readDesktopTheme(settingsStore.values);
    native.appearance(theme, desktopThemes[theme].background, readDesktopZoom(settingsStore.values));
  };
  applyAppearance();
  const logger: RuntimeLogger = {
    info: () => undefined,
    error: () => console.error("FrostPi Desktop client operation failed."),
  };
  const resume = new DesktopResume({
    project: () => projects.selected,
    session: (id) => registry.sessionView(id),
    publish: (view) => {
      publish("frostpi:resume:view", view);
    },
  });
  const interactions = new DesktopDialogs((request) => {
    resume.dialogShown(request);
    publish("frostpi:dialog:view", request);
  });
  const addProject = async (directory?: string): Promise<void> => {
    if (!directory) {
      directory = await native.chooseDirectory();
      if (!directory) return;
    }
    const project = await projects.addProject(directory);
    await navigation.selectProject(project.id);
    resume.hide();
  };
  const host = createDesktopHost({
    native, projects, interactions, resume, openFolder: addProject, settingsStore, storage: stateStore,
    clientVersion: options.clientVersion,
    openSettings: (target) => {
      if (disposed) return Promise.reject(new DesktopSettingsError("The Desktop settings window is closed."));
      publish("frostpi:settings:open", target);
      return Promise.resolve();
    },
  });
  const registry = new SessionRegistry(host, {
    logger,
    restoreSelection: "saved-only",
    onSessionOpened: (id, sourceId) => navigation.sessionOpened(id, sourceId),
    ...(options.discoverWorkingDirectories ? { discoverWorkingDirectories: options.discoverWorkingDirectories } : {}),
    sessionTreeArtifactPath: join(options.artifacts, "pi-extensions/session-tree.js"),
    questionToolArtifactPath: join(options.artifacts, "pi-extensions/question-tool.js"),
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
    isVisible: () => !disposed && transport.visible(),
    postMessage: (message) => {
      return Promise.resolve(publish("frostpi:client:out", message));
    },
    onDidReceiveMessage: incoming.event,
    onDidChangeVisibility: visibility.event,
  }, dispatcher, drafts, logger, () => false, () => false, {
    fileSearch: new WorkspaceFileSearch(),
    readChatTypography: () => readChatTypography(host.configuration.getConfiguration("chat")),
  });
  let zoomWrites = Promise.resolve();
  const projectsView = (): DesktopProjectsView => ({
    ...projectState(),
    navigation: navigation.view,
    ...(stateStore.error ? { stateError: `${stateStore.error} State file: ${stateStore.filePath}` } : {}),
  });
  const publishProjects = (): void => {
    publish("frostpi:projects:view", projectsView());
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
    applyAppearance();
    registry.refreshConfigurationState();
    connection.post({ type: "setChatTypography", typography: readChatTypography(host.configuration.getConfiguration("chat")) });
    connection.refresh();
    publish("frostpi:settings:view", settings.view());
  });
  const unsubscribeSettingsAction = transport.handle("frostpi:settings:action", async (action: unknown): Promise<DesktopSettingsResult> => {
    try {
      return { ok: true, view: await settings.handle(action) };
    } catch (error) {
      return { ok: false, error: settingsErrorMessage(error) };
    }
  });
  const listeners: Array<() => void> = [];
  const listen = (channel: string, action: (...values: unknown[]) => void | Promise<void>): void => {
    listeners.push(transport.listen(channel, (...values) => {
      if (disposed) return;
      void Promise.resolve().then(() => action(...values)).catch((error: unknown) => {
        connection.post({ type: "toast", level: "error", message: error instanceof Error ? error.message : "The desktop operation could not be completed." });
      });
    }));
  };
  listen("frostpi:zoom", (action) => {
    if (!["in", "out", "reset"].includes(String(action)) || settingsStore.firstRun || settingsStore.error) return;
    zoomWrites = zoomWrites.then(async () => {
      if (settingsStore.firstRun || settingsStore.error) return;
      const value = action === "reset" ? undefined : Math.max(desktopZoom.minimum, Math.min(desktopZoom.maximum,
        Number((readDesktopZoom(settingsStore.values) + (action === "in" ? desktopZoom.step : -desktopZoom.step)).toFixed(10))));
      await settingsStore.update("desktop.zoomFactor", value);
    }).catch(() => connection.post({ type: "toast", level: "error", message: "Could not save Desktop zoom." }));
  });
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
  const unsubscribeVisibility = transport.onVisibility((value) => visibility.fire(value));

  const requiresExitConfirmation = (): boolean => registry.snapshot().sessions.some((session) => {
    const view = registry.sessionView(session.id);
    return session.requiresUserInput || ["queued", "starting", "running", "stopping"].includes(session.status)
      || Boolean(view?.isStreaming || view?.isCompacting || view?.isForking || view?.isNavigatingTree);
  });

  let disposal: Promise<void> | undefined;
  const dispose = (): Promise<void> => disposal ??= (async () => {
    disposed = true;
    resume.dispose();
    navigation.dispose();
    interactions.dispose();
    for (const unsubscribe of listeners) unsubscribe();
    unsubscribeVisibility();
    unsubscribeProjects();
    unsubscribeState();
    unsubscribeSettings();
    unsubscribeSettingsAction();
    await zoomWrites;
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
  try {
    await navigation.initialize({ explicitProjectSelection: Boolean(firstStartupProject) });
    await registry.ensureInitialSession();
  } catch (error) {
    await dispose().catch(() => undefined);
    throw error;
  }
  return { registry, projects, connection, settingsStore, stateStore, navigation, requiresExitConfirmation, dispose };
}
