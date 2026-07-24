import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  workspace: {
    workspaceFolders: [],
    getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
  },
  extensions: { getExtension: () => undefined },
}));

const { ProxySecretStore } = await import("../../src/extension/network/ProxySecretStore.js");
const { SessionRuntime } = await import("../../src/extension/sessions/SessionRuntime.js");

describe("Pi session startup and conversation history", () => {
  const runtimes: InstanceType<typeof SessionRuntime>[] = [];

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  });

  it("makes a resumed session ready before explicitly loading a large history", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-runtime-"));
    const sessionFile = join(dir, "large.jsonl");
    await writeFile(sessionFile, Buffer.alloc(8 * 1024 * 1024 + 1));
    const fakePi = join(dir, "fake-pi.cjs");
    await writeFile(fakePi, String.raw`#!/usr/bin/env node
const sessionIndex = process.argv.indexOf("--session");
const sessionFile = sessionIndex >= 0 ? process.argv[sessionIndex + 1] : undefined;
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  input += chunk;
  while (input.includes("\n")) {
    const index = input.indexOf("\n");
    const command = JSON.parse(input.slice(0, index));
    input = input.slice(index + 1);
    const base = { type: "response", id: command.id, success: true };
    if (command.type === "get_state") base.data = { model: null, thinkingLevel: "off", isStreaming: false, isCompacting: false, sessionFile, sessionId: "history-test" };
    else if (command.type === "get_messages") {
      process.stdout.write(JSON.stringify({ type: "extension_ui_request", id: "notice-during-history", method: "notify", message: "Notice during history load" }) + "\n");
      process.stdout.write(JSON.stringify({ type: "message_start", message: { id: "live-assistant", role: "assistant", timestamp: 2, content: [{ type: "text", text: "Live response" }] } }) + "\n");
      process.stdout.write(JSON.stringify({ type: "message_end", message: { id: "live-assistant", role: "assistant", timestamp: 2, stopReason: "stop", content: [{ type: "text", text: "Live response" }] } }) + "\n");
      setTimeout(() => {
        base.data = { messages: [{ role: "user", content: "Earlier request", timestamp: 1 }] };
        process.stdout.write(JSON.stringify(base) + "\n");
      }, 25);
      continue;
    }
    else if (command.type === "prompt") {
      process.stdout.write(JSON.stringify(base) + "\n");
      process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\n");
      continue;
    }
    else if (command.type === "get_entries") base.data = {
      entries: [{ type: "message", id: "history-user-entry", parentId: null, message: { role: "user", content: "Earlier request", timestamp: 1 } }],
      leafId: "history-user-entry",
    };
    else if (command.type === "get_available_models") base.data = { models: [] };
    else if (command.type === "get_commands") base.data = { commands: [] };
    else if (command.type === "get_session_stats") base.data = { sessionFile, sessionId: "history-test", userMessages: 1, assistantMessages: 0, toolCalls: 0, toolResults: 0, totalMessages: 1, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };
    process.stdout.write(JSON.stringify(base) + "\n");
  }
});
process.on("SIGTERM", () => process.exit(0));
`);

    const configuration = {
      piExecutable: fakePi,
      piArguments: [],
      startSessionOnOpen: true,
      streamingBehavior: "followUp" as const,
      collapseTurnTrace: true,
      questionToolEnabled: false,
      maxImageBytes: 10 * 1024 * 1024,
      diagnosticsLevel: "info" as const,
      proxy: { mode: "inherit" as const },
      fileMentionRespectSearchExclude: true,
      fileMentionRespectIgnoreFiles: true,
      fileMentionFollowSymlinks: true,
    };
    const secrets = new ProxySecretStore({ get: () => Promise.resolve(undefined) } as never);
    const logger = { error: vi.fn(), info: vi.fn() };
    const runtime = new SessionRuntime("session", dir, "History", Date.now(), () => configuration, secrets, logger as never, {
      onChange: vi.fn(),
      onEditorText: vi.fn(),
    });
    runtimes.push(runtime);

    await runtime.start(sessionFile);
    expect(runtime.view.status).toBe("ready");
    expect(runtime.view.historyStatus).toBe("queued");
    expect(runtime.view.turns).toHaveLength(0);

    await runtime.loadHistory(false);
    expect(runtime.view.historyStatus).toBe("deferred");
    expect(runtime.view.turns).toHaveLength(0);

    const repeatedAutomaticLoad = runtime.loadHistory(false);
    const explicitLoad = runtime.loadHistory(true);
    await Promise.all([repeatedAutomaticLoad, explicitLoad]);
    expect(runtime.view.historyStatus).toBe("loaded");
    expect(runtime.view.turns).toHaveLength(2);
    expect(runtime.view.turns.flatMap((turn) => turn.activities)).toContainEqual(
      expect.objectContaining({ type: "response", blocks: [{ type: "text", text: "Live response" }] }),
    );
    expect(runtime.view.notices).toEqual([
      expect.objectContaining({ text: "Notice during history load" }),
    ]);

    await runtime.sendPrompt("New request", []);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runtime.view.isStreaming).toBe(true);
    runtime.markHistoryWaiting();
    await expect(runtime.loadHistory(true)).rejects.toThrow("Stop the running session");
    expect(runtime.view.historyStatus).toBe("deferred");
  });

  it("trims slash text, executes extension commands with args, and closes the local turn without agent events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-runtime-ext-"));
    const fakePi = join(dir, "fake-pi.cjs");
    await writeFile(fakePi, String.raw`#!/usr/bin/env node
let input = "";
let promptCount = 0;
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  input += chunk;
  while (input.includes("\n")) {
    const index = input.indexOf("\n");
    const command = JSON.parse(input.slice(0, index));
    input = input.slice(index + 1);
    const base = { type: "response", id: command.id, success: true };
    if (command.type === "get_state") {
      base.data = {
        model: null,
        thinkingLevel: "off",
        isStreaming: false,
        isCompacting: false,
        pendingMessageCount: 0,
        sessionFile: undefined,
        sessionId: "extension-cmd",
      };
    } else if (command.type === "get_commands") {
      base.data = {
        commands: [
          { name: "toggle-web-proxy", description: "Toggle proxy", source: "extension" },
          { name: "inspect", description: "Inspect", source: "prompt" },
        ],
      };
    } else if (command.type === "get_available_models") base.data = { models: [] };
    else if (command.type === "get_session_stats") {
      base.data = {
        sessionId: "extension-cmd",
        userMessages: 0,
        assistantMessages: 0,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        cost: 0,
      };
    } else if (command.type === "prompt") {
      promptCount += 1;
      process.stdout.write(JSON.stringify({
        type: "extension_ui_request",
        id: "proxy-notify-" + promptCount,
        method: "notify",
        notifyType: "info",
        message: "Proxy enabled\nHTTP_PROXY=http://127.0.0.1:10808\nargs=" + String(command.message),
      }) + "\n");
      process.stdout.write(JSON.stringify(base) + "\n");
      continue;
    }
    process.stdout.write(JSON.stringify(base) + "\n");
  }
});
process.on("SIGTERM", () => process.exit(0));
`);

    const configuration = {
      piExecutable: fakePi,
      piArguments: [],
      startSessionOnOpen: true,
      streamingBehavior: "followUp" as const,
      collapseTurnTrace: true,
      questionToolEnabled: false,
      maxImageBytes: 10 * 1024 * 1024,
      diagnosticsLevel: "info" as const,
      proxy: { mode: "inherit" as const },
      fileMentionRespectSearchExclude: true,
      fileMentionRespectIgnoreFiles: true,
      fileMentionFollowSymlinks: true,
    };
    const secrets = new ProxySecretStore({ get: () => Promise.resolve(undefined) } as never);
    const logger = { error: vi.fn(), info: vi.fn() };
    const runtime = new SessionRuntime("session", dir, "Extension command", Date.now(), () => configuration, secrets, logger as never, {
      onChange: vi.fn(),
      onEditorText: vi.fn(),
    });
    runtimes.push(runtime);

    await runtime.start();
    await waitFor(() => runtime.view.commands.some((command) => command.name === "toggle-web-proxy"));

    await runtime.sendPrompt("  /toggle-web-proxy on  ", []);

    expect(runtime.view.isStreaming).toBe(false);
    expect(runtime.view.status).toBe("ready");
    expect(runtime.view.turns).toHaveLength(1);
    expect(runtime.view.turns[0]?.userMessage?.blocks).toEqual([
      { type: "text", text: "/toggle-web-proxy on" },
    ]);
    expect(runtime.view.turns[0]?.status).toBe("completed");
    const notice = runtime.view.turns[0]?.activities.find((activity) => activity.type === "notice");
    expect(notice?.type).toBe("notice");
    if (notice?.type === "notice") {
      expect(notice.text).toContain("args=/toggle-web-proxy on");
    }
  });

  it("does not force-complete a known non-extension slash that starts an agent run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-runtime-prompt-"));
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
    const base = { type: "response", id: command.id, success: true };
    if (command.type === "get_state") {
      base.data = { model: null, thinkingLevel: "off", isStreaming: false, isCompacting: false, pendingMessageCount: 0, sessionId: "prompt-cmd" };
    } else if (command.type === "get_commands") {
      base.data = { commands: [{ name: "inspect", description: "Inspect", source: "prompt" }] };
    } else if (command.type === "get_available_models") base.data = { models: [] };
    else if (command.type === "get_session_stats") {
      base.data = { sessionId: "prompt-cmd", userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0, totalMessages: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };
    } else if (command.type === "prompt") {
      process.stdout.write(JSON.stringify(base) + "\n");
      process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\n");
      continue;
    }
    process.stdout.write(JSON.stringify(base) + "\n");
  }
});
process.on("SIGTERM", () => process.exit(0));
`);

    const configuration = {
      piExecutable: fakePi,
      piArguments: [],
      startSessionOnOpen: true,
      streamingBehavior: "followUp" as const,
      collapseTurnTrace: true,
      questionToolEnabled: false,
      maxImageBytes: 10 * 1024 * 1024,
      diagnosticsLevel: "info" as const,
      proxy: { mode: "inherit" as const },
      fileMentionRespectSearchExclude: true,
      fileMentionRespectIgnoreFiles: true,
      fileMentionFollowSymlinks: true,
    };
    const secrets = new ProxySecretStore({ get: () => Promise.resolve(undefined) } as never);
    const logger = { error: vi.fn(), info: vi.fn() };
    const runtime = new SessionRuntime("session", dir, "Prompt command", Date.now(), () => configuration, secrets, logger as never, {
      onChange: vi.fn(),
      onEditorText: vi.fn(),
    });
    runtimes.push(runtime);

    await runtime.start();
    await waitFor(() => runtime.view.commands.some((command) => command.name === "inspect"));

    await runtime.sendPrompt("/inspect src", []);
    await waitFor(() => runtime.view.isStreaming);

    // Misclassifying as extension would force-complete after idle checks.
    expect(runtime.view.turns[0]?.status).toBe("running");
    expect(runtime.view.turns[0]?.userMessage?.blocks).toEqual([{ type: "text", text: "/inspect src" }]);
  });

  it("parks follow-up prompts while streaming and clears them on abort", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-runtime-followup-"));
    const fakePi = join(dir, "fake-pi.cjs");
    await writeFile(fakePi, String.raw`#!/usr/bin/env node
let input = "";
let streaming = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  input += chunk;
  while (input.includes("\n")) {
    const index = input.indexOf("\n");
    const command = JSON.parse(input.slice(0, index));
    input = input.slice(index + 1);
    const base = { type: "response", id: command.id, success: true };
    if (command.type === "get_state") {
      base.data = { model: null, thinkingLevel: "off", isStreaming: streaming, isCompacting: false, pendingMessageCount: 0, sessionId: "followup" };
    } else if (command.type === "get_commands") base.data = { commands: [] };
    else if (command.type === "get_available_models") base.data = { models: [] };
    else if (command.type === "get_session_stats") {
      base.data = { sessionId: "followup", userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0, totalMessages: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };
    } else if (command.type === "prompt") {
      process.stdout.write(JSON.stringify(base) + "\n");
      if (!streaming) {
        streaming = true;
        process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\n");
      } else {
        streaming = false;
        process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\n");
      }
      continue;
    } else if (command.type === "abort") {
      streaming = false;
      process.stdout.write(JSON.stringify(base) + "\n");
      process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\n");
      continue;
    }
    process.stdout.write(JSON.stringify(base) + "\n");
  }
});
process.on("SIGTERM", () => process.exit(0));
`);

    const configuration = {
      piExecutable: fakePi,
      piArguments: [],
      startSessionOnOpen: true,
      streamingBehavior: "followUp" as const,
      collapseTurnTrace: true,
      questionToolEnabled: false,
      maxImageBytes: 10 * 1024 * 1024,
      diagnosticsLevel: "info" as const,
      proxy: { mode: "inherit" as const },
      fileMentionRespectSearchExclude: true,
      fileMentionRespectIgnoreFiles: true,
      fileMentionFollowSymlinks: true,
    };
    const secrets = new ProxySecretStore({ get: () => Promise.resolve(undefined) } as never);
    const logger = { error: vi.fn(), info: vi.fn() };
    const runtime = new SessionRuntime("session", dir, "Follow-up", Date.now(), () => configuration, secrets, logger as never, {
      onChange: vi.fn(),
      onEditorText: vi.fn(),
    });
    runtimes.push(runtime);

    await runtime.start();
    await runtime.sendPrompt("first", []);
    await waitFor(() => runtime.view.isStreaming);
    expect(runtime.view.turns).toHaveLength(1);

    await runtime.sendPrompt("queued later", []);
    await waitFor(() => runtime.view.status === "ready");
    expect(runtime.view.turns).toHaveLength(1);
    expect(runtime.view.queuedFollowUps.map((item) => item.text)).toEqual(["queued later"]);
    await expect(runtime.executeFork("any-entry")).rejects.toThrow("Wait for queued follow-ups to settle");

    await runtime.abort();
    expect(runtime.view.queuedFollowUps).toEqual([]);
  });

  it("refreshes session stats during a long running turn", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-runtime-live-stats-"));
    const fakePi = join(dir, "fake-pi.cjs");
    await writeFile(fakePi, String.raw`#!/usr/bin/env node
let input = "";
let statsRequests = 0;
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  input += chunk;
  while (input.includes("\n")) {
    const index = input.indexOf("\n");
    const command = JSON.parse(input.slice(0, index));
    input = input.slice(index + 1);
    const base = { type: "response", id: command.id, success: true };
    if (command.type === "get_state") {
      base.data = { model: { provider: "fake", id: "fake-model", contextWindow: 10000 }, thinkingLevel: "off", isStreaming: false, isCompacting: false, pendingMessageCount: 0, sessionId: "live-stats" };
    } else if (command.type === "get_commands") base.data = { commands: [] };
    else if (command.type === "get_available_models") base.data = { models: [] };
    else if (command.type === "get_session_stats") {
      statsRequests += 1;
      base.data = {
        sessionId: "live-stats",
        userMessages: 1,
        assistantMessages: 0,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: 1,
        tokens: { input: statsRequests, output: 0, cacheRead: 0, cacheWrite: 0, total: statsRequests },
        cost: 0,
        contextUsage: { tokens: statsRequests * 100, contextWindow: 10000, percent: statsRequests },
      };
    } else if (command.type === "prompt") {
      process.stdout.write(JSON.stringify(base) + "\n");
      process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\n");
      continue;
    }
    process.stdout.write(JSON.stringify(base) + "\n");
  }
});
process.on("SIGTERM", () => process.exit(0));
`);

    const configuration = {
      piExecutable: fakePi,
      piArguments: [],
      startSessionOnOpen: true,
      streamingBehavior: "followUp" as const,
      collapseTurnTrace: true,
      questionToolEnabled: false,
      maxImageBytes: 10 * 1024 * 1024,
      diagnosticsLevel: "info" as const,
      proxy: { mode: "inherit" as const },
      fileMentionRespectSearchExclude: true,
      fileMentionRespectIgnoreFiles: true,
      fileMentionFollowSymlinks: true,
    };
    const secrets = new ProxySecretStore({ get: () => Promise.resolve(undefined) } as never);
    const logger = { error: vi.fn(), info: vi.fn() };
    const runtime = new SessionRuntime("session", dir, "Live stats", Date.now(), () => configuration, secrets, logger as never, {
      onChange: vi.fn(),
      onEditorText: vi.fn(),
    });
    runtimes.push(runtime);

    await runtime.start();
    await waitFor(() => runtime.view.stats?.contextUsage?.tokens === 100);

    await runtime.sendPrompt("long turn", []);
    await waitFor(() => runtime.view.isStreaming);

    await waitFor(() => (runtime.view.stats?.contextUsage?.tokens ?? 0) > 100, 4_500);
    expect(runtime.view.stats?.contextUsage?.tokens).toBeGreaterThan(100);
  });

  it("loads the bundled capability and reconciles committed tree navigation in the same runtime", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-runtime-tree-"));
    const fakePi = join(dir, "fake-pi.cjs");
    const artifactPath = join(dir, "session-tree.js");
    const launchRecord = join(dir, "launch.json");
    await writeFile(artifactPath, "export default () => {};\n");
    await writeFile(fakePi, String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const extensionIndex = process.argv.indexOf("-e");
const artifactPath = extensionIndex >= 0 ? process.argv[extensionIndex + 1] : "";
fs.writeFileSync(${JSON.stringify(launchRecord)}, JSON.stringify({
  artifactPath,
  resultDirectory: process.env.FROSTPI_SESSION_TREE_RESULT_DIR,
  hasToken: Boolean(process.env.FROSTPI_SESSION_TREE_TOKEN),
}));
const entries = [
  { type: "message", id: "root", parentId: null, timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: "Start", timestamp: 1 } },
  { type: "message", id: "answer", parentId: "root", timestamp: "2026-01-01T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "Answer" }], timestamp: 2 } },
  { type: "message", id: "old-user", parentId: "answer", timestamp: "2026-01-01T00:00:03.000Z", message: { role: "user", content: "Old path", timestamp: 3 } },
  { type: "message", id: "old-end", parentId: "old-user", timestamp: "2026-01-01T00:00:04.000Z", message: { role: "assistant", content: [{ type: "text", text: "Old end" }], timestamp: 4 } },
  { type: "message", id: "target-user", parentId: "answer", timestamp: "2026-01-01T00:00:05.000Z", message: { role: "user", content: [{ type: "text", text: "Revise this" }, { type: "image", id: "image", fileName: "shot.png", mimeType: "image/png", data: "AA==", size: 1 }], timestamp: 5 } },
];
let leafId = "old-end";
let messages = [entries[0].message, entries[1].message, entries[2].message, entries[3].message];
let failMessages = false;
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  input += chunk;
  while (input.includes("\n")) {
    const index = input.indexOf("\n");
    const command = JSON.parse(input.slice(0, index));
    input = input.slice(index + 1);
    const response = { type: "response", id: command.id, success: true };
    if (command.type === "get_state") response.data = { model: null, thinkingLevel: "off", isStreaming: false, isCompacting: false, pendingMessageCount: 0, sessionId: "tree-session" };
    else if (command.type === "get_messages") {
      if (failMessages) {
        response.success = false;
        response.error = "hydrate failed";
        failMessages = false;
      } else response.data = { messages };
    }
    else if (command.type === "get_entries") response.data = { entries, leafId };
    else if (command.type === "get_available_models") response.data = { models: [] };
    else if (command.type === "get_commands") response.data = { commands: [
      { name: "frostpi.session-tree:1", source: "extension", sourceInfo: { path: artifactPath, source: "local", scope: "temporary", origin: "top-level" } },
      { name: "visible", source: "extension", sourceInfo: { path: path.join(__dirname, "visible.js"), source: "local", scope: "temporary", origin: "top-level" } },
    ] };
    else if (command.type === "get_session_stats") response.data = { sessionId: "tree-session", userMessages: 3, assistantMessages: 2, toolCalls: 0, toolResults: 0, totalMessages: 5, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };
    else if (command.type === "prompt") {
      const encoded = command.message.split(" ")[1];
      const request = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
      if (request.token !== process.env.FROSTPI_SESSION_TREE_TOKEN) throw new Error("wrong token");
      let status = "committed";
      if (request.customInstructions === "cancel") status = "cancelled";
      else if (request.customInstructions === "fail") status = "failed";
      else {
        leafId = "answer";
        messages = [entries[0].message, entries[1].message];
        if (request.customInstructions === "hydrate-fail") failMessages = true;
      }
      fs.writeFileSync(path.join(process.env.FROSTPI_SESSION_TREE_RESULT_DIR, request.requestId + ".json"), JSON.stringify({ version: 1, requestId: request.requestId, status, leafId }));
    }
    process.stdout.write(JSON.stringify(response) + "\n");
  }
});
process.on("SIGTERM", () => process.exit(0));
`);

    const configuration = {
      piExecutable: fakePi,
      piArguments: ["--no-extensions"],
      startSessionOnOpen: true,
      streamingBehavior: "followUp" as const,
      collapseTurnTrace: true,
      questionToolEnabled: false,
      maxImageBytes: 10 * 1024 * 1024,
      diagnosticsLevel: "info" as const,
      proxy: { mode: "inherit" as const },
      fileMentionRespectSearchExclude: true,
      fileMentionRespectIgnoreFiles: true,
      fileMentionFollowSymlinks: true,
    };
    const secrets = new ProxySecretStore({ get: () => Promise.resolve(undefined) } as never);
    const runtime = new SessionRuntime("session", dir, "Tree", Date.now(), () => configuration, secrets, { error: vi.fn(), info: vi.fn() } as never, {
      onChange: vi.fn(),
      onEditorText: vi.fn(),
    }, artifactPath);
    runtimes.push(runtime);

    await runtime.start();
    await waitFor(() => runtime.view.sessionTreeAvailable);
    const launch = JSON.parse(await readFile(launchRecord, "utf8")) as { artifactPath: string; resultDirectory: string; hasToken: boolean };
    expect(launch).toMatchObject({ artifactPath, hasToken: true });
    expect(runtime.view.commands.map((command) => command.name)).toEqual(["visible"]);
    await runtime.refreshCommands();
    expect(runtime.view.commands.map((command) => command.name)).toEqual(["visible"]);
    await expect(runtime.probePiIntegration()).resolves.toEqual({
      available: true,
      commandName: "frostpi.session-tree:1",
    });
    expect(runtime.view.commands.map((command) => command.name)).toEqual(["visible"]);
    expect(runtime.view.branchControls).toEqual([
      expect.objectContaining({ branchPointId: "answer", anchorEntryId: "old-user", pathCount: 2 }),
    ]);
    expect((await runtime.listBranchEnds("answer")).map((choice) => choice.targetId)).toEqual(["old-end", "target-user"]);

    await expect(runtime.navigateTree("target-user", { summarize: true, customInstructions: "cancel" }))
      .resolves.toEqual({ cancelled: true });
    expect(runtime.view.historyStatus).toBe("loaded");
    await expect(runtime.navigateTree("target-user", { summarize: true, customInstructions: "fail" }))
      .rejects.toThrow("Pi did not commit");
    expect(runtime.view.historyStatus).toBe("loaded");

    const result = await runtime.navigateTree("target-user", { summarize: false });

    expect(runtime.id).toBe("session");
    expect(runtime.view.sessionId).toBe("tree-session");
    expect(runtime.view.turns).toHaveLength(1);
    expect(result).toEqual({
      cancelled: false,
      seed: {
        id: "tree-target-user",
        text: "Revise this",
        images: [{ id: "image", name: "shot.png", mimeType: "image/png", dataUrl: "data:image/png;base64,AA==", size: 1 }],
      },
    });

    await expect(runtime.navigateTree("old-user", { summarize: true, customInstructions: "hydrate-fail" }))
      .rejects.toThrow("hydrate failed");
    expect(runtime.view.historyStatus).toBe("failed");

    await runtime.stop();
    await expect(access(launch.resultDirectory)).rejects.toThrow();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
