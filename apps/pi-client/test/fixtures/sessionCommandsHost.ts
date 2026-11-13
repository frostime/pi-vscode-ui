import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL as NodeURL } from "node:url";

import { VSCODE_CLIENT_UI_CAPABILITIES } from "../../src/shared/model/clientUiCapabilities.js";
import type { SessionViewModel } from "../../src/shared/model/sessionViewModel.js";
import type { ClientHost, HostEventEmitter, HostQuickPickItem, HostQuickPickOptions } from "../../src/host/clientHost.js";
import { SessionRegistry } from "../../src/host/SessionRegistry.js";

class Emitter<T> implements HostEventEmitter<T> {
  readonly #listeners = new Set<(value: T) => void>();
  readonly event = (listener: (value: T) => void) => {
    this.#listeners.add(listener);
    return { dispose: () => { this.#listeners.delete(listener); } };
  };
  fire(value: T): void { for (const listener of this.#listeners) listener(value); }
  dispose(): void { this.#listeners.clear(); }
}

type QuickPickChoice = (items: readonly HostQuickPickItem[], options: HostQuickPickOptions | undefined) => HostQuickPickItem | undefined;

/** Real Registry and Runtime over the scripted `session-commands-pi.cjs` child; only native UI is replaced. */
export async function sessionCommandsHost(piArguments: string[] = [], { adapters = true }: { adapters?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "frostpi-session-commands-"));
  const treeAdapterLoads = adapters && !piArguments.includes("--adapters-not-loaded");
  const errors: unknown[] = [];
  const stored = new Map<string, unknown>();
  /** Answers for the next quick picks, in order; an unanswered pick is dismissed. */
  const quickPicks: QuickPickChoice[] = [];
  const shownQuickPicks: Array<{ title: string | undefined; labels: string[] }> = [];
  const warningDialogs: string[] = [];
  let warningDialogAnswer: string | undefined = "first-button";
  const configuration: Record<string, unknown> = {
    "pi.executable": fileURLToPath(new NodeURL("./session-commands-pi.cjs", import.meta.url)),
    "pi.arguments": piArguments,
    "questionTool.enabled": false,
  };
  const host: ClientHost = {
    capabilities: VSCODE_CLIENT_UI_CAPABILITIES,
    createEventEmitter: <T>() => new Emitter<T>(), clientVersion: () => "test",
    storage: {
      get: <T>(key: string) => stored.get(key) as T | undefined,
      update: (key: string, value: unknown) => { stored.set(key, value); return Promise.resolve(); },
    },
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
      showWarningDialog: (message, buttons) => {
        warningDialogs.push(message);
        return Promise.resolve(warningDialogAnswer === "first-button" ? buttons[0] : warningDialogAnswer);
      },
      showActionsDialog: () => Promise.resolve(undefined),
      withProgress: (_title, work) => work(),
      showQuickPick: <T extends HostQuickPickItem>(items: readonly (T | { kind: "separator"; label: string })[], options?: HostQuickPickOptions) => {
        const choices = items.filter((item): item is T => !("kind" in item));
        shownQuickPicks.push({ title: options?.title, labels: choices.map((item) => item.label) });
        return Promise.resolve(quickPicks.shift()?.(choices, options) as T | undefined);
      },
      showInputBox: () => Promise.resolve(undefined),
    },
    editor: {},
  };
  const logger = { info() {}, error: (message: string, error?: unknown) => { errors.push([message, error]); } };
  const discoveries: string[] = [];
  const registry = new SessionRegistry(host, {
    logger,
    ...(adapters ? {
      sessionTreeArtifactPath: join(directory, "session-tree.js"),
      sideQuestionArtifactPath: join(directory, "side-question.js"),
    } : {}),
    discoverWorkingDirectories: (cwd) => {
      discoveries.push(cwd);
      return Promise.resolve({ authoritative: false, directories: [
        { cwd: directory, workspaceFolderCwd: directory, directoryName: "test", isCurrent: true },
      ] });
    },
  });

  const view = (sessionId: string): SessionViewModel => {
    const session = registry.sessionView(sessionId);
    if (!session) throw new Error(`Session ${sessionId} is not registered.`);
    return session;
  };
  const waitFor = async (predicate: () => boolean, timeoutMs = 4000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error("Timed out waiting for session-command test state");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  return {
    directory, registry, errors, quickPicks, shownQuickPicks, warningDialogs, discoveries, view, waitFor,
    answerWarningDialogs(answer: "first-button" | undefined): void { warningDialogAnswer = answer; },
    persistedSessions(): Array<{ id: string; title: string; sessionFile?: string }> {
      const value = [...stored.values()].at(-1) as { sessions?: Array<{ id: string; title: string; sessionFile?: string }> } | undefined;
      return value?.sessions ?? [];
    },
    /** Resolves once the Host has read and applied every answer the fake adapter wrote. */
    async sideQuestionAnswersConsumed(): Promise<void> {
      const list = join(directory, "side-question-result-dirs");
      const unread = (): number => existsSync(list)
        ? readFileSync(list, "utf8").split("\n").filter(Boolean)
            .reduce((count, resultDirectory) => count + (existsSync(resultDirectory) ? readdirSync(resultDirectory).length : 0), 0)
        : 0;
      await waitFor(() => unread() === 0);
      // A file is gone before its reader's continuation runs: give the event loop two turns.
      for (let turn = 0; turn < 2; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    },
    /** A started Session with its command list and models loaded. */
    async startSession(ephemeral = false): Promise<string> {
      const sessionId = await registry.createSession(ephemeral);
      if (!sessionId) throw new Error("Test session was not created.");
      await waitFor(() => view(sessionId).status === "ready" && view(sessionId).availableModels.length > 0
        && view(sessionId).commands.length > 0 && view(sessionId).sessionTreeAvailable === treeAdapterLoads);
      return sessionId;
    },
    /** Sends a prompt and waits until its turn is persisted and settled. */
    async converse(sessionId: string, text: string): Promise<void> {
      await registry.sendPrompt(sessionId, text, []);
      await waitFor(() => {
        const session = view(sessionId);
        return !session.isStreaming && session.status === "ready" && userPrompts(session).at(-1) === text
          && session.conversationItems.at(-1)?.type === "turn" && turnStatus(session) === "completed";
      });
    },
    async dispose(): Promise<void> {
      await registry.dispose();
      // This exact directory was created above solely for this controlled child.
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export function userPrompts(session: SessionViewModel): string[] {
  return session.conversationItems.flatMap((item) => item.type === "turn" && item.userMessage
    ? [item.userMessage.blocks.map((block) => block.type === "text" ? block.text : "").join("")]
    : []);
}

function turnStatus(session: SessionViewModel): string | undefined {
  const last = session.conversationItems.at(-1);
  return last?.type === "turn" ? last.status : undefined;
}
