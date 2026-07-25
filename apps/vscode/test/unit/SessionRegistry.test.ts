import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type * as SessionWorkingDirectoriesModule from "../../src/extension/sessions/SessionWorkingDirectories.js";

const treePickerMocks = vi.hoisted(() => ({
  pickBranchEnd: vi.fn(),
  pickBranchSummary: vi.fn(),
  confirmDraftReplacement: vi.fn(),
}));

const vscodeMocks = vi.hoisted(() => ({
  showErrorMessage: vi.fn().mockResolvedValue(undefined),
  showInformationMessage: vi.fn().mockResolvedValue(undefined),
  showWarningMessage: vi.fn().mockResolvedValue("Close session"),
}));

const windowsToastMocks = vi.hoisted(() => ({
  showWindowsToast: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../src/extension/session-tree/SessionTreePicker.js", () => treePickerMocks);
vi.mock("../../src/extension/notifications/showWindowsToast.js", () => windowsToastMocks);

const testEnvironment = vi.hoisted(() => ({
  cwd: "",
  piExecutable: "",
  quickPickCwd: "",
  configurationScopes: [] as string[],
  experimentalNotificationsEnabled: true,
  windowFocused: true,
  startSessionOnOpenByCwd: new Map<string, boolean>(),
}));

vi.mock("../../src/extension/sessions/SessionWorkingDirectories.js", async (importOriginal) => {
  const actual = await importOriginal<typeof SessionWorkingDirectoriesModule>();
  return {
    ...actual,
    discoverSessionWorkingDirectories: (cwd: string) => Promise.resolve({
      authoritative: false,
      directories: [{ cwd, workspaceFolderCwd: cwd, directoryName: "workspace", isCurrent: true }],
    }),
  };
});

vi.mock("vscode", () => {
  class EventEmitter<T> {
    readonly listeners = new Set<(value: T) => void>();
    readonly event = (listener: (value: T) => void) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };
    fire(value: T): void { for (const listener of this.listeners) listener(value); }
    dispose(): void { this.listeners.clear(); }
  }

  return {
    EventEmitter,
    ProgressLocation: { Window: 10 },
    QuickPickItemKind: { Separator: -1 },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    commands: { executeCommand: vi.fn().mockResolvedValue(undefined) },
    env: { remoteName: undefined },
    window: {
      activeTextEditor: undefined,
      get state() { return { focused: testEnvironment.windowFocused, active: true }; },
      showQuickPick: vi.fn((items: Array<{ directory?: { cwd: string } }>) => Promise.resolve(
        items.find((item) => item.directory?.cwd === testEnvironment.quickPickCwd),
      )),
      showErrorMessage: vscodeMocks.showErrorMessage,
      showInformationMessage: vscodeMocks.showInformationMessage,
      showWarningMessage: vscodeMocks.showWarningMessage,
    },
    workspace: {
      get workspaceFolders() { return testEnvironment.cwd ? [{ name: "test", uri: { fsPath: testEnvironment.cwd } }] : []; },
      getConfiguration: (section: string, scope?: { fsPath?: string }) => {
        if (section === "frostpi" && scope?.fsPath) testEnvironment.configurationScopes.push(scope.fsPath);
        return {
          get: (key: string, fallback: unknown) => {
            if (section === "frostpi" && key === "pi.executable") return testEnvironment.piExecutable;
            if (section === "frostpi" && key === "notifications.experimental.enabled") return testEnvironment.experimentalNotificationsEnabled;
            if (section === "frostpi" && key === "session.startOnOpen" && scope?.fsPath) {
              return testEnvironment.startSessionOnOpenByCwd.get(scope.fsPath) ?? fallback;
            }
            return fallback;
          },
        };
      },
      getWorkspaceFolder: () => undefined,
    },
    extensions: { getExtension: () => undefined },
  };
});

const { SessionRegistry } = await import("../../src/extension/sessions/SessionRegistry.js");

describe("FrostPi session collection", () => {
  const registries: InstanceType<typeof SessionRegistry>[] = [];

  afterEach(async () => {
    await Promise.all(registries.splice(0).map((registry) => registry.dispose()));
    testEnvironment.quickPickCwd = "";
    testEnvironment.configurationScopes = [];
    testEnvironment.experimentalNotificationsEnabled = true;
    testEnvironment.windowFocused = true;
    testEnvironment.startSessionOnOpenByCwd.clear();
    windowsToastMocks.showWindowsToast.mockReset().mockResolvedValue(true);
    treePickerMocks.pickBranchEnd.mockReset();
    treePickerMocks.pickBranchSummary.mockReset();
    treePickerMocks.confirmDraftReplacement.mockReset();
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
const sessionFile = process.argv[process.argv.indexOf("--session") + 1];
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
    const context = { ...createContext(), asAbsolutePath: () => artifactPath };
    const registry = new SessionRegistry(context as never, { error: vi.fn(), info: vi.fn() } as never);
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

    treePickerMocks.pickBranchEnd.mockImplementation((choices: Array<{ isCurrent: boolean }>) => Promise.resolve(choices.find((choice) => choice.isCurrent)));
    treePickerMocks.pickBranchSummary.mockClear();
    await expect(registry.switchBranch(sessionId, "answer", false)).resolves.toEqual({ cancelled: true });
    expect(treePickerMocks.pickBranchSummary).not.toHaveBeenCalled();
  });

  it("does not create a session when none are persisted on open", async () => {
    testEnvironment.cwd = resolve("test/e2e/fixtures/workspace");
    testEnvironment.piExecutable = resolve("test/e2e/fake-pi.cjs");
    const registry = new SessionRegistry(createContext() as never, { error: vi.fn(), info: vi.fn() } as never);
    registries.push(registry);

    await registry.ensureInitialSession();

    const snapshot = registry.snapshot();
    expect(snapshot.activeSessionId).toBeNull();
    expect(snapshot.activeSession).toBeNull();
    expect(snapshot.sessions).toEqual([]);
  });

  it("creates a session in the worktree selected by the host picker", async () => {
    const main = await mkdtemp(join(tmpdir(), "frostpi-registry-main-"));
    const linked = await mkdtemp(join(tmpdir(), "frostpi-registry-linked-"));
    testEnvironment.cwd = main;
    testEnvironment.piExecutable = resolve("test/e2e/fake-pi.cjs");
    testEnvironment.quickPickCwd = linked;
    const registry = new SessionRegistry(
      createContext() as never,
      { error: vi.fn(), info: vi.fn() } as never,
      () => Promise.resolve({
        authoritative: true,
        directories: [
          { cwd: main, workspaceFolderCwd: main, worktreeRoot: main, directoryName: "main", branch: "main", isCurrent: true },
          { cwd: linked, workspaceFolderCwd: main, worktreeRoot: linked, directoryName: "feature-root", branch: "feature/task", isCurrent: false },
        ],
      }),
    );
    registries.push(registry);

    const sessionId = await registry.createSession();

    expect(sessionId).toBeTypeOf("string");
    expect(registry.snapshot().activeSession).toMatchObject({ cwd: linked, workingDirectoryLabel: "feature-root" });
    expect(new Set(testEnvironment.configurationScopes)).toEqual(new Set([main]));
  });

  it("removes persisted sessions only after Git confirms their worktree is gone", async () => {
    const main = await mkdtemp(join(tmpdir(), "frostpi-registry-main-"));
    const removed = resolve(main, "../removed-worktree");
    testEnvironment.cwd = main;
    testEnvironment.piExecutable = resolve("test/e2e/fake-pi.cjs");
    let persisted: unknown = {
      version: 1,
      activeSessionId: "removed",
      sessions: [{ id: "removed", title: "Old task", cwd: removed, updatedAt: 1 }],
    };
    const context = createContext();
    context.workspaceState.get = () => persisted;
    context.workspaceState.update = (_key, value) => {
      persisted = structuredClone(value);
      return Promise.resolve();
    };
    const logger = { error: vi.fn(), info: vi.fn() };
    const registry = new SessionRegistry(
      context as never,
      logger as never,
      () => Promise.resolve({
        authoritative: true,
        directories: [{ cwd: main, workspaceFolderCwd: main, worktreeRoot: main, directoryName: "main", branch: "main", isCurrent: true }],
      }),
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
    testEnvironment.piExecutable = resolve("test/e2e/fake-pi.cjs");
    const context = createContext();
    context.workspaceState.get = () => ({
      version: 1,
      activeSessionId: "uncertain",
      sessions: [{ id: "uncertain", title: "Uncertain task", cwd: external, updatedAt: 1 }],
    });
    const registry = new SessionRegistry(
      context as never,
      { error: vi.fn(), info: vi.fn() } as never,
      () => Promise.resolve({
        authoritative: false,
        directories: [{ cwd: main, workspaceFolderCwd: main, directoryName: "main", isCurrent: true }],
      }),
    );
    registries.push(registry);

    await registry.ensureInitialSession();

    expect(registry.snapshot().sessions).toEqual([expect.objectContaining({ id: "uncertain", cwd: external })]);
  });

  it("uses the anchor workspace setting when deciding whether to start a restored worktree session", async () => {
    const main = await mkdtemp(join(tmpdir(), "frostpi-registry-main-"));
    const linked = await mkdtemp(join(tmpdir(), "frostpi-registry-linked-"));
    testEnvironment.cwd = main;
    testEnvironment.piExecutable = resolve("test/e2e/fake-pi.cjs");
    testEnvironment.startSessionOnOpenByCwd.set(main, false);
    testEnvironment.startSessionOnOpenByCwd.set(linked, true);
    const context = createContext();
    context.workspaceState.get = () => ({
      version: 1,
      activeSessionId: "linked",
      sessions: [{ id: "linked", title: "Linked task", cwd: linked, updatedAt: 1 }],
    });
    const registry = new SessionRegistry(
      context as never,
      { error: vi.fn(), info: vi.fn() } as never,
      () => Promise.resolve({
        authoritative: true,
        directories: [
          { cwd: main, workspaceFolderCwd: main, worktreeRoot: main, directoryName: "main", branch: "main", isCurrent: true },
          { cwd: linked, workspaceFolderCwd: main, worktreeRoot: linked, directoryName: "linked", branch: "feature/task", isCurrent: false },
        ],
      }),
    );
    registries.push(registry);

    await registry.ensureInitialSession();

    expect(registry.snapshot().activeSession).toMatchObject({ cwd: linked, status: "stopped" });
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
    const registry = new SessionRegistry(createContext() as never, { error: vi.fn(), info: vi.fn() } as never);
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
const sourceFile = process.argv[process.argv.indexOf("--session") + 1];
let sessionFile = sourceFile;
let sessionId = "source";
let sessionName = "Source";
let failReconcile = false;
let pendingForkRequestId;
let messages = [
  { role: "user", content: [{ type: "text", text: "Retry this" }, { type: "image", id: "image", fileName: "shot.png", mimeType: "image/png", data: "AA==", size: 1 }], timestamp: 1 },
  { role: "user", content: "Cancel this", timestamp: 2 },
  { role: "user", content: "Fail refresh", timestamp: 3 },
  { role: "user", content: "Wait", timestamp: 4 },
];
let entries = [
  { type: "message", id: "user-entry", parentId: null, message: { role: "user", content: "Retry this", timestamp: 1 } },
  { type: "message", id: "cancel-entry", parentId: "user-entry", message: { role: "user", content: "Cancel this", timestamp: 2 } },
  { type: "message", id: "fail-entry", parentId: "cancel-entry", message: { role: "user", content: "Fail refresh", timestamp: 3 } },
  { type: "message", id: "wait-entry", parentId: "fail-entry", message: { role: "user", content: "Wait", timestamp: 4 } },
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
      } else if (command.entryId === "wait-entry") {
        pendingForkRequestId = command.id;
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
      process.stdout.write(JSON.stringify({ type: "response", id: pendingForkRequestId, success: true, data: { text: "Wait", cancelled: true } }) + "\n");
      pendingForkRequestId = undefined;
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
    const context = createContext();
    context.workspaceState.update = (_key, value) => {
      persisted = structuredClone(value) as typeof persisted;
      return Promise.resolve();
    };
    const registry = new SessionRegistry(context as never, { error: vi.fn(), info: vi.fn() } as never);
    registries.push(registry);

    const activeId = await registry.openSession({ path: sessionFile, cwd: dir, title: "Source", updatedAt: Date.now() });
    await waitForForkableHistory(registry, "wait-entry");

    await expect(registry.forkMessage(activeId, "fail-entry")).rejects.toThrow("set_session_name failed after Fork");
    await waitForForkableHistory(registry, "wait-entry");
    expect(registry.snapshot().sessions).toEqual([expect.objectContaining({ id: activeId, status: "ready" })]);

    const pendingFork = registry.forkMessage(activeId, "wait-entry");
    await waitFor(() => registry.snapshot().activeSession?.isForking === true && registry.snapshot().activeSession?.pendingExtensionUi.length === 1);
    await expect(registry.createSession()).rejects.toThrow("cancel it first");
    await registry.cancelFork(activeId);
    await expect(pendingFork).resolves.toEqual({ cancelled: true });
    await waitForForkableHistory(registry, "wait-entry");

    await expect(registry.forkMessage(activeId, "cancel-entry")).resolves.toEqual({ cancelled: true });
    expect(registry.snapshot().sessions).toHaveLength(1);
    expect(registry.snapshot().activeSession).toMatchObject({ id: activeId, title: "Source", sessionId: "source" });

    const result = await registry.forkMessage(activeId, "user-entry");

    expect(result.cancelled).toBe(false);
    expect(typeof result.forkSessionId).toBe("string");
    expect(result.forkSessionId).not.toBe(activeId);
    expect(registry.snapshot().activeSession).toMatchObject({
      id: result.forkSessionId,
      title: "Fork: Source",
      sessionId: "fork",
      turns: [],
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
    testEnvironment.cwd = resolve("test/e2e/fixtures/workspace");
    testEnvironment.piExecutable = resolve("test/e2e/fake-pi.cjs");
    let persisted: unknown;
    const context = {
      workspaceState: {
        get: () => persisted,
        update: (_key: string, value: unknown) => {
          persisted = structuredClone(value);
          return Promise.resolve();
        },
      },
      secrets: {
        get: () => Promise.resolve(undefined),
        store: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
    };
    const logger = { error: vi.fn(), info: vi.fn() };
    const registry = new SessionRegistry(context as never, logger as never);
    registries.push(registry);

    const first = (await registry.createSession())!;
    expect(registry.snapshot().sessions.map((session) => session.id)).toEqual([first]);
    expect((persisted as { sessions: unknown[] }).sessions).toHaveLength(0);

    const second = (await registry.createSession())!;
    expect(registry.snapshot().sessions.map((session) => session.id)).toEqual([second]);

    await registry.sendPrompt(second, "Keep this session", []);
    expect((persisted as { sessions: Array<{ id: string }> }).sessions.map((session) => session.id)).toEqual([second]);
    const turnsBeforeCompaction = registry.snapshot().activeSession?.turns.length;

    await expect(registry.sendPrompt(second, "/compact Keep code changes", [{
      id: "image",
      name: "image.png",
      mimeType: "image/png",
      data: "AA==",
      size: 1,
    }])).rejects.toThrow("/compact does not support image attachments");

    await registry.sendPrompt(second, "/compact Keep code changes", []);
    expect(registry.snapshot().activeSession?.turns).toHaveLength(turnsBeforeCompaction ?? 0);
    expect(registry.snapshot().activeSession?.compactions).toEqual([
      expect.objectContaining({ summary: "Compacted context: Keep code changes", tokensBefore: 42_000 }),
    ]);

    const third = (await registry.createSession())!;
    expect(new Set(registry.snapshot().sessions.map((session) => session.id))).toEqual(new Set([second, third]));
    expect((persisted as { sessions: Array<{ id: string }> }).sessions.map((session) => session.id)).toEqual([second]);
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
    vscodeMocks.showInformationMessage.mockClear();
    vscodeMocks.showErrorMessage.mockClear();
    const registry = new SessionRegistry(createContext() as never, { error: vi.fn(), info: vi.fn() } as never);
    registries.push(registry);

    const sessionId = (await registry.createSession())!;
    await waitFor(() => registry.snapshot().activeSession?.status === "ready");
    await registry.sendPrompt(sessionId, "ask", []);
    await waitFor(() => registry.snapshot().activeSession?.pendingExtensionUi.length === 1);
    expect(windowsToastMocks.showWindowsToast).not.toHaveBeenCalled();

    await registry.respondExtensionUi(sessionId, "answer", { confirmed: true });
    await waitFor(() => registry.snapshot().activeSession?.pendingExtensionUi.length === 0);
    testEnvironment.windowFocused = false;
    windowsToastMocks.showWindowsToast.mockResolvedValueOnce(false);
    await registry.sendPrompt(sessionId, "ask", []);
    await waitFor(() => vscodeMocks.showInformationMessage.mock.calls.length === 1);
    expect(windowsToastMocks.showWindowsToast).toHaveBeenCalledWith(
      "FrostPi needs your attention",
      "FrostPi is waiting for your input.",
      {},
    );
    expect(vscodeMocks.showInformationMessage).toHaveBeenCalledWith("FrostPi is waiting for your input.");

    await registry.respondExtensionUi(sessionId, "answer", { confirmed: true });
    await waitFor(() => registry.snapshot().activeSession?.pendingExtensionUi.length === 0);
    testEnvironment.experimentalNotificationsEnabled = false;
    await registry.sendPrompt(sessionId, "ask", []);
    await waitFor(() => registry.snapshot().activeSession?.pendingExtensionUi.length === 1);
    expect(windowsToastMocks.showWindowsToast).toHaveBeenCalledOnce();

    await registry.respondExtensionUi(sessionId, "answer", { confirmed: true });
    await waitFor(() => registry.snapshot().activeSession?.pendingExtensionUi.length === 0);
    testEnvironment.experimentalNotificationsEnabled = true;

    await registry.sendPrompt(sessionId, "complete", []);
    await waitFor(() => registry.snapshot().activeSession?.turns.at(-1)?.status === "completed");
    await waitFor(() => windowsToastMocks.showWindowsToast.mock.calls.length === 2);
    expect(windowsToastMocks.showWindowsToast).toHaveBeenLastCalledWith(
      "FrostPi turn completed",
      "FrostPi completed an agent turn.",
      {},
    );

    await registry.sendPrompt(sessionId, "hold", []);
    await waitFor(() => registry.snapshot().activeSession?.isStreaming === true);
    await registry.abort(sessionId);
    await waitFor(() => registry.snapshot().activeSession?.status === "ready");
    expect(windowsToastMocks.showWindowsToast).toHaveBeenCalledTimes(2);

    await registry.sendPrompt(sessionId, "fail", []);
    await waitFor(() => registry.snapshot().activeSession?.status === "failed");
    await waitFor(() => windowsToastMocks.showWindowsToast.mock.calls.length === 3);
    expect(windowsToastMocks.showWindowsToast).toHaveBeenLastCalledWith(
      "FrostPi needs your attention",
      "A FrostPi session failed. Open VS Code for details.",
      {},
    );
    expect(vscodeMocks.showErrorMessage).not.toHaveBeenCalled();
  });

  it("replaces composer text for set_editor_text on the active session and defers inactive sessions", async () => {
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

    const registry = new SessionRegistry(createContext() as never, { error: vi.fn(), info: vi.fn() } as never);
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

    // Background session keeps the latest editor text until activation.
    await registry.sendPrompt(background, "/input-file", []);
    expect(events).toEqual([]);

    await registry.activateSession(background);
    expect(events).toEqual([{ sessionId: background, text: "imported from .pi-input.md" }]);
  });
});

async function waitForForkableHistory(registry: InstanceType<typeof SessionRegistry>, lastEntryId: string): Promise<void> {
  await waitFor(() => {
    const active = registry.snapshot().activeSession;
    return active?.status === "ready"
      && active.historyStatus === "loaded"
      && active.turns.at(-1)?.userMessage?.sourceEntryId === lastEntryId;
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function createContext(): {
  workspaceState: { get(): unknown; update(key: string, value: unknown): Promise<void> };
  secrets: { get(): Promise<undefined>; store(): Promise<void>; delete(): Promise<void> };
} {
  let persisted: unknown;
  return {
    workspaceState: {
      get: () => persisted,
      update: (_key, value) => {
        persisted = structuredClone(value);
        return Promise.resolve();
      },
    },
    secrets: {
      get: () => Promise.resolve(undefined),
      store: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    },
  };
}
