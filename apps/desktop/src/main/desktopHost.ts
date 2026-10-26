import { clipboard, dialog, shell } from "electron";
import type { BrowserWindow, MessageBoxOptions, OpenDialogOptions } from "electron";
import type {
  ClientHost,
  HostConfiguration,
  HostEventEmitter,
  HostMemento,
  HostUri,
  HostWorkspaceFolder,
} from "@frostime/pi-client/host";

import type { DesktopInteractions } from "./dialogs.js";
import type { DesktopResume } from "./DesktopResume.js";
import type { DesktopProjects } from "./desktopProjects.js";
import type { DesktopSettingsStore } from "./settings/DesktopSettingsStore.js";
import { relatedVscodeSettingDefinitions, type DesktopSettingsTarget } from "../shared/desktopSettings.js";
import { DESKTOP_CLIENT_UI_CAPABILITIES } from "../shared/desktopCapabilities.js";
import { openReferencedLocation } from "./openReferencedLocation.js";

export interface DesktopHostOptions {
  /** Current window for native dialogs and focus; a getter is allowed (windows are created lazily). */
  window: BrowserWindow | (() => BrowserWindow | null | undefined);
  projects: DesktopProjects;
  /** Renderer-bridge quick pick/input (DesktopDialogs). */
  interactions: DesktopInteractions;
  /** Tracks only interactions inside the Desktop Resume action's async scope. */
  resume?: DesktopResume;
  /**
   * Explicit in-memory settings for isolated fixtures. The application uses settingsStore.
   */
  settings?: Record<string, unknown>;
  settingsStore?: DesktopSettingsStore;
  /** Application state storage; isolated fixtures can keep the in-memory default. */
  storage?: HostMemento;
  clientVersion?: string;
  /** Desktop entry maps Open Folder to Project registration, not an editor or OS reveal. */
  openFolder?: (fsPath?: string) => Promise<void>;
  openSettings?: (target: DesktopSettingsTarget) => Promise<void>;
}

/**
 * Desktop adapter for the shared client backend's ClientHost.
 * Native Electron capabilities and external file opening are bound here; IDE-only
 * integrations stay absent so the shared dispatcher fails those actions explicitly.
 */
export function createDesktopHost(options: DesktopHostOptions): ClientHost {
  const readSettings = (): Record<string, unknown> => options.settingsStore?.values ?? options.settings ?? {};
  const openSettings = options.openSettings;
  const resumeSelection = <T>(selection: "session" | "file" | "confirmation", work: () => Promise<T>): Promise<T> =>
    options.resume ? options.resume.choose(selection, work) : work();
  rejectUnsupportedProxyMode(readSettings());
  const resolveWindow = (): BrowserWindow | undefined => {
    const value = typeof options.window === "function" ? options.window() : options.window;
    return value && !value.isDestroyed() ? value : undefined;
  };

  return {
    capabilities: DESKTOP_CLIENT_UI_CAPABILITIES,
    createEventEmitter: <T>() => createInMemoryEventEmitter<T>(),
    clientVersion: () => options.clientVersion ?? "unknown",
    storage: options.storage ?? createInMemoryMemento(),
    proxyCredentials: { get: () => Promise.resolve(undefined) },
    configuration: {
      getConfiguration: (section: string): HostConfiguration => ({
        get: (<T>(key: string, fallback: T): T => {
          const settings = readSettings();
          const fullKey = `${section}.${key}`;
          const override = settings[fullKey];
          const definition = relatedVscodeSettingDefinitions[fullKey];
          // VS Code merges object settings with their defaults; false overrides disable a pattern.
          if (definition?.type === "object" && override && typeof override === "object") {
            return { ...(definition.default as object), ...override } as T;
          }
          if (override !== undefined) return override as T;
          return definition ? structuredClone(definition.default) as T : fallback;
        }) as HostConfiguration["get"],
        update: (key, value, target) => {
          if (target && target !== "global") throw new Error("Desktop settings are application-wide.");
          if (!options.settingsStore) throw new Error("This isolated Desktop host does not support settings writes.");
          return options.settingsStore.update(`${section}.${key}`, value);
        },
      }),
    },
    workspace: {
      // Every registered Project root stays a stable workspaceFolder across anchor changes.
      getWorkspaceFolders: () => options.projects.list().map((project) => desktopFolder(project.cwd, project.name)),
      // Explicit selected Project; nothing falls back implicitly.
      activeWorkspaceFolder: () => {
        const selected = options.projects.selected;
        return selected ? desktopFolder(selected.cwd, selected.name) : undefined;
      },
    },
    window: {
      focused: () => resolveWindow()?.isFocused() ?? false,
      showInformation: (message) => void showMessageBox(resolveWindow(), { type: "info", message }),
      showWarning: (message) => void showMessageBox(resolveWindow(), { type: "warning", message }),
      showError: (message) => void showMessageBox(resolveWindow(), { type: "error", message }),
      showWarningDialog: (message, actions) => resumeSelection("confirmation", () => showActionsMessageBox(resolveWindow(), "warning", message, actions)),
      showActionsDialog: (message, actions) => resumeSelection("confirmation", () => showActionsMessageBox(resolveWindow(), "info", message, actions)),
      withProgress: (_title, work) => work(),
      showQuickPick: (items, pickOptions) => resumeSelection("session", () => options.interactions.showQuickPick(items, pickOptions)),
      showInputBox: (inputOptions) => options.interactions.showInputBox(inputOptions),
      showOpenFileDialog: (dialogOptions) => resumeSelection("file", async () => {
        const window = resolveWindow();
        if (!window) return undefined;
        const openOptions: OpenDialogOptions = { properties: ["openFile"] };
        if (dialogOptions.title !== undefined) openOptions.title = dialogOptions.title;
        if (dialogOptions.defaultFsPath !== undefined) openOptions.defaultPath = dialogOptions.defaultFsPath;
        if (dialogOptions.filters !== undefined) {
          openOptions.filters = Object.entries(dialogOptions.filters).map(([name, extensions]) => ({ name, extensions: [...extensions] }));
        }
        const result = await dialog.showOpenDialog(window, openOptions);
        if (result.canceled) return undefined;
        return result.filePaths?.map((fsPath) => desktopUri(fsPath));
      }),
    },
    editor: {
      writeClipboard: async (text) => {
        await clipboard.writeText(text);
      },
      openExternalUrl: async (url) => {
        await shell.openExternal(url);
      },
      openReferencedLocation,
      ...(options.openFolder ? { openFolder: options.openFolder } : {}),
      ...(openSettings ? {
        openSettings: (query: string) => {
          // The shared dispatcher currently requests the extension's full settings view.
          if (query !== "@ext:frostime.frostpi") throw new Error("This VS Code settings query is not supported in Desktop.");
          return openSettings("all");
        },
        openProxySettings: () => openSettings("frostpi.network.proxy.mode"),
        configurePiExecutable: () => openSettings("frostpi.pi.executable"),
      } : {}),
    },
  };
}

function desktopFolder(cwd: string, name: string): HostWorkspaceFolder {
  return { name, uri: desktopUri(cwd) };
}

function desktopUri(fsPath: string): HostUri {
  return { fsPath, toString: () => fsPath };
}

function createInMemoryMemento(): HostMemento {
  const values = new Map<string, unknown>();
  return {
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: <T>(key: string, value: T) => {
      values.set(key, value);
      return Promise.resolve();
    },
  };
}

function createInMemoryEventEmitter<T>(): HostEventEmitter<T> {
  const listeners = new Set<(value: T) => void>();
  return {
    event: (listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire: (value) => {
      for (const listener of listeners) listener(value);
    },
    dispose: () => listeners.clear(),
  };
}

/**
 * The `vscode` proxy mode means "read VS Code's http.proxy", which has no meaning on Desktop.
 * Rejecting here keeps shared code honest instead of silently treating it as inherit.
 */
function rejectUnsupportedProxyMode(settings: Record<string, unknown>): void {
  const mode = settings["frostpi.network.proxy.mode"] ?? settings["network.proxy.mode"];
  if (mode === "vscode") {
    throw new Error("frostpi.network.proxy.mode 'vscode' requires VS Code. Use 'inherit', 'custom', or 'direct' on Desktop.");
  }
}

function showMessageBox(window: BrowserWindow | undefined, message: { type: "info" | "warning" | "error"; message: string }): void {
  if (!window) return;
  void dialog.showMessageBox(window, message).catch(() => undefined);
}

/** Modal and non-modal native confirmations resolve the clicked action label, or undefined on dismissal. */
function showActionsMessageBox(
  window: BrowserWindow | undefined,
  type: "warning" | "info",
  message: string,
  actions: readonly string[],
): Promise<string | undefined> {
  if (!window) return Promise.resolve(undefined);
  const options: MessageBoxOptions = {
    type,
    message,
    buttons: [...actions, "Cancel"],
    cancelId: actions.length,
    noLink: true,
  };
  return dialog.showMessageBox(window, options).then((result) => result.response < actions.length ? actions[result.response] : undefined);
}
