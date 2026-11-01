import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL as NodeURL } from "node:url";

import { BRIDGE_VERSION } from "../../src/shared/bridge/bridgeVersion.js";
import type { HostToWebviewMessage } from "../../src/shared/bridge/hostToWebview.js";
import type { WebviewToHostPayload } from "../../src/shared/bridge/webviewToHost.js";
import { VSCODE_CLIENT_UI_CAPABILITIES } from "../../src/shared/model/clientUiCapabilities.js";
import type { WebviewSurface } from "../../src/shared/model/webviewPresentationModel.js";
import type { ClientHost, HostEventEmitter } from "../../src/host/clientHost.js";
import { SessionRegistry } from "../../src/host/SessionRegistry.js";
import { ComposerDraftCache } from "../../src/host/bridge/ComposerDraftCache.js";
import { WebviewActionDispatcher } from "../../src/host/bridge/WebviewActionDispatcher.js";
import { WebviewConnection } from "../../src/host/bridge/WebviewConnection.js";
import { WorkspaceFileSearch } from "../../src/host/file-search/WorkspaceFileSearch.js";

class Emitter<T> implements HostEventEmitter<T> {
  readonly #listeners = new Set<(value: T) => void>();
  readonly event = (listener: (value: T) => void) => {
    this.#listeners.add(listener);
    return { dispose: () => { this.#listeners.delete(listener); } };
  };
  fire(value: T): void { for (const listener of this.#listeners) listener(value); }
  dispose(): void { this.#listeners.clear(); }
}

/** Real Host/Registry/Runtime/bridge with only native services and the Pi child replaced. */
export async function queuedRecoveryHost(runtime: "pi" | "oh-my-pi" = "pi", flags: (directory: string) => string[] = () => []) {
  const directory = await mkdtemp(join(tmpdir(), "frostpi-recovery-host-"));
  const errors: unknown[] = [];
  const executable = fileURLToPath(new NodeURL("./queued-pi.cjs", import.meta.url));
  const configuration: Record<string, unknown> = {
    "pi.executable": executable,
    "pi.runtimeCompatibility": runtime,
    "pi.arguments": [...flags(directory), ...(runtime === "oh-my-pi" ? ["--omp"] : [])],
    "questionTool.enabled": false,
  };
  const host: ClientHost = {
    capabilities: VSCODE_CLIENT_UI_CAPABILITIES,
    createEventEmitter: <T>() => new Emitter<T>(), clientVersion: () => "test",
    storage: { get: () => undefined, update: async () => {} },
    proxyCredentials: { get: () => Promise.resolve(undefined) },
    configuration: { getConfiguration: (section) => ({
      get: <T>(key: string, fallback?: T): T => ((section === "frostpi" ? configuration[key] : undefined) ?? fallback) as T,
      update: async () => {},
    }) },
    workspace: {
      getWorkspaceFolders: () => [{ name: "test", uri: { fsPath: directory, toString: () => directory } }],
      activeWorkspaceFolder: () => ({ name: "test", uri: { fsPath: directory, toString: () => directory } }),
    },
    window: {
      focused: () => true, showInformation() {}, showWarning() {}, showError() {},
      showWarningDialog: () => Promise.resolve("Close session"), showActionsDialog: () => Promise.resolve(undefined),
      withProgress: (_title, work) => work(), showQuickPick: () => Promise.resolve(undefined), showInputBox: () => Promise.resolve(undefined),
    },
    editor: {},
  };
  const logger = { info() {}, error: (message: string, error?: unknown) => { errors.push([message, error]); } };
  const registry = new SessionRegistry(host, {
    logger,
    discoverWorkingDirectories: () => Promise.resolve({ authoritative: false, directories: [
      { cwd: directory, workspaceFolderCwd: directory, directoryName: "test", isCurrent: true },
    ] }),
  });
  const drafts = new ComposerDraftCache(host);
  const panels = new Map<string, WebviewConnection>();
  const connections = new Set<WebviewConnection>();
  let sidebar: WebviewConnection | undefined;
  const dispatcher = new WebviewActionDispatcher({
    host, registry, logger, drafts, getProxyCredentials: () => Promise.resolve(undefined),
    openPanel() { throw new Error("Tests open a presentation explicitly."); },
    revealPanel() {}, openComposerEditor: () => Promise.resolve("opened" as const),
  });
  const ownsDraft = (id: string) => panels.has(id) || drafts.hasPendingSubmission(id) || drafts.hasPendingRecovery(id);
  registry.onDidChange(() => { for (const connection of connections) connection.refresh(); });
  drafts.onDidChange(({ sessionId, draft }) => {
    const panel = panels.get(sessionId);
    if (panel) panel.draftChanged(sessionId);
    else sidebar?.post({ type: "draftReplacement", sessionId, draft });
  });
  drafts.onDidOwnershipChange(() => { for (const connection of connections) connection.refresh(); });
  const sessionId = await registry.createSession();
  if (!sessionId) throw new Error("Test session was not created.");

  function presentation(surface: WebviewSurface = { kind: "sidebar" }) {
    const messages: HostToWebviewMessage[] = [];
    const listeners = new Set<(message: HostToWebviewMessage) => void>();
    let receive: ((message: unknown) => void) | undefined;
    const connection = new WebviewConnection(registry, {
      surface, isVisible: () => true,
      postMessage: (message) => {
        messages.push(message);
        for (const listener of listeners) listener(message);
        return Promise.resolve(true);
      },
      onDidReceiveMessage: (listener) => { receive = listener; return { dispose() { receive = undefined; } }; },
      onDidChangeVisibility: () => ({ dispose() {} }),
    }, dispatcher, drafts, logger, (id) => panels.has(id), ownsDraft, {
      fileSearch: new WorkspaceFileSearch(),
      readChatTypography: () => ({ message: { fontSize: 13 }, composer: { fontSize: 14 } }),
    });
    connections.add(connection);
    if (surface.kind === "panel") panels.set(surface.sessionId, connection);
    else sidebar = connection;
    return {
      connection, messages,
      send: (payload: WebviewToHostPayload) => receive?.({ ...payload, bridgeVersion: BRIDGE_VERSION }),
      transport: {
        postMessage: (message: unknown) => { receive?.(message); },
        onMessage: (listener: (message: HostToWebviewMessage) => void) => {
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
      },
      close() {
        connection.dispose();
        connections.delete(connection);
        if (surface.kind === "panel") {
          panels.delete(surface.sessionId);
          const draft = drafts.getIfPresent(surface.sessionId);
          if (draft) sidebar?.post({ type: "draftReplacement", sessionId: surface.sessionId, draft });
          sidebar?.refresh();
        }
      },
    };
  }
  return {
    directory, registry, drafts, sessionId, errors, presentation,
    async dispose() {
      await registry.dispose();
      for (const connection of connections) connection.dispose();
      drafts.dispose();
      // This exact directory was created above solely for this controlled child.
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export async function waitForRecovery(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for recovery test state");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
