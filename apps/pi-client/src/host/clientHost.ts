import type { ProxyCredentialsProvider } from "../core/network/proxyCredentials.js";
import type { WebviewToHostMessage } from "../shared/bridge/webviewToHost.js";
import type { EditorMentionSpecialView } from "../shared/model/workspaceFileModel.js";

/** The webview "open a referenced file" message, parsed by the host's editor service. */
export type HostOpenFileMessage = Extract<WebviewToHostMessage, { type: "openFile" }>;

/**
 * Subset of `vscode.Uri` the client backend relies on: configuration scopes and file dialogs.
 * Hosts supply their own URI/path objects; shared code consumes only this subset.
 */
export interface HostUri {
  readonly fsPath: string;
  toString(): string;
}

/**
 * Subset of `vscode.WorkspaceConfiguration` used by the shared configuration parsing.
 * The client owns every FrostPi key name and default once; hosts only supply typed reads.
 */
export interface HostConfiguration {
  get<T>(section: string, fallback: T): T;
  get<T>(section: string): T | undefined;
  /** Backs the Pi executable update flow; unsupported hosts must reject explicitly, not swallow. */
  update(section: string, value: unknown, target?: "global" | "workspace" | "workspace-folder"): PromiseLike<void>;
}

/** One hook, VS Code `workspace.getConfiguration` shaped; the scope is a plain cwd string. */
export interface HostConfigurationHooks {
  getConfiguration(section: string, scope?: string): HostConfiguration;
}

/** `vscode.Memento` subset: the SessionRegistry's persisted session collection. */
export interface HostMemento {
  get<T>(key: string): T | undefined;
  update<T>(key: string, value: T): PromiseLike<void>;
}

/** `vscode.EventEmitter` shape; hosts may map their own event implementation onto it. */
export interface HostEventEmitter<T> {
  readonly event: (listener: (value: T) => void) => { dispose(): void };
  fire(value: T): void;
  dispose(): void;
}

/** Registered root ("workspace folder"). Desktop: one per Project, stable across sessions. */
export interface HostWorkspaceFolder {
  readonly name: string;
  readonly uri: HostUri;
}

export interface HostQuickPickItem {
  label: string;
  description?: string;
  detail?: string;
  alwaysShow?: boolean;
}

export interface HostQuickPickSeparator {
  label: string;
  kind: "separator";
}

export interface HostQuickPickOptions {
  title?: string;
  placeHolder?: string;
  matchOnDescription?: boolean;
  matchOnDetail?: boolean;
  ignoreFocusOut?: boolean;
}

export interface HostInputBoxOptions {
  title?: string;
  prompt?: string;
  placeHolder?: string;
  value?: string;
  ignoreFocusOut?: boolean;
  validateInput?: (value: string) => string | undefined;
}

export interface HostOpenFileDialogOptions {
  title?: string;
  defaultFsPath?: string;
  filters?: Record<string, readonly string[]>;
}

export interface HostWorkspaceService {
  getWorkspaceFolders(): readonly HostWorkspaceFolder[];
  /** New/Resume anchor. VS Code: active editor's folder, else first folder (exact legacy logic). Desktop: the selected Project. */
  activeWorkspaceFolder(): HostWorkspaceFolder | undefined;
  /** VS Code context-key update; Desktop omits (registry then skips it silently). */
  setSessionRunningContext?(value: boolean): void;
}

export interface HostWindowService {
  /** Live focus state (vscode.window.state.focused); gates background notifications. */
  focused(): boolean;
  showInformation(message: string): void;
  showWarning(message: string): void;
  showError(message: string): void;
  /** Modal confirmation: resolves the clicked action, or undefined when dismissed. */
  showWarningDialog(message: string, actions: readonly string[]): Promise<string | undefined>;
  /** Non-modal message with action buttons (e.g. "Open folder"). */
  showActionsDialog(message: string, actions: readonly string[]): Promise<string | undefined>;
  withProgress<T>(title: string, work: () => Promise<T>): Promise<T>;
  showQuickPick<T extends HostQuickPickItem>(
    items: readonly (T | HostQuickPickSeparator)[],
    options?: HostQuickPickOptions,
  ): Promise<T | undefined>;
  showInputBox(options?: HostInputBoxOptions): Promise<string | undefined>;
  /** Resume "Browse for a session file…"; only offered when defined, so Desktop may leave it out. */
  showOpenFileDialog?(options: HostOpenFileDialogOptions): Promise<readonly HostUri[] | undefined>;
}

/**
 * Editor-integrated operations. Every member is optional; when the host leaves one out,
 * the corresponding webview action fails with an explicit "unsupported in this host" error.
 */
export interface HostEditorService {
  /** Active selection or current line, formatted as a file mention. */
  captureActiveSelection?(): string | undefined;
  captureActiveFileReference?(): string | undefined;
  /** Built-in @ completion rows (Selection / CurrentFile). */
  listEditorMentionSpecials?(query: string): readonly EditorMentionSpecialView[];
  /** Ranking boost paths from open editors; Desktop returns nothing for editor-free sessions. */
  fileBoostPaths?(): readonly string[];
  writeClipboard?(text: string): Promise<void>;
  /** Client validated the URL is http(s) before calling. */
  openExternalUrl?(url: string): Promise<void>;
  openFolder?(fsPath?: string): Promise<void>;
  openSettings?(query: string): Promise<void>;
  openProxySettings?(): Promise<void>;
  configurePiExecutable?(): Promise<void>;
  openReferencedLocation?(message: HostOpenFileMessage, cwd: string | undefined): Promise<void>;
  openFileDiff?(path: string): Promise<void>;
}

/**
 * One concentrated capability surface for the shared client backend.
 * VS Code-shaped on purpose (the extension is the reference host); hosts implement it
 * without importing `vscode`.
 */
export interface ClientHost {
  createEventEmitter<T>(): HostEventEmitter<T>;
  /** Bundled client version, e.g. the VSIX version; "unknown" is acceptable. */
  clientVersion(): string;
  /** Persisted state store for the session collection. */
  storage: HostMemento;
  proxyCredentials: ProxyCredentialsProvider;
  configuration: HostConfigurationHooks;
  workspace: HostWorkspaceService;
  window: HostWindowService;
  editor: HostEditorService;
  /** Native notification for unfocused input/completion/failure; false or absent → in-message fallback. */
  systemToast?(title: string, message: string): Promise<boolean>;
  /** Diagnostics export with host file access; absent = explicit failure of the action. */
  exportDiagnostics?(summary: string): Promise<void>;
}
