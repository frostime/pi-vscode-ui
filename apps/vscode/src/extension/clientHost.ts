import * as vscode from "vscode";
import { VSCODE_CLIENT_UI_CAPABILITIES } from "@frostime/pi-client/shared/model/clientUiCapabilities";

import type {
  ClientHost,
  HostConfiguration,
  HostOpenFileDialogOptions,
  HostQuickPickItem,
  HostQuickPickOptions,
  HostQuickPickSeparator,
} from "@frostime/pi-client/host";

import { captureActiveFileReference } from "./composer/mentions/captureActiveFile.js";
import { captureActiveSelection } from "./composer/mentions/captureSelection.js";
import { listEditorMentionSpecials } from "./composer/mentions/editorMentionSpecials.js";
import { configurePiExecutable } from "./configuration/configurePiExecutable.js";
import { workspaceUriForPath } from "./configuration/workspaceScope.js";
import { openReferencedLocation } from "./conversation/openReferencedLocation.js";
import type { DiagnosticLogger } from "./diagnostics/DiagnosticLogger.js";
import { exportDiagnostics } from "./diagnostics/exportDiagnostics.js";
import { openFileDiff } from "./file-changes/GitBaseContentProvider.js";
import type { ProxySecretStore } from "./network/ProxySecretStore.js";
import { showWindowsToast } from "./notifications/showWindowsToast.js";

export interface ClientHostInputs {
  logger: DiagnosticLogger;
  proxyCredentials: ProxySecretStore;
}

/** vscode "Thenable" is structurally in-between Promise and PromiseLike; normalize it once. */
function toPromise<T>(thenable: { then: (onfulfilled: (value: T) => unknown, onrejected?: (reason: unknown) => unknown) => unknown }): Promise<T> {
  return new Promise((resolve, reject) => thenable.then(resolve, reject));
}

/** Assembles the VS Code implementation of the shared client backend's host interface. */
export function createClientHost(
  context: vscode.ExtensionContext,
  inputs: ClientHostInputs,
): ClientHost {
  return {
    capabilities: VSCODE_CLIENT_UI_CAPABILITIES,
    createEventEmitter: <T>() => new vscode.EventEmitter<T>(),
    clientVersion: () =>
      (vscode.extensions.getExtension("frostime.frostpi")?.packageJSON as { version?: string } | undefined)?.version ?? "unknown",
    // Memento's Thenable surface satisfies the PromiseLike-based HostMemento.
    storage: context.workspaceState,
    proxyCredentials: inputs.proxyCredentials,
    configuration: {
      getConfiguration: (section, scope) => {
        const config = vscode.workspace.getConfiguration(section, scope === undefined ? undefined : workspaceUriForPath(scope));
        return {
          get: (<T>(key: string, fallback: T) => config.get<T>(key, fallback)) as HostConfiguration["get"],
          update: (key, value, target) => toPromise(config.update(key, value, configurationTarget(target))),
        };
      },
    },
    workspace: {
      getWorkspaceFolders: () => vscode.workspace.workspaceFolders ?? [],
      // Exact legacy anchor: the active editor's workspace folder, else the first folder.
      activeWorkspaceFolder: () => activeWorkspaceFolder(),
      setSessionRunningContext: (value) => {
        void vscode.commands.executeCommand("setContext", "frostpi.sessionRunning", value);
      },
    },
    window: {
      focused: () => vscode.window.state.focused,
      showInformation: (message) => void vscode.window.showInformationMessage(message),
      showWarning: (message) => void vscode.window.showWarningMessage(message),
      showError: (message) => void vscode.window.showErrorMessage(message),
      showWarningDialog: (message, actions) => Promise.resolve<string | undefined>(vscode.window.showWarningMessage(message, { modal: true }, ...actions)),
      showActionsDialog: (message, actions) => Promise.resolve<string | undefined>(vscode.window.showWarningMessage(message, ...actions)),
      withProgress: (title, work) => toPromise(vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title }, () => work())),
      showQuickPick: async <T extends HostQuickPickItem>(items: readonly (T | HostQuickPickSeparator)[], options?: HostQuickPickOptions) => {
        const selected = await vscode.window.showQuickPick(toVsCodeQuickPickItems(items), options);
        return selected as T | undefined;
      },
      showInputBox: (options) => Promise.resolve<string | undefined>(vscode.window.showInputBox(options)),
      showOpenFileDialog: (options) => showOpenFileDialog(options),
    },
    editor: {
      captureActiveSelection: () => captureActiveSelection(),
      captureActiveFileReference: () => captureActiveFileReference(),
      listEditorMentionSpecials: (query) => listEditorMentionSpecials(query),
      fileBoostPaths: () => [
        vscode.window.activeTextEditor?.document.uri.fsPath,
        ...vscode.window.visibleTextEditors.map((editor) => editor.document.uri.fsPath),
      ].filter((path): path is string => Boolean(path)),
      writeClipboard: (text) => toPromise(vscode.env.clipboard.writeText(text)).then(() => undefined),
      openExternalUrl: (url) => toPromise(vscode.env.openExternal(vscode.Uri.parse(url, true))).then(() => undefined),
      openFolder: (fsPath) => fsPath === undefined
        ? toPromise(vscode.commands.executeCommand("vscode.openFolder")).then(() => undefined)
        : toPromise(vscode.commands.executeCommand("vscode.openFolder", workspaceUriForPath(fsPath))).then(() => undefined),
      openSettings: (query) => toPromise(vscode.commands.executeCommand("workbench.action.openSettings", query)).then(() => undefined),
      openProxySettings: () => toPromise(vscode.commands.executeCommand("frostpi.configureProxy")).then(() => undefined),
      configurePiExecutable: () => configurePiExecutable(),
      openReferencedLocation: (message, cwd) => openReferencedLocation(message, cwd),
      openFileDiff: (path) => openFileDiff(path),
    },
    systemToast: (title, message) => {
      const nativeOptions = vscode.env.remoteName === undefined ? {} : { remoteName: vscode.env.remoteName };
      return showWindowsToast(title, message, nativeOptions);
    },
    exportDiagnostics: (summary) => exportDiagnostics(inputs.logger, summary),
  };
}

function configurationTarget(target?: "global" | "workspace" | "workspace-folder"): vscode.ConfigurationTarget | undefined {
  if (target === "global") return vscode.ConfigurationTarget.Global;
  if (target === "workspace") return vscode.ConfigurationTarget.Workspace;
  if (target === "workspace-folder") return vscode.ConfigurationTarget.WorkspaceFolder;
  return undefined;
}

function toVsCodeQuickPickItems(items: readonly (HostQuickPickItem | HostQuickPickSeparator)[]): vscode.QuickPickItem[] {
  return items.map((item) => {
    if ("kind" in item && item.kind === "separator") return { label: item.label, kind: vscode.QuickPickItemKind.Separator };
    return item as vscode.QuickPickItem;
  });
}

async function showOpenFileDialog(options: HostOpenFileDialogOptions): Promise<readonly { fsPath: string; toString(): string }[] | undefined> {
  const dialogOptions: vscode.OpenDialogOptions = {
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
  };
  if (options.title !== undefined) dialogOptions.title = options.title;
  if (options.defaultFsPath !== undefined) dialogOptions.defaultUri = workspaceUriForPath(options.defaultFsPath);
  if (options.filters !== undefined) dialogOptions.filters = options.filters as NonNullable<vscode.OpenDialogOptions["filters"]>;
  const files = await vscode.window.showOpenDialog(dialogOptions);
  if (!files) return undefined;
  return files.map((uri) => ({ fsPath: uri.fsPath, toString: uri.toString.bind(uri) }) satisfies { fsPath: string; toString(): string });
}

function activeWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const editorUri = vscode.window.activeTextEditor?.document.uri;
  return (editorUri ? vscode.workspace.getWorkspaceFolder(editorUri) : undefined) ?? vscode.workspace.workspaceFolders?.[0];
}
