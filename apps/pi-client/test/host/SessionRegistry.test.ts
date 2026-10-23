import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

const fakePiFixture = () => fileURLToPath(new URL("../fixtures/fake-pi.cjs", import.meta.url));

import type { AgentTurnView, CompactionView } from "@frostime/pi-client/shared/model/conversationModel";
import type { SessionViewModel } from "@frostime/pi-client/shared/model/sessionViewModel";
import type * as SessionWorkingDirectoriesModule from "../../src/host/sessions/SessionWorkingDirectories.js";

const treePickerMocks = vi.hoisted(() => ({
  pickBranchEnd: vi.fn(),
  pickBranchSummary: vi.fn(),
  confirmDraftReplacement: vi.fn(),
}));

const hostMocks = vi.hoisted(() => ({
  showError: vi.fn(),
  showInformation: vi.fn(),
  showWarningDialog: vi.fn().mockResolvedValue("Close session"),
  showActionsDialog: vi.fn(),
  showInputBox: vi.fn(),
  systemToast: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../src/host/pickers/SessionTreePicker.js", () => treePickerMocks);
const testEnvironment = vi.hoisted(() => ({
  cwd: "",
  piExecutable: "",
  quickPickCwd: "",
  configurationScopes: [] as string[],
  experimentalNotificationsEnabled: true,
  windowFocused: true,
  startSessionOnOpenByCwd: new Map<string, boolean>(),
  projectFolders: undefined as readonly string[] | undefined,
  anchorProject: "",
}));

vi.mock("../../src/host/sessions/SessionWorkingDirectories.js", async (importOriginal) => {
  const actual = await importOriginal<typeof SessionWorkingDirectoriesModule>();
  return {
    ...actual,
    discoverSessionWorkingDirectories: (cwd: string) => Promise.resolve({
      authoritative: false,
      directories: [{ cwd, workspaceFolderCwd: cwd, directoryName: "workspace", isCurrent: true }],
    }),
  };
});


import type { ClientHost, HostEventEmitter } from "../../src/host/clientHost.js";
import type { RuntimeLogger } from "../../src/core/diagnostics/RuntimeLogger.js";

class TestEventEmitter<T> {
  readonly listeners = new Set<(value: T) => void>();
  readonly event = (listener: (value: T) => void) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(value: T): void { for (const listener of this.listeners) listener(value); }
  dispose(): void { this.listeners.clear(); }
}

function createTestHost(): { host: ClientHost; logger: { error: Mock<RuntimeLogger["error"]>; info: Mock<RuntimeLogger["info"]> } } {
  const logger = { error: vi.fn<RuntimeLogger["error"]>(), info: vi.fn<RuntimeLogger["info"]>() };
  const host = {
    createEventEmitter: <T>() => new TestEventEmitter<T>() as unknown as HostEventEmitter<T>,
    clientVersion: () => "test",
    storage: {
      get: vi.fn((): unknown => undefined),
      update: vi.fn((): Promise<void> => Promise.resolve()),
    },
    proxyCredentials: { get: () => Promise.resolve(undefined) },
    configuration: {
      getConfiguration: (section: string, scope?: string) => {
        if (section === "frostpi" && scope !== undefined) testEnvironment.configurationScopes.push(scope);
        return {
          get: <T>(key: string, fallback: T): T => {
            if (section === "frostpi" && key === "pi.executable") return testEnvironment.piExecutable as T;
            if (section === "frostpi" && key === "notifications.experimental.enabled") {
              return testEnvironment.experimentalNotificationsEnabled as T;
            }
            if (section === "frostpi" && key === "session.startOnOpen" && scope !== undefined) {
              const overridden = testEnvironment.startSessionOnOpenByCwd.get(scope);
              return (overridden ?? fallback) as T;
            }
            return fallback;
          },
          update: () => {
            throw new Error("Configuration updates are not part of the registry tests.");
          },
        };
      },
    },
    workspace: {
      getWorkspaceFolders: () => (testEnvironment.projectFolders ?? (testEnvironment.cwd ? [testEnvironment.cwd] : [])).map((folder) => ({
        name: folder,
        uri: { fsPath: folder, toString: () => folder },
      })),
      activeWorkspaceFolder: () => {
        const anchor = testEnvironment.projectFolders ? testEnvironment.anchorProject : testEnvironment.cwd;
        return anchor ? { name: anchor, uri: { fsPath: anchor, toString: () => anchor } } : undefined;
      },
    },
    window: {
      focused: () => testEnvironment.windowFocused,
      showInformation: hostMocks.showInformation,
      showWarning: vi.fn(),
      showError: hostMocks.showError,
      showWarningDialog: hostMocks.showWarningDialog,
      showActionsDialog: hostMocks.showActionsDialog,
      withProgress: (_title: string, work: () => Promise<never>) => work(),
      showQuickPick: (items: Array<{ directory?: { cwd: string } }>) => Promise.resolve(
        items.find((item) => item.directory?.cwd === testEnvironment.quickPickCwd),
      ) as never,
      showInputBox: hostMocks.showInputBox,
    },
    editor: {},
    systemToast: hostMocks.systemToast,
  } as unknown as ClientHost;
  return { host, logger };
}

const { SessionRegistry } = await import("../../src/host/SessionRegistry.js");

describe("FrostPi session collection", () => {
  const registries: InstanceType<typeof SessionRegistry>[] = [];

  afterEach(async () => {
    await Promise.all(registries.splice(0).map((registry) => registry.dispose()));
    testEnvironment.quickPickCwd = "";
    testEnvironment.configurationScopes = [];
    testEnvironment.experimentalNotificationsEnabled = true;
    testEnvironment.windowFocused = true;
    testEnvironment.startSessionOnOpenByCwd.clear();
    testEnvironment.projectFolders = undefined;
    testEnvironment.anchorProject = "";
    hostMocks.systemToast.mockReset().mockResolvedValue(true);
    hostMocks.showInputBox.mockReset();
    treePickerMocks.pickBranchEnd.mockReset();
    treePickerMocks.pickBranchSummary.mockReset();
    treePickerMocks.confirmDraftReplacement.mockReset();
  });

  it.each(["new", "resume"] as const)("cancels a late %s discovery after shutdown without new metadata or runtimes", async (operation) => {
    const cwd = await mkdtemp(join(tmpdir(), "frostpi-registry-closed-"));
    testEnvironment.cwd = cwd;
    testEnvironment.quickPickCwd = cwd;
    const { host, logger } = createTestHost();
    // If the guard regresses, block any save before it could start an actual child process.
    const write = vi.fn(() => new Promise<void>(() => {}));
    host.storage.update = write;
    const discovery = { authoritative: false, directories: [{ cwd, workspaceFolderCwd: cwd, directoryName: "Project", isCurrent: true }] };
    let release!: (value: typeof discovery) => void;
    const pending = new Promise<typeof discovery>((resolve) => { release = resolve; });
    const discover = vi.fn(() => pending);
    const registry = new SessionRegistry(host, { logger, discoverWorkingDirectories: discover });
    registries.push(registry);
    const action = operation === "new" ? registry.createSession() : registry.resumeSession();
    const cancelled = expect(action).rejects.toThrow("client has closed");
    await registry.dispose();
    await registry.flushPersistence();
    release(discovery);
    await cancelled;
    expect(registry.snapshot().sessions).toEqual([]);
    expect(write).not.toHaveBeenCalled();
    await expect(registry.createSession()).rejects.toThrow("client has closed");
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it("preserves the native first-session fallback while exact restoration keeps a saved null selection", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "frostpi-registry-selection-"));
    testEnvironment.cwd = cwd;
    const { host, logger } = createTestHost();
    const stored = { version: 1, activeSessionId: null, sessions: [{ id: "saved-a", title: "Saved A", cwd, updatedAt: 1 }] };
    host.storage.get = (<T>() => stored as T);
    const native = new SessionRegistry(host, { logger });
    const exact = new SessionRegistry(host, { logger, restoreSelection: "saved-only" });
    registries.push(native, exact);
    expect(native.activeSessionId).toBe("saved-a");
    expect(exact.activeSessionId).toBeNull();
    await exact.ensureInitialSession();
    expect(exact.snapshot().sessions).toEqual([expect.objectContaining({ id: "saved-a", status: "stopped" })]);
  });

  it("drains queued metadata before shutdown and reports a rejected save without swallowing it", async () => {
    testEnvironment.cwd = await mkdtemp(join(tmpdir(), "frostpi-registry-flush-"));
    testEnvironment.quickPickCwd = testEnvironment.cwd;
    const { host, logger } = createTestHost();
    let beginWrite!: () => void;
    let rejectWrite!: (error: Error) => void;
    const started = new Promise<void>((resolve) => { beginWrite = resolve; });
    const pendingWrite = new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
    host.storage.update = () => { beginWrite(); return pendingWrite; };
    const registry = new SessionRegistry(host, { logger });
    registries.push(registry);
    const creating = registry.createSession();
    const creationFailure = expect(creating).rejects.toThrow("Storage write failed");
    await started;
    let settled = false;
    const flushing = registry.flushPersistence().finally(() => { settled = true; });
    const flushFailure = expect(flushing).rejects.toThrow("Storage write failed");
    await Promise.resolve();
    expect(settled).toBe(false);
    rejectWrite(new Error("Storage write failed"));
    await Promise.all([creationFailure, flushFailure]);
    expect(logger.error).toHaveBeenCalledWith("Failed to persist session metadata", expect.any(Error));
  });

  it("keeps Resume searchable by worktree/path and Browse available while filtering", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-registry-picker-"));
    testEnvironment.cwd = dir;
    const { host } = createTestHost();
    const showQuickPick = vi.fn(() => Promise.resolve(undefined));
    host.window.showQuickPick = showQuickPick;
    host.window.showOpenFileDialog = () => Promise.resolve(undefined);
    const registry = new SessionRegistry(host, { logger: { error: () => undefined, info: () => undefined } });
    registries.push(registry);
    await registry.resumeSession();
    expect(showQuickPick).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ browse: true, alwaysShow: true })]),
      expect.objectContaining({ matchOnDescription: true, matchOnDetail: true, ignoreFocusOut: true }),
    );
  });

  it("orchestrates Branch here and treats the selected current path as a no-op", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-registry-tree-"));
    const sessionFile = join(dir, "tree.jsonl");
    const artifactPath = join(dir, "session-tree.js");
    const fakePi = join(dir, "fake-pi.cjs");
    await writeFile(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: "tree", cwd: dir })}\n`);
    await writeFile(artifactPath, "export default () => {};\n");
    await writeFile(fakePi, String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const extensionPath = process.argv[process.argv.indexOf("-e") + 1];
const sessionIndex = process.argv.indexOf("--session");
const sessionFile = sessionIndex >= 0 ? process.argv[sessionIndex + 1] : undefined;
const entries = [
  { type: "message", id: "root", parentId: null, timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: "Start", timestamp: 1 } },
  { type: "message", id: "answer", parentId: "root", timestamp: "2026-01-01T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "Answer" }], timestamp: 2 } },
  { type: "message", id: "old-user", parentId: "answer", timestamp: "2026-01-01T00:00:03.000Z", message: { role: "user", content: "Revise me", timestamp: 3 } },
  { type: "message", id: "other-user", parentId: "answer", timestamp: "2026-01-01T00:00:04.000Z", message: { role: "user", content: "Other path", timestamp: 4 } },
];
let leafId = "old-user";
let messages = [entries[0].message, entries[1].message, entries[2].message];
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  input += chunk;
  while (input.includes("\n")) {
    const index = input.indexOf("\n");
    const command = JSON.parse(input.slice(0, index));
    input = input.slice(index + 1);
    const response = { type: "response", id: command.id, success: true };
    if (command.type === "get_state") response.data = { model: null, thinkingLevel: "off", isStreaming: false, isCompacting: false, pendingMessageCount: 0, sessionFile, sessionId: "tree" };
    else if (command.type === "get_messages") response.data = { messages };
    else if (command.type === "get_entries") response.data = { entries, leafId };
    else if (command.type === "get_available_models") response.data = { models: [] };
    else if (command.type === "get_commands") response.data = { commands: [
      { name: "frostpi.session-tree", source: "extension", sourceInfo: { path: extensionPath, source: "local", scope: "temporary", origin: "top-level" } },
    ] };
    else if (command.type === "get_session_stats") response.data = { sessionFile, sessionId: "tree", userMessages: 3, assistantMessages: 1, toolCalls: 0, toolResults: 0, totalMessages: 4, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };
    else if (command.type === "prompt") {
      const request = JSON.parse(Buffer.from(command.message.split(" ")[1], "base64url").toString("utf8"));
      leafId = "answer";
      messages = [entries[0].message, entries[1].message];
      fs.writeFileSync(path.join(process.env.FROSTPI_SESSION_TREE_RESULT_DIR, request.requestId + ".json"), JSON.stringify({ version: 1, requestId: request.requestId, status: "committed", leafId }));
    }
    process.stdout.write(JSON.stringify(response) + "\n");
  }
});
process.on("SIGTERM", () => process.exit(0));
`);
    testEnvironment.cwd = dir;
    testEnvironment.piExecutable = fakePi;
    const testHost = createTestHost();
    const registry = new SessionRegistry(testHost.host, {
      logger: testHost.logger,
      sessionTreeArtifactPath: artifactPath,
    });
    registries.push(registry);
    treePickerMocks.confirmDraftReplacement.mockResolvedValue(true);
    treePickerMocks.pickBranchSummary.mockResolvedValue({ summarize: false });

    const sessionId = await registry.openSession({ path: sessionFile, cwd: dir, title: "Tree", updatedAt: Date.now() });
    await waitFor(() => registry.snapshot().activeSession?.sessionTreeAvailable === true && registry.snapshot().activeSession?.historyStatus === "loaded");

    await expect(registry.checkPiIntegration(sessionId)).resolves.toBeUndefined();
    await expect(registry.branchHere(sessionId, "old-user", true)).resolves.toEqual({ cancelled: false });
    expect(treePickerMocks.confirmDraftReplacement).toHaveBeenCalledOnce();
    expect(treePickerMocks.pickBranchSummary).toHaveBeenCalledOnce();
    expect(registry.snapshot().activeSession?.composerSeed).toMatchObject({ text: "Revise me", images: [] });

    treePickerMocks.pickBranchEnd.mockImplementation((_host: never, choices: Array<{ isCurrent: boolean }>) => Promise.resolve(choices.find((choice) => choice.isCurrent)));
    treePickerMocks.pickBranchSummary.mockClear();
    await expect(registry.switchBranch(sessionId, "answer", false)).resolves.toEqual({ cancelled: true });
    expect(treePickerMocks.pickBranchSummary).not.toHaveBeenCalled();
  });

  it("does not create a session when none are persisted on open", async () => {
    testEnvironment.cwd = resolve("test/fixtures");
    testEnvironment.piExecutable = fakePiFixture();
    const testHost = createTestHost();
    const registry = new SessionRegistry(testHost.host, { logger: testHost.logger });
    registries.push(registry);

    await registry.ensureInitialSession();

    const snapshot = registry.snapshot();
    expect(snapshot.activeSessionId).toBeNull();
    expect(snapshot.activeSession).toBeNull();
    expect(snapshot.sessions).toEqual([]);
  });

  it("blocks Fork while custom session creation is waiting for launch arguments", async () => {
    testEnvironment.cwd = resolve("test/fixtures");
    let resolveInput: (value: string | undefined) => void = () => undefined;
    hostMocks.showInputBox.mockReturnValueOnce(new Promise<string | undefined>((resolve) => {
      resolveInput = resolve;
    }));
    const testHost = createTestHost();
    const registry = new SessionRegistry(testHost.host, { logger: testHost.logger });
    registries.push(registry);

    const creation = registry.createSessionWithCustomArguments();
    await waitFor(() => hostMocks.showInputBox.mock.calls.length === 1);
    await expect(registry.forkMessage("session", "entry")).rejects.toThrow("current session creation");

    resolveInput(undefined);
    await expect(creation).resolves.toBeUndefined();
  });

  it("creates a session in the worktree selected by the host picker", async () => {
    const main = await mkdtemp(join(tmpdir(), "frostpi-registry-main-"));
    const linked = await mkdtemp(join(tmpdir(), "frostpi-registry-linked-"));
    testEnvironment.cwd = main;
    testEnvironment.piExecutable = fakePiFixture();
    testEnvironment.quickPickCwd = linked;
    const testHost = createTestHost();
    const registry = new SessionRegistry(
      testHost.host,
      {
        logger: testHost.logger,
        discoverWorkingDirectories: () => Promise.resolve({
        authoritative: true,
        directories: [
          { cwd: main, workspaceFolderCwd: main, worktreeRoot: main, directoryName: "main", branch: "main", isCurrent: true },
          { cwd: linked, workspaceFolderCwd: main, worktreeRoot: linked, directoryName: "feature-root", branch: "feature/task", isCurrent: false },
        ],
        }),
      },
    );
    registries.push(registry);

    const sessionId = await registry.createSession();

    expect(sessionId).toBeTypeOf("string");
    expect(registry.snapshot().activeSession).toMatchObject({ cwd: linked, workingDirectoryLabel: "feature-root" });
    expect(new Set(testEnvironment.configurationScopes)).toEqual(new Set([main]));
  });

  it("keeps the alias workspace configuration when creating and restarting a non-Git session", async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), "frostpi-registry-alias-")));
    const target = join(parent, "target");
    const alias = join(parent, "alias");
    await mkdir(target);
    await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
    await writeFile(join(target, ".frostpi-e2e-session.jsonl"),
      JSON.stringify({ type: "session", version: 3, id: "alias", cwd: target }) + "\n");
    testEnvironment.cwd = alias;
    testEnvironment.piExecutable = fakePiFixture();
    const actual = await vi.importActual<typeof SessionWorkingDirectoriesModule>(
      "../../src/host/sessions/SessionWorkingDirectories.js",
    );
    const testHost = createTestHost();
    const registry = new SessionRegistry(
      testHost.host,
      {
        logger: testHost.logger,
        discoverWorkingDirectories: actual.discoverSessionWorkingDirectories,
      },
    );
    registries.push(registry);

    const id = (await registry.createSession())!;
    await registry.retrySession(id);

    expect(registry.snapshot().activeSession).toMatchObject({ id, cwd: target, status: "ready" });
    expect(new Set(testEnvironment.configurationScopes)).toEqual(new Set([alias]));
  });

  it("removes persisted sessions only after Git confirms their worktree is gone", async () => {
    const main = await mkdtemp(join(tmpdir(), "frostpi-registry-main-"));
    const removed = resolve(main, "../removed-worktree");
    testEnvironment.cwd = main;
    testEnvironment.piExecutable = fakePiFixture();
    let persisted: unknown = {
      version: 1,
      activeSessionId: "removed",
      sessions: [{ id: "removed", title: "Old task", cwd: removed, updatedAt: 1 }],
    };
    const testHost = createTestHost();
    testHost.host.storage.get = (() => persisted) as never;
    testHost.host.storage.update = (<T>(_key: string, value: T) => {
      persisted = structuredClone(value);
      return Promise.resolve();
    });
    const logger = testHost.logger;
    const registry = new SessionRegistry(
      testHost.host,
      {
        logger: logger,
        discoverWorkingDirectories: () => Promise.resolve({
        authoritative: true,
        directories: [{ cwd: main, workspaceFolderCwd: main, worktreeRoot: main, directoryName: "main", branch: "main", isCurrent: true }],
        }),
      },
    );
    registries.push(registry);

    await registry.ensureInitialSession();

    expect(registry.snapshot().sessions).toEqual([]);
    expect(persisted).toMatchObject({ activeSessionId: null, sessions: [] });
    expect(logger.info).toHaveBeenCalledWith("Removed 1 FrostPi session record(s) for deleted worktrees.");
  });

  it("retains external session metadata when Git cannot establish the worktree boundary", async () => {
    const main = await mkdtemp(join(tmpdir(), "frostpi-registry-main-"));
    const external = resolve(main, "../uncertain-worktree");
    testEnvironment.cwd = main;
    testEnvironment.piExecutable = fakePiFixture();
    const testHost = createTestHost();
    testHost.host.storage.get = (() => ({
      version: 1 as const,
      activeSessionId: "uncertain",
      sessions: [{ id: "uncertain", title: "Uncertain task", cwd: external, updatedAt: 1 }],
    })) as never;
    const registry = new SessionRegistry(
      testHost.host,
      {
        logger: testHost.logger,
        discoverWorkingDirectories: () => Promise.resolve({
        authoritative: false,
        directories: [{ cwd: main, workspaceFolderCwd: main, directoryName: "main", isCurrent: true }],
        }),
      },
    );
    registries.push(registry);

    await registry.ensureInitialSession();

    expect(registry.snapshot().sessions).toEqual([expect.objectContaining({ id: "uncertain", cwd: external })]);
  });

  it("uses the anchor workspace setting for an alias-spelled restored worktree session", async () => {
    const main = await mkdtemp(join(tmpdir(), "frostpi-registry-main-"));
    const linked = await mkdtemp(join(tmpdir(), "frostpi-registry-linked-"));
    const linkedAlias = join(main, "linked-alias");
    await symlink(linked, linkedAlias, process.platform === "win32" ? "junction" : "dir");
    testEnvironment.cwd = main;
    testEnvironment.piExecutable = fakePiFixture();
    testEnvironment.startSessionOnOpenByCwd.set(main, false);
    testEnvironment.startSessionOnOpenByCwd.set(linkedAlias, true);
    const testHost = createTestHost();
    testHost.host.storage.get = (() => ({
      version: 1 as const,
      activeSessionId: "linked",
      sessions: [{ id: "linked", title: "Linked task", cwd: linkedAlias, updatedAt: 1 }],
    })) as never;
    const registry = new SessionRegistry(
      testHost.host,
      {
        logger: testHost.logger,
        discoverWorkingDirectories: () => Promise.resolve({
        authoritative: true,
        directories: [
          { cwd: main, workspaceFolderCwd: main, worktreeRoot: main, directoryName: "main", branch: "main", isCurrent: true },
          { cwd: linked, workspaceFolderCwd: main, worktreeRoot: linked, directoryName: "linked", branch: "feature/task", isCurrent: false },
        ],
        }),
      },
    );
    registries.push(registry);
    testEnvironment.configurationScopes = [];

    await registry.ensureInitialSession();

    expect(registry.snapshot().activeSession).toMatchObject({ cwd: linkedAlias, status: "stopped" });
    expect(new Set(testEnvironment.configurationScopes)).toEqual(new Set([main]));
  });

  it("rejects prompts while a resumed conversation history is loading", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-registry-"));
    const sessionFile = join(dir, "session.jsonl");
    await writeFile(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: "resume", cwd: dir })}\n`);
    const fakePi = join(dir, "fake-pi.cjs");
    await writeFile(fakePi, String.raw`#!/usr/bin/env node
const sessionIndex = process.argv.indexOf("--session");
const sessionFile = process.argv[sessionIndex + 1];
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  input += chunk;
  while (input.includes("\n")) {
    const index = input.indexOf("\n");
    const command = JSON.parse(input.slice(0, index));
    input = input.slice(index + 1);
    const response = { type: "response", id: command.id, success: true };
    if (command.type === "get_state") response.data = { model: null, thinkingLevel: "off", isStreaming: false, isCompacting: false, sessionFile, sessionId: "resume" };
    else if (command.type === "get_messages") {
      setTimeout(() => {
        response.data = { messages: [] };
        process.stdout.write(JSON.stringify(response) + "\n");
      }, 1_000);
      continue;
    }
    else if (command.type === "get_entries") response.data = { entries: [], leafId: null };
    else if (command.type === "get_available_models") response.data = { models: [] };
    else if (command.type === "get_commands") response.data = { commands: [] };
    else if (command.type === "get_session_stats") response.data = { sessionFile, sessionId: "resume", userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0, totalMessages: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };
    process.stdout.write(JSON.stringify(response) + "\n");
  }
});
process.on("SIGTERM", () => process.exit(0));
`);
    testEnvironment.cwd = dir;
    testEnvironment.piExecutable = fakePi;
    const testHost = createTestHost();
    const registry = new SessionRegistry(testHost.host, { logger: testHost.logger });
    registries.push(registry);

    const sessionId = await registry.openSession({ path: sessionFile, cwd: dir, title: "Resume", updatedAt: Date.now() });
    expect(registry.snapshot().activeSession?.sessionFile).toBe(sessionFile);
    expect(["queued", "loading"]).toContain(registry.snapshot().activeSession?.historyStatus);
    await expect(registry.sendPrompt(sessionId, "Too early", [])).rejects.toThrow("Wait for conversation history");
  });

  it("keeps the original identity across cancellation, recovery, and a successful temporary Fork", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-registry-fork-"));
    const sessionFile = join(dir, "source.jsonl");
    await writeFile(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: "source", cwd: dir })}\n`);
    const fakePi = join(dir, "fake-pi.cjs");
    await writeFile(fakePi, String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const sessionIndex = process.argv.indexOf("--session");
const sourceFile = sessionIndex >= 0 ? process.argv[sessionIndex + 1] : undefined;
let sessionFile = sourceFile;
let sessionId = "source";
let sessionName = "Source";
let failReconcile = false;
let pendingForkRequestId;
let pendingForkEntryId;
let messages = [
  { role: "user", content: [{ type: "text", text: "Retry this" }, { type: "image", id: "image", fileName: "shot.png", mimeType: "image/png", data: "AA==", size: 1 }], timestamp: 1 },
  { role: "user", content: "Cancel this", timestamp: 2 },
  { role: "user", content: "Fail refresh", timestamp: 3 },
  { role: "user", content: "Wait", timestamp: 4 },
  { role: "user", content: "Preserve sidebar", timestamp: 5 },
];
let entries = [
  { type: "message", id: "user-entry", parentId: null, message: { role: "user", content: [{ type: "text", text: "Retry this" }, { type: "image", id: "image", fileName: "shot.png", mimeType: "image/png", data: "AA==", size: 1 }], timestamp: 1 } },
  { type: "message", id: "cancel-entry", parentId: "user-entry", message: { role: "user", content: "Cancel this", timestamp: 2 } },
  { type: "message", id: "fail-entry", parentId: "cancel-entry", message: { role: "user", content: "Fail refresh", timestamp: 3 } },
  { type: "message", id: "wait-entry", parentId: "fail-entry", message: { role: "user", content: "Wait", timestamp: 4 } },
  { type: "message", id: "preserve-entry", parentId: "wait-entry", message: { role: "user", content: "Preserve sidebar", timestamp: 5 } },
];
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  input += chunk;
  while (input.includes("\n")) {
    const index = input.indexOf("\n");
    const command = JSON.parse(input.slice(0, index));
    input = input.slice(index + 1);
    const response = { type: "response", id: command.id, success: true };
    if (command.type === "get_state") response.data = { model: null, thinkingLevel: "off", isStreaming: false, isCompacting: false, sessionFile, sessionId, sessionName };
    else if (command.type === "get_messages") response.data = { messages };
    else if (command.type === "get_entries") response.data = { entries, leafId: entries.at(-1)?.id ?? null };
    else if (command.type === "get_available_models") response.data = { models: [] };
    else if (command.type === "get_commands") response.data = { commands: [] };
    else if (command.type === "get_session_stats") response.data = { sessionFile, sessionId, userMessages: messages.filter(x => x.role === "user").length, assistantMessages: 0, toolCalls: 0, toolResults: 0, totalMessages: messages.length, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };
    else if (command.type === "fork") {
      if (command.entryId === "cancel-entry") {
        response.data = { text: "Cancel this", cancelled: true };
      } else if (command.entryId === "wait-entry" || command.entryId === "preserve-entry") {
        pendingForkRequestId = command.id;
        pendingForkEntryId = command.entryId;
        process.stdout.write(JSON.stringify({ type: "extension_ui_request", id: "fork-confirm", method: "confirm", message: "Fork?" }) + "\n");
        continue;
      } else {
        sessionFile = path.join(path.dirname(sourceFile), "fork.jsonl");
        fs.writeFileSync(sessionFile, JSON.stringify({ type: "session", version: 3, id: "fork", cwd: path.dirname(sourceFile), parentSession: sourceFile }) + "\n");
        sessionId = "fork";
        messages = [];
        entries = [];
        failReconcile = command.entryId === "fail-entry";
        response.data = { text: command.entryId === "fail-entry" ? "Fail refresh" : "Retry this", cancelled: false };
      }
    } else if (command.type === "set_session_name") {
      if (failReconcile) {
        response.success = false;
        response.error = "set_session_name failed after Fork";
        failReconcile = false;
      } else sessionName = command.name;
    } else if (command.type === "extension_ui_response" && pendingForkRequestId) {
      if (pendingForkEntryId === "preserve-entry") {
        sessionFile = path.join(path.dirname(sourceFile), "fork.jsonl");
        fs.writeFileSync(sessionFile, JSON.stringify({ type: "session", version: 3, id: "fork", cwd: path.dirname(sourceFile), parentSession: sourceFile }) + "\n");
        sessionId = "fork";
        messages = [];
        entries = [];
        process.stdout.write(JSON.stringify({ type: "response", id: pendingForkRequestId, success: true, data: { text: "Preserve sidebar", cancelled: false } }) + "\n");
      } else {
        process.stdout.write(JSON.stringify({ type: "response", id: pendingForkRequestId, success: true, data: { text: "Wait", cancelled: true } }) + "\n");
      }
      pendingForkRequestId = undefined;
      pendingForkEntryId = undefined;
      continue;
    }
    process.stdout.write(JSON.stringify(response) + "\n");
  }
});
process.on("SIGTERM", () => process.exit(0));
`);
    testEnvironment.cwd = dir;
    testEnvironment.piExecutable = fakePi;
    let persisted: { sessions: Array<{ id: string; sessionFile?: string }> } | undefined;
    const testHost = createTestHost();
    testHost.host.storage.update = (_key, value) => {
      persisted = structuredClone(value) as typeof persisted;
      return Promise.resolve();
    };
    const created: Array<{ id: string; sourceId: string | undefined }> = [];
    const registry = new SessionRegistry(testHost.host, {
      logger: testHost.logger,
      onSessionOpened: (id, sourceId) => created.push({ id, sourceId }),
    });
    registries.push(registry);

    const activeId = await registry.openSession({ path: sessionFile, cwd: dir, title: "Source", updatedAt: Date.now() });
    expect(created).toContainEqual({ id: activeId, sourceId: undefined });
    await waitForForkableHistory(registry, "preserve-entry");

    const unrelatedSidebarId = (await registry.createSession())!;
    await waitFor(() => registry.activeSessionId === unrelatedSidebarId && registry.sessionView(unrelatedSidebarId)?.status === "ready");
    const preservedFork = registry.forkMessage(activeId, "preserve-entry", "preserve-sidebar-selection");
    await waitFor(() => registry.sessionView(activeId)?.isForking === true && registry.sessionView(activeId)?.pendingExtensionUi.length === 1);
    await registry.closeSession(unrelatedSidebarId);
    expect(registry.activeSessionId).toBe(activeId);
    await registry.respondExtensionUi(activeId, "fork-confirm", { confirmed: true });
    const preservedResult = await preservedFork;
    expect(preservedResult.cancelled).toBe(false);
    expect(typeof preservedResult.forkSessionId).toBe("string");
    expect(registry.activeSessionId).toBe(activeId);
    expect(registry.snapshot().sessions.some((session) => session.id === preservedResult.forkSessionId)).toBe(true);
    expect(created).toContainEqual({ id: preservedResult.forkSessionId, sourceId: activeId });
    await registry.closeSession(preservedResult.forkSessionId!);
    await registry.activateSession(activeId);
    await waitForForkableHistory(registry, "preserve-entry");

    await expect(registry.forkMessage(activeId, "fail-entry")).rejects.toThrow("set_session_name failed after Fork");
    await waitForForkableHistory(registry, "preserve-entry");
    expect(registry.snapshot().sessions).toEqual([expect.objectContaining({ id: activeId, status: "ready" })]);

    const pendingFork = registry.forkMessage(activeId, "wait-entry");
    await waitFor(() => registry.snapshot().activeSession?.isForking === true && registry.snapshot().activeSession?.pendingExtensionUi.length === 1);
    await expect(registry.createSession()).rejects.toThrow("cancel it first");
    await registry.cancelFork(activeId);
    await expect(pendingFork).resolves.toEqual({ cancelled: true });
    await waitForForkableHistory(registry, "preserve-entry");

    await expect(registry.forkMessage(activeId, "cancel-entry")).resolves.toEqual({ cancelled: true });
    expect(registry.snapshot().sessions).toHaveLength(1);
    expect(registry.snapshot().activeSession).toMatchObject({ id: activeId, title: "Source", sessionId: "source" });

    const result = await registry.forkMessage(activeId, "user-entry");

    expect(result.cancelled).toBe(false);
    expect(typeof result.forkSessionId).toBe("string");
    expect(result.forkSessionId).not.toBe(activeId);
    expect(created).toContainEqual({ id: result.forkSessionId, sourceId: activeId });
    expect(registry.snapshot().activeSession).toMatchObject({
      id: result.forkSessionId,
      title: "Fork: Source",
      sessionId: "fork",
      conversationItems: [],
      composerSeed: {
        id: result.forkSessionId,
        text: "Retry this",
        images: [{ id: "image", name: "shot.png", mimeType: "image/png", dataUrl: "data:image/png;base64,AA==", size: 1 }],
      },
    });
    const original = registry.snapshot().sessions.find((session) => session.id === activeId);
    expect(original).toMatchObject({ title: "Source", status: "stopped" });
    expect(persisted?.sessions).toEqual([
      expect.objectContaining({ id: activeId, sessionFile }),
    ]);
  });

  it("replaces an unused new session but retains one after Pi accepts a prompt", async () => {
    testEnvironment.cwd = resolve("test/fixtures");
    testEnvironment.piExecutable = fakePiFixture();
    let persisted: unknown;
    const testHost = createTestHost();
    testHost.host.storage.get = (<T>(key: string) => (key ? (persisted as T) : undefined));
    testHost.host.storage.update = (<T>(_key: string, value: T) => {
      persisted = structuredClone(value);
      return Promise.resolve();
    });
    const logger = testHost.logger;
    const registry = new SessionRegistry(testHost.host, { logger: logger });
    registries.push(registry);

    const first = (await registry.createSession())!;
    expect(registry.snapshot().sessions.map((session) => session.id)).toEqual([first]);
    expect((persisted as { sessions: unknown[] }).sessions).toHaveLength(0);

    const second = (await registry.createSession())!;
    expect(registry.snapshot().sessions.map((session) => session.id)).toEqual([second]);

    await registry.sendPrompt(second, "Keep this session", []);
    expect((persisted as { sessions: Array<{ id: string }> }).sessions.map((session) => session.id)).toEqual([second]);
    const turnsBeforeCompaction = conversationTurns(registry.snapshot().activeSession).length;

    await expect(registry.sendPrompt(second, "/compact Keep code changes", [{
      id: "image",
      name: "image.png",
      mimeType: "image/png",
      data: "AA==",
      size: 1,
    }])).rejects.toThrow("/compact does not support image attachments");

    await registry.sendPrompt(second, "/compact Keep code changes", []);
    expect(conversationTurns(registry.snapshot().activeSession)).toHaveLength(turnsBeforeCompaction);
    expect(conversationCompactions(registry.snapshot().activeSession)).toEqual([
      expect.objectContaining({ summary: "Compacted context: Keep code changes", tokensBefore: 42_000 }),
    ]);

    const third = (await registry.createSession())!;
    expect(new Set(registry.snapshot().sessions.map((session) => session.id))).toEqual(new Set([second, third]));
    expect((persisted as { sessions: Array<{ id: string }> }).sessions.map((session) => session.id)).toEqual([second]);

    registry.retainProvisionalSession(third);
    const fourth = (await registry.createSession())!;
    expect(new Set(registry.snapshot().sessions.map((session) => session.id))).toEqual(new Set([second, third, fourth]));
    expect((persisted as { sessions: Array<{ id: string }> }).sessions.map((session) => session.id)).toEqual([second]);
  });

  it("clears the foreground without discarding or stopping either a saved or provisional Runtime", async () => {
    testEnvironment.cwd = resolve("test/fixtures");
    testEnvironment.piExecutable = fakePiFixture();
    let persisted: unknown;
    const { host, logger } = createTestHost();
    host.storage.update = (_key, value) => { persisted = structuredClone(value); return Promise.resolve(); };
    const created: Array<{ id: string; visibleBeforePublication: boolean }> = [];
    const registry = new SessionRegistry(host, {
      logger,
      onSessionOpened: (id) => created.push({ id, visibleBeforePublication: registry.hasSession(id) && registry.activeSessionId === id }),
    });
    registries.push(registry);
    const saved = (await registry.createSession())!;
    await registry.sendPrompt(saved, "Commit the first session", []);
    await waitFor(() => registry.sessionView(saved)?.status === "ready");
    const provisional = (await registry.createSession())!;
    expect(created).toEqual([{ id: saved, visibleBeforePublication: true }, { id: provisional, visibleBeforePublication: true }]);

    await registry.clearActiveSession();
    expect(registry.activeSessionId).toBeNull();
    expect(registry.snapshot().activeSession).toBeNull();
    expect(registry.snapshot().sessions).toEqual([
      expect.objectContaining({ id: saved, status: "ready" }),
      expect.objectContaining({ id: provisional, status: "ready" }),
    ]);
    expect(persisted).toMatchObject({ activeSessionId: null, sessions: [expect.objectContaining({ id: saved })] });
    await registry.sendPrompt(saved, "The background process is still usable", []);
    expect(registry.activeSessionId).toBeNull();
    expect(registry.hasSession(provisional)).toBe(true);
  });

  it("keeps temporary sessions in memory and disables persistence, Fork, and restart", async () => {
    testEnvironment.cwd = resolve("test/fixtures");
    testEnvironment.piExecutable = fakePiFixture();
    let persisted: unknown;
    const testHost = createTestHost();
    testHost.host.storage.get = (<T>(key: string) => (key ? (persisted as T) : undefined));
    testHost.host.storage.update = (<T>(_key: string, value: T) => {
      persisted = structuredClone(value);
      return Promise.resolve();
    });
    const registry = new SessionRegistry(testHost.host, { logger: testHost.logger });
    registries.push(registry);
    const toasts: string[] = [];
    registry.onDidToast((toast) => toasts.push(toast.message));

    const sessionId = (await registry.createSession(true))!;
    await waitFor(() => registry.snapshot().activeSession?.status === "ready");
    expect(registry.snapshot().activeSession).toMatchObject({ id: sessionId, isEphemeral: true });
    expect(registry.snapshot().activeSession?.sessionFile).toBeUndefined();
    expect(persisted).toMatchObject({ activeSessionId: null, sessions: [] });

    await registry.sendPrompt(sessionId, "Keep only in memory", []);
    await waitFor(() => conversationTurns(registry.snapshot().activeSession).at(-1)?.status === "completed");
    await registry.rename(sessionId, "Still temporary");
    expect(persisted).toMatchObject({ activeSessionId: null, sessions: [] });
    await expect(registry.forkMessage(sessionId, "missing")).rejects.toThrow("Temporary sessions do not support Fork");

    await registry.sendPrompt(sessionId, "fail-process", []);
    await waitFor(() => registry.snapshot().activeSession?.status === "failed");
    await expect(registry.sendPrompt(sessionId, "Do not restart", [])).rejects.toThrow("has stopped and cannot be restarted");
    expect(registry.snapshot().activeSession?.status).toBe("failed");
    await expect(registry.retrySession(sessionId)).rejects.toThrow("Temporary sessions cannot be restarted");

    const regularId = (await registry.createSession())!;
    await waitFor(() => registry.snapshot().activeSession?.status === "ready");
    await registry.restartAllSessions();
    expect(toasts).toContain("Skipped 1 temporary session.");
    await registry.closeSession(regularId);

    await registry.restartAllSessions();
    expect(toasts).toContain("There are no sessions to restart.");

    const restored = new SessionRegistry(testHost.host, { logger: testHost.logger });
    registries.push(restored);
    expect(restored.snapshot().sessions).toEqual([]);

    hostMocks.showWarningDialog.mockClear().mockResolvedValueOnce("Close session");
    await registry.closeSession(sessionId);
    expect(hostMocks.showWarningDialog).toHaveBeenCalledWith(
      "Closing this temporary session will permanently discard its conversation. This cannot be undone.",
      ["Close session"],
    );
  });

  it("uses experimental notifications for unfocused input, completion, and failure transitions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-registry-notifications-"));
    const fakePi = join(dir, "fake-pi.cjs");
    await writeFile(fakePi, String.raw`#!/usr/bin/env node
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  input += chunk;
  while (input.includes("\n")) {
    const index = input.indexOf("\n");
    const command = JSON.parse(input.slice(0, index));
    input = input.slice(index + 1);
    const response = { type: "response", id: command.id, success: true };
    if (command.type === "get_state") response.data = { model: null, thinkingLevel: "off", isStreaming: false, isCompacting: false, sessionFile: process.cwd() + "/session.jsonl", sessionId: "notifications" };
    else if (command.type === "get_available_models") response.data = { models: [] };
    else if (command.type === "get_commands") response.data = { commands: [] };
    else if (command.type === "get_session_stats") response.data = { sessionId: "notifications", userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0, totalMessages: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };
    else if (command.type === "get_entries") response.data = { entries: [], leafId: null };
    else if (command.type === "prompt") {
      if (command.message === "fail") {
        process.stdout.write(JSON.stringify(response) + "\n");
        setTimeout(() => process.exit(1), 0);
        continue;
      }
      if (command.message === "hold") {
        process.stdout.write(JSON.stringify(response) + "\n");
        process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\n");
        continue;
      }
      if (command.message === "complete") {
        process.stdout.write(JSON.stringify(response) + "\n");
        process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\n");
        process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", timestamp: Date.now(), stopReason: "stop", content: [{ type: "text", text: "Done" }] } }) + "\n");
        process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\n");
        continue;
      }
      process.stdout.write(JSON.stringify({ type: "extension_ui_request", id: "answer", method: "confirm", message: "Continue?" }) + "\n");
    } else if (command.type === "abort") {
      process.stdout.write(JSON.stringify(response) + "\n");
      process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\n");
      continue;
    }
    process.stdout.write(JSON.stringify(response) + "\n");
  }
});
process.on("SIGTERM", () => process.exit(0));
`);
    testEnvironment.cwd = dir;
    testEnvironment.piExecutable = fakePi;
    hostMocks.showInformation.mockClear();
    hostMocks.showError.mockClear();
    const testHost = createTestHost();
    const registry = new SessionRegistry(testHost.host, { logger: testHost.logger });
    registries.push(registry);

    const sessionId = (await registry.createSession())!;
    await waitFor(() => registry.snapshot().activeSession?.status === "ready");
    await registry.sendPrompt(sessionId, "ask", []);
    await waitFor(() => registry.snapshot().activeSession?.pendingExtensionUi.length === 1);
    expect(hostMocks.systemToast).not.toHaveBeenCalled();

    await registry.respondExtensionUi(sessionId, "answer", { confirmed: true });
    await waitFor(() => registry.snapshot().activeSession?.pendingExtensionUi.length === 0);
    testEnvironment.windowFocused = false;
    hostMocks.systemToast.mockResolvedValueOnce(false);
    await registry.sendPrompt(sessionId, "ask", []);
    await waitFor(() => hostMocks.showInformation.mock.calls.length === 1);
    expect(hostMocks.systemToast).toHaveBeenCalledWith(
      "FrostPi needs your attention",
      "FrostPi is waiting for your input.",
    );
    expect(hostMocks.showInformation).toHaveBeenCalledWith("FrostPi is waiting for your input.");

    await registry.respondExtensionUi(sessionId, "answer", { confirmed: true });
    await waitFor(() => registry.snapshot().activeSession?.pendingExtensionUi.length === 0);
    testEnvironment.experimentalNotificationsEnabled = false;
    await registry.sendPrompt(sessionId, "ask", []);
    await waitFor(() => registry.snapshot().activeSession?.pendingExtensionUi.length === 1);
    expect(hostMocks.systemToast).toHaveBeenCalledOnce();

    await registry.respondExtensionUi(sessionId, "answer", { confirmed: true });
    await waitFor(() => registry.snapshot().activeSession?.pendingExtensionUi.length === 0);
    testEnvironment.experimentalNotificationsEnabled = true;

    await registry.sendPrompt(sessionId, "complete", []);
    await waitFor(() => conversationTurns(registry.snapshot().activeSession).at(-1)?.status === "completed");
    await waitFor(() => hostMocks.systemToast.mock.calls.length === 2);
    expect(hostMocks.systemToast).toHaveBeenLastCalledWith(
      "FrostPi turn completed",
      "FrostPi completed an agent turn.",
    );

    await registry.sendPrompt(sessionId, "hold", []);
    await waitFor(() => registry.snapshot().activeSession?.isStreaming === true);
    await registry.abort(sessionId);
    await waitFor(() => registry.snapshot().activeSession?.status === "ready");
    expect(hostMocks.systemToast).toHaveBeenCalledTimes(2);

    await registry.sendPrompt(sessionId, "fail", []);
    await waitFor(() => registry.snapshot().activeSession?.status === "failed");
    await waitFor(() => hostMocks.systemToast.mock.calls.length === 3);
    expect(hostMocks.systemToast).toHaveBeenLastCalledWith(
      "FrostPi needs your attention",
      "A FrostPi session failed. Open the session for details.",
    );
    expect(hostMocks.showError).not.toHaveBeenCalled();
  });

  it("routes set_editor_text by Session identity regardless of sidebar selection", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-registry-editor-"));
    const fakePi = join(dir, "fake-pi.cjs");
    await writeFile(fakePi, String.raw`#!/usr/bin/env node
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  input += chunk;
  while (input.includes("\n")) {
    const index = input.indexOf("\n");
    const command = JSON.parse(input.slice(0, index));
    input = input.slice(index + 1);
    const response = { type: "response", id: command.id, success: true };
    if (command.type === "get_state") {
      response.data = {
        model: null,
        thinkingLevel: "off",
        isStreaming: false,
        isCompacting: false,
        sessionFile: process.cwd() + "/session.jsonl",
        sessionId: "editor",
        messageCount: 0,
        pendingMessageCount: 0,
        autoCompactionEnabled: true,
        steeringMode: "all",
        followUpMode: "one-at-a-time",
      };
    } else if (command.type === "get_available_models") response.data = { models: [] };
    else if (command.type === "get_commands") response.data = { commands: [{ name: "input-file", source: "extension" }] };
    else if (command.type === "get_session_stats") {
      response.data = {
        sessionId: "editor",
        userMessages: 0,
        assistantMessages: 0,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        cost: 0,
      };
    } else if (command.type === "prompt") {
      process.stdout.write(JSON.stringify({
        type: "extension_ui_request",
        id: "set-editor-" + Date.now(),
        method: "set_editor_text",
        text: "imported from .pi-input.md",
      }) + "\n");
    }
    process.stdout.write(JSON.stringify(response) + "\n");
  }
});
process.on("SIGTERM", () => process.exit(0));
`);
    testEnvironment.cwd = dir;
    testEnvironment.piExecutable = fakePi;

    const testHost = createTestHost();
    const registry = new SessionRegistry(testHost.host, { logger: testHost.logger });
    registries.push(registry);

    const events: Array<{ sessionId: string; text: string }> = [];
    registry.onDidSetComposerText((event) => events.push(event));

    const background = (await registry.createSession())!;
    await waitFor(() => registry.snapshot().activeSession?.status === "ready");
    await registry.sendPrompt(background, "/input-file", []);
    expect(events).toEqual([{ sessionId: background, text: "imported from .pi-input.md" }]);

    const foreground = (await registry.createSession())!;
    await waitFor(() => registry.snapshot().activeSessionId === foreground && registry.snapshot().activeSession?.status === "ready");
    events.length = 0;

    await registry.sendPrompt(background, "/input-file", []);
    expect(events).toEqual([{ sessionId: background, text: "imported from .pi-input.md" }]);

    events.length = 0;
    await registry.activateSession(background);
    expect(events).toEqual([]);
  });
  it("keeps per-runtime cwd and configuration scope stable across two Projects", async () => {
    const projectA = await mkdtemp(join(tmpdir(), "frostpi-registry-project-a-"));
    const projectB = await mkdtemp(join(tmpdir(), "frostpi-registry-project-b-"));
    testEnvironment.piExecutable = fakePiFixture();
    // Desktop shape: registered Project roots are stable workspaceFolders; the New/Resume anchor is explicit.
    testEnvironment.projectFolders = [projectA, projectB];
    testEnvironment.anchorProject = projectA;
    const testHost = createTestHost();
    const registry = new SessionRegistry(testHost.host, { logger: testHost.logger });
    registries.push(registry);

    testEnvironment.quickPickCwd = projectA;
    const sessionA = (await registry.createSession())!;
    // Bind the provisional session to Pi so a later switch cannot discard it.
    await registry.sendPrompt(sessionA, "Anchor to Project A", []);
    testEnvironment.anchorProject = projectB;
    testEnvironment.quickPickCwd = projectB;
    const sessionB = (await registry.createSession())!;
    await registry.sendPrompt(sessionB, "Anchor to Project B", []);

    expect(registry.snapshot().sessions).toHaveLength(2);
    testEnvironment.anchorProject = projectA;
    await registry.activateSession(sessionA);
    expect(registry.snapshot().activeSession).toMatchObject({ id: sessionA, cwd: projectA });

    // Background session metadata and configuration scope never follow the anchor switch.
    const views = registry.snapshot().sessions;
    expect(views.find((session) => session.id === sessionA)?.cwd).toBe(projectA);
    expect(views.find((session) => session.id === sessionB)?.cwd).toBe(projectB);
    await registry.restartAllSessions();
    expect(registry.snapshot().activeSession).toMatchObject({ id: sessionA, cwd: projectA });
  });
});

function conversationTurns(session: SessionViewModel | null | undefined): AgentTurnView[] {
  return session?.conversationItems.filter((item): item is AgentTurnView => item.type === "turn") ?? [];
}

function conversationCompactions(session: SessionViewModel | null | undefined): CompactionView[] {
  return session?.conversationItems.flatMap((item) => {
    if (item.type === "compaction") return [item];
    if (item.type !== "turn") return [];
    return item.items.filter((turnItem): turnItem is CompactionView => turnItem.type === "compaction");
  }) ?? [];
}

async function waitForForkableHistory(registry: InstanceType<typeof SessionRegistry>, lastEntryId: string): Promise<void> {
  await waitFor(() => {
    const active = registry.snapshot().activeSession;
    return active?.status === "ready"
      && active.historyStatus === "loaded"
      && conversationTurns(active).at(-1)?.userMessage?.sourceEntryId === lastEntryId;
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
