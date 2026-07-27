import { isAbsolute, relative } from "node:path";

import * as vscode from "vscode";

import { BRIDGE_VERSION } from "../../shared/bridge/bridgeVersion.js";
import type { HostToWebviewPayload, WorkspaceDeltaView } from "../../shared/bridge/hostToWebview.js";
import type { ConversationItemView } from "../../shared/model/conversationModel.js";
import type { SessionViewModel } from "../../shared/model/sessionViewModel.js";
import { collectionDelta } from "../../shared/bridge/collectionDelta.js";
import { webviewToHostSchema, type WebviewToHostMessage } from "../../shared/bridge/webviewToHost.js";
import { captureActiveFileReference } from "../editor-context/captureActiveFile.js";
import { ComposerExternalEditor } from "../editor-context/ComposerExternalEditor.js";
import { listEditorMentionSpecials } from "../editor-context/editorMentionSpecials.js";
import { readConfiguration } from "../configuration/readConfiguration.js";
import { readChatTypography } from "../configuration/readChatTypography.js";
import { workspaceUriForPath } from "../configuration/workspaceScope.js";
import { captureActiveSelection } from "../editor-context/captureSelection.js";
import { openReferencedLocation } from "../editor-context/openReferencedLocation.js";
import { exportDiagnostics } from "../diagnostics/exportDiagnostics.js";
import type { DiagnosticLogger } from "../diagnostics/DiagnosticLogger.js";
import { openFileDiff } from "../file-changes/GitBaseContentProvider.js";
import type { SessionRegistry } from "../sessions/SessionRegistry.js";
import { WorkspaceFileSearch, type WorkspaceFileExcludeRule } from "../workspace-files/WorkspaceFileSearch.js";

interface Identified {
  id: string;
}


export class WebviewBridge implements vscode.Disposable {
  readonly #disposables: vscode.Disposable[] = [];
  readonly #registry: SessionRegistry;
  readonly #logger: DiagnosticLogger;
  readonly #fileSearch: WorkspaceFileSearch;
  readonly #composerEditor: ComposerExternalEditor;

  #webview: vscode.Webview | null = null;
  #webviewMessageDisposable: vscode.Disposable | null = null;
  #cachedActiveSessionId: string | null = null;
  #conversationItemOrder: string[] = [];
  #conversationItemRefs = new Map<string, ConversationItemView>();
  readonly #pendingComposerText = new Map<string, string>();

  constructor(registry: SessionRegistry, logger: DiagnosticLogger) {
    this.#registry = registry;
    this.#logger = logger;
    this.#fileSearch = new WorkspaceFileSearch({
      onLegacyFd: (fd) => {
        void vscode.window.showWarningMessage(
          `FrostPi found fd ${fd.version}. File completion remains available, but directory suggestions require fd 10.0.0 or newer.`,
        );
      },
    });
    this.#composerEditor = new ComposerExternalEditor(
      (result) => {
        this.#pendingComposerText.set(result.sessionId, result.text);
        void this.#deliverComposerText(result.sessionId).catch((error) => {
          this.#logger.error("Failed to apply composer editor draft", error);
          this.post({ type: "toast", level: "error", message: error instanceof Error ? error.message : String(error) });
        });
      },
      () => this.post({ type: "toast", level: "info", message: "Finish the open composer editor tab first." }),
    );
    this.#disposables.push(
      registry.onDidChange(() => this.#postWorkspaceUpdate()),
      registry.onDidToast((toast) => this.post({ type: "toast", ...toast })),
      registry.onDidSetComposerText(({ sessionId, text }) => this.post({ type: "setComposerText", sessionId, text })),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (chatTypographyChanged(event)) this.#postChatTypography();
      }),
      this.#composerEditor,
    );
  }

  attach(webview: vscode.Webview): void {
    this.#webviewMessageDisposable?.dispose();
    this.#webview = webview;
    this.#resetCache(null);
    this.#webviewMessageDisposable = webview.onDidReceiveMessage((raw: unknown) => {
      void this.#receive(raw);
    });
    // A remounted Webview may not have sent ready yet; keep pending until then.
  }

  detach(webview: vscode.Webview): void {
    if (this.#webview !== webview) return;
    this.#webviewMessageDisposable?.dispose();
    this.#webviewMessageDisposable = null;
    this.#webview = null;
    this.#resetCache(null);
  }

  focusComposer(): void {
    this.post({ type: "focusComposer" });
  }

  insertPromptText(text: string): void {
    this.post({ type: "insertPromptText", text });
  }

  post(message: HostToWebviewPayload): void {
    if (!this.#webview) return;
    void this.#webview.postMessage({ ...message, bridgeVersion: BRIDGE_VERSION });
  }

  async #deliverComposerText(sessionId: string): Promise<void> {
    const text = this.#pendingComposerText.get(sessionId);
    if (text === undefined) return;
    // Focus the sidebar first so a hidden Webview is alive before draft replacement arrives.
    await vscode.commands.executeCommand("frostpi.focus");
    if (!this.#webview) return;
    this.#pendingComposerText.delete(sessionId);
    this.post({ type: "setComposerText", sessionId, text });
    this.focusComposer();
    this.#logger.info(`Applied composer editor draft for session ${sessionId} (${text.length} chars)`);
  }

  #flushPendingComposerText(): void {
    for (const sessionId of [...this.#pendingComposerText.keys()]) {
      void this.#deliverComposerText(sessionId).catch((error) => {
        this.#logger.error("Failed to flush composer editor draft", error);
      });
    }
  }

  dispose(): void {
    this.#webviewMessageDisposable?.dispose();
    for (const disposable of this.#disposables) disposable.dispose();
    this.#fileSearch.dispose();
  }

  #postSnapshot(): void {
    const workspace = this.#registry.snapshot();
    this.#resetCache(workspace.activeSession);
    this.post({ type: "snapshot", workspace });
  }

  #postChatTypography(): void {
    this.post({ type: "setChatTypography", typography: readChatTypography(vscode.workspace.getConfiguration("chat")) });
  }

  #postWorkspaceUpdate(): void {
    if (!this.#webview) return;
    const workspace = this.#registry.snapshot();
    if (workspace.activeSessionId !== this.#cachedActiveSessionId) {
      this.#postSnapshot();
      return;
    }

    const active = workspace.activeSession;
    const delta: WorkspaceDeltaView = {
      workspaceName: workspace.workspaceName,
      workspacePath: workspace.workspacePath,
      sessions: workspace.sessions,
      activeSessionId: workspace.activeSessionId,
      piAvailable: workspace.piAvailable,
      ...(workspace.piError ? { piError: workspace.piError } : {}),
      activeSession: active ? this.#sessionDelta(active) : null,
    };
    this.post({ type: "workspaceDelta", workspace: delta });
  }

  #sessionDelta(session: SessionViewModel): NonNullable<WorkspaceDeltaView["activeSession"]> {
    const { conversationItems, ...base } = session;
    const conversationDelta = collectionDelta(
      this.#conversationItemOrder,
      this.#conversationItemRefs,
      conversationItems,
    );
    this.#conversationItemOrder = conversationItems.map((item) => item.id);
    this.#conversationItemRefs = referenceMap(conversationItems);
    return { base, conversationItems: conversationDelta };
  }

  #resetCache(session: SessionViewModel | null): void {
    this.#cachedActiveSessionId = session?.id ?? null;
    this.#conversationItemOrder = session?.conversationItems.map((item) => item.id) ?? [];
    this.#conversationItemRefs = referenceMap(session?.conversationItems ?? []);
  }

  async #receive(raw: unknown): Promise<void> {
    const parsed = webviewToHostSchema.safeParse(raw);
    if (!parsed.success) {
      this.#logger.error("Rejected invalid Webview message", parsed.error);
      return;
    }
    try {
      await this.#dispatch(parsed.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#logger.error(`Webview action ${parsed.data.type} failed`, error);
      this.post({ type: "toast", level: "error", message });
    }
  }

  async #dispatch(message: WebviewToHostMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        this.#postSnapshot();
        this.#postChatTypography();
        this.#flushPendingComposerText();
        break;
      case "openFolder":
        await vscode.commands.executeCommand("vscode.openFolder");
        break;
      case "createSession":
        await this.#registry.createSession();
        break;
      case "resumeSession":
        await this.#registry.resumeSession();
        break;
      case "openComposerEditor":
        await this.#composerEditor.open(message.sessionId, message.text);
        break;
      case "activateSession":
        await this.#registry.activateSession(message.sessionId);
        break;
      case "closeSession":
        await this.#registry.closeSession(message.sessionId);
        break;
      case "renameSession":
        await this.#registry.rename(message.sessionId, message.name);
        break;
      case "copyText":
        await vscode.env.clipboard.writeText(message.text);
        this.post({ type: "toast", level: "info", message: "Copied to clipboard." });
        break;
      case "sendPrompt":
        try {
          await this.#registry.sendPrompt(message.sessionId, message.text, message.images);
          this.post({ type: "promptResult", requestId: message.requestId, ok: true });
        } catch (error) {
          const errorText = error instanceof Error ? error.message : String(error);
          this.post({ type: "promptResult", requestId: message.requestId, ok: false, error: errorText });
        }
        break;
      case "abort":
        await this.#registry.abort(message.sessionId);
        break;
      case "cancelFork":
        await this.#registry.cancelFork(message.sessionId);
        break;
      case "branchHere":
        await this.#registry.branchHere(message.sessionId, message.entryId, message.hasDraft);
        break;
      case "switchBranch":
        await this.#registry.switchBranch(message.sessionId, message.branchPointId, message.hasDraft);
        break;
      case "forkMessage":
        try {
          const result = await this.#registry.forkMessage(message.sessionId, message.entryId);
          this.post({ type: "forkResult", requestId: message.requestId, ok: true, ...result });
        } catch (error) {
          const errorText = error instanceof Error ? error.message : String(error);
          this.post({ type: "forkResult", requestId: message.requestId, ok: false, error: errorText });
        }
        break;
      case "setModel":
        await this.#registry.setModel(message.sessionId, message.provider, message.modelId);
        break;
      case "setThinkingLevel":
        await this.#registry.setThinkingLevel(message.sessionId, message.level);
        break;
      case "respondExtensionUi":
        await this.#registry.respondExtensionUi(message.sessionId, message.requestId, message.response);
        break;
      case "respondQuestion":
        await this.#registry.respondQuestion(message.sessionId, message.requestId, message.response);
        break;
      case "addSelection": {
        const text = captureActiveSelection();
        if (!text) throw new Error("Open a workspace file first.");
        this.insertPromptText(`${text} `);
        break;
      }
      case "addCurrentFile": {
        const text = captureActiveFileReference();
        if (!text) throw new Error("Open a workspace file first.");
        this.insertPromptText(`${text} `);
        break;
      }
      case "openFile":
        await openReferencedLocation(message, this.#registry.snapshot().activeSession?.cwd);
        break;
      case "openDiff":
        await openFileDiff(message.path);
        break;
      case "openExternal": {
        const uri = vscode.Uri.parse(message.url, true);
        if (uri.scheme !== "https" && uri.scheme !== "http") throw new Error("Only HTTP(S) links can be opened.");
        await vscode.env.openExternal(uri);
        break;
      }
      case "refreshCommands":
        await this.#registry.refreshCommands(message.sessionId);
        break;
      case "checkPiIntegration":
        await this.#registry.checkPiIntegration(message.sessionId);
        break;
      case "refreshModels":
        await this.#registry.refreshModels(message.sessionId);
        break;
      case "loadHistory":
        await this.#registry.loadHistory(message.sessionId);
        break;
      case "searchWorkspaceFiles": {
        try {
          const session = this.#registry.snapshot().activeSession;
          if (!session || session.id !== message.sessionId) throw new Error("The active session changed before file search completed.");
          const scope = workspaceUriForPath(session.cwd);
          const configuration = readConfiguration(scope);
          const items = await this.#fileSearch.search(
            session.cwd,
            message.query,
            message.limit,
            workspaceFileBoosts(session),
            {
              excludeRules: workspaceFileExcludeRules(scope, configuration.fileMentionRespectSearchExclude),
              respectIgnoreFiles: configuration.fileMentionRespectIgnoreFiles,
              followSymlinks: configuration.fileMentionFollowSymlinks,
            },
          );
          const specials = listEditorMentionSpecials(message.query);
          this.post({
            type: "workspaceFileSuggestions",
            requestId: message.requestId,
            items,
            ...(specials.length ? { specials } : {}),
          });
        } catch (error) {
          const errorText = error instanceof Error ? error.message : String(error);
          this.#logger.error("Workspace file completion failed", error);
          this.post({ type: "workspaceFileSuggestions", requestId: message.requestId, items: [], error: errorText });
        }
        break;
      }
      case "openSettings":
        await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:frostime.frostpi");
        break;
      case "openProxySettings":
        await vscode.commands.executeCommand("frostpi.configureProxy");
        break;
      case "restartSession":
        await this.#registry.retrySession(message.sessionId);
        break;
      case "configureExecutable":
        await configureExecutable();
        break;
      case "exportDiagnostics":
        await exportDiagnostics(this.#logger, this.#registry.diagnosticsSummary());
        break;
      case "retryStart":
        await this.#registry.retrySession(message.sessionId);
        break;
    }
  }
}

type ConfiguredExclude = boolean | { when?: string };

function chatTypographyChanged(event: vscode.ConfigurationChangeEvent): boolean {
  return event.affectsConfiguration("chat.fontFamily")
    || event.affectsConfiguration("chat.fontSize")
    || event.affectsConfiguration("chat.editor.fontFamily")
    || event.affectsConfiguration("chat.editor.fontSize");
}

function workspaceFileExcludeRules(scope: vscode.Uri, respectSearchExclude: boolean): WorkspaceFileExcludeRule[] {
  const files = vscode.workspace.getConfiguration("files", scope).get<Record<string, ConfiguredExclude>>("exclude", {});
  const rules = Object.entries(files)
    .filter(([, value]) => value === true || (typeof value === "object" && value !== null))
    .map(([pattern, value]) => ({
      pattern,
      ...(typeof value === "object" && value.when ? { when: value.when } : {}),
    }));
  if (!respectSearchExclude) return rules;

  const search = vscode.workspace.getConfiguration("search", scope).get<Record<string, ConfiguredExclude>>("exclude", {});
  for (const [pattern, value] of Object.entries(search)) {
    if (value === true || (typeof value === "object" && value !== null)) rules.push({ pattern });
  }
  return rules;
}

function workspaceFileBoosts(session: SessionViewModel): Set<string> {
  const boosts = new Set<string>();
  const add = (path: string | undefined): void => {
    if (!path) return;
    const relativePath = (isAbsolute(path) ? relative(session.cwd, path) : path).replaceAll("\\", "/");
    if (relativePath && !relativePath.startsWith("../")) boosts.add(relativePath);
  };
  add(vscode.window.activeTextEditor?.document.uri.fsPath);
  for (const editor of vscode.window.visibleTextEditors) add(editor.document.uri.fsPath);
  for (const item of session.conversationItems) {
    if (item.type !== "turn") continue;
    for (const turnItem of item.items) {
      if (turnItem.type === "tool") add(turnItem.tool.filePath);
    }
  }
  return boosts;
}

function referenceMap<T extends Identified>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

async function configureExecutable(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration("frostpi");
  const current = configuration.get<string>("pi.executable", "");
  const value = await vscode.window.showInputBox({
    title: "Configure Pi executable",
    prompt: "Enter `pi`, an absolute executable path, or Pi's compiled cli.js path. Leave blank for PATH discovery.",
    value: current,
    ignoreFocusOut: true,
  });
  if (value === undefined) return;
  await configuration.update("pi.executable", value.trim(), vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage("FrostPi executable setting updated. Restart failed sessions to apply it.");
}
