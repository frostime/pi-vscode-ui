import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentTurnView, SessionNoticeView } from "../../src/shared/model/conversationModel.js";
import type { SessionViewModel } from "../../src/shared/model/sessionViewModel.js";

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

  it("projects a Pi 0.84 stream through the child-process path and persisted takeover", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-stream-084-"));
    const runtime = new SessionRuntime(
      "stream-084",
      dir,
      "Streaming",
      () => runtimeConfiguration(join(process.cwd(), "test", "e2e", "fake-pi.cjs")),
      new ProxySecretStore({ get: () => Promise.resolve(undefined) } as never),
      { error: vi.fn(), info: vi.fn() } as never,
      { onChange: vi.fn(), onEditorText: vi.fn() },
    );
    runtimes.push(runtime);

    await runtime.start();
    await runtime.sendPrompt("stream-084", []);
    await waitFor(() => projectedTools(runtime.view).some((tool) => tool.state === "preparing" && tool.rawArguments.includes("stream.ts")));

    const preparingActivity = conversationTurns(runtime.view)
      .flatMap((turn) => turn.items)
      .find((item) => item.type === "tool");
    expect(preparingActivity?.id).toContain(":tool:2");
    expect(preparingActivity?.type === "tool" ? preparingActivity.tool : undefined).toMatchObject({
      state: "preparing",
      status: "running",
    });
    expect(conversationText(runtime.view)).toEqual(expect.arrayContaining(["Checking", "Streaming"]));

    await waitFor(() => runtime.view.status === "ready" && projectedTools(runtime.view).some((tool) => tool.state === "bound" && tool.status === "complete"));
    await waitFor(() => conversationTurns(runtime.view)[0]?.userMessage?.sourceEntryId !== undefined);
    const finalActivity = conversationTurns(runtime.view)
      .flatMap((turn) => turn.items)
      .find((item) => item.type === "tool");
    expect(finalActivity).toMatchObject({
      id: preparingActivity?.id,
      tool: { state: "bound", status: "complete", output: "file body" },
    });
    expect(conversationText(runtime.view)).toEqual(expect.arrayContaining(["Checked the file", "Streaming response"]));
  });

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  });

  it("launches temporary sessions with --no-session only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-runtime-ephemeral-"));
    const argsFile = join(dir, "args.json");
    const configuration = argsRecordingConfiguration(await writeArgsRecordingPi(dir));
    const previousArgsFile = process.env.FROSTPI_TEST_ARGS_FILE;
    process.env.FROSTPI_TEST_ARGS_FILE = argsFile;
    const secrets = new ProxySecretStore({ get: () => Promise.resolve(undefined) } as never);
    const hooks = { onChange: vi.fn(), onEditorText: vi.fn() };
    try {
      const ephemeral = new SessionRuntime("temporary", dir, "Temporary", () => configuration, secrets, { error: vi.fn(), info: vi.fn() } as never, hooks, undefined, undefined, true);
      runtimes.push(ephemeral);
      await ephemeral.start(join(dir, "must-not-be-used.jsonl"));
      expect(JSON.parse(await readFile(argsFile, "utf8"))).toEqual(expect.arrayContaining(["--no-extensions", "--no-session"]));
      expect(JSON.parse(await readFile(argsFile, "utf8"))).not.toContain("--session");

      const regular = new SessionRuntime("regular", dir, "Regular", () => configuration, secrets, { error: vi.fn(), info: vi.fn() } as never, hooks);
      runtimes.push(regular);
      await regular.start();
      expect(JSON.parse(await readFile(argsFile, "utf8"))).not.toContain("--no-session");
    } finally {
      if (previousArgsFile === undefined) delete process.env.FROSTPI_TEST_ARGS_FILE;
      else process.env.FROSTPI_TEST_ARGS_FILE = previousArgsFile;
    }
  });

  it("appends custom launch arguments verbatim and reuses them across restarts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-runtime-custom-args-"));
    const argsFile = join(dir, "args.json");
    const configuration = argsRecordingConfiguration(await writeArgsRecordingPi(dir));
    const previousArgsFile = process.env.FROSTPI_TEST_ARGS_FILE;
    process.env.FROSTPI_TEST_ARGS_FILE = argsFile;
    const secrets = new ProxySecretStore({ get: () => Promise.resolve(undefined) } as never);
    const hooks = { onChange: vi.fn(), onEditorText: vi.fn() };
    try {
      const runtime = new SessionRuntime("custom-args", dir, "Custom", () => configuration, secrets, { error: vi.fn(), info: vi.fn() } as never, hooks, undefined, undefined, false, ["--model", "sonnet"]);
      runtimes.push(runtime);
      await runtime.start();
      const launchedArgs: string[] = JSON.parse(await readFile(argsFile, "utf8")) as string[];
      expect(launchedArgs).toEqual(expect.arrayContaining(["--model", "sonnet"]));
      // Verbatim append: custom tokens come after every FrostPi-owned argument.
      expect(launchedArgs.indexOf("sonnet")).toBeGreaterThan(launchedArgs.indexOf("--no-extensions"));

      await runtime.stop();
      await runtime.start();
      expect(JSON.parse(await readFile(argsFile, "utf8"))).toEqual(expect.arrayContaining(["--model", "sonnet"]));
    } finally {
      if (previousArgsFile === undefined) delete process.env.FROSTPI_TEST_ARGS_FILE;
      else process.env.FROSTPI_TEST_ARGS_FILE = previousArgsFile;
    }
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
    else if (command.type === "prompt") {
      process.stdout.write(JSON.stringify(base) + "\n");
      process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\n");
      continue;
    }
    else if (command.type === "get_entries" && !command.since) {
      process.stdout.write(JSON.stringify({ type: "extension_ui_request", id: "notice-during-history", method: "notify", message: "Notice during history load" }) + "\n");
      process.stdout.write(JSON.stringify({ type: "message_start", message: { id: "live-assistant", role: "assistant", timestamp: 2, content: [{ type: "text", text: "Live response" }] } }) + "\n");
      process.stdout.write(JSON.stringify({ type: "message_end", message: { id: "live-assistant", role: "assistant", timestamp: 2, stopReason: "stop", content: [{ type: "text", text: "Live response" }] } }) + "\n");
      process.stdout.write(JSON.stringify({ type: "compaction_end", result: { summary: "History compact", tokensBefore: 100, firstKeptEntryId: "kept-history" } }) + "\n");
      setTimeout(() => {
        base.data = {
          entries: [
            { type: "message", id: "history-user-entry", parentId: null, message: { role: "user", content: "Earlier request", timestamp: 1 } },
            { type: "message", id: "history-assistant-entry", parentId: "history-user-entry", message: { id: "live-assistant", role: "assistant", timestamp: 2, stopReason: "stop", content: [{ type: "text", text: "Live response" }], usage: { input: 100, output: 20, cacheRead: 300, cacheWrite: 100 } } },
            { type: "compaction", id: "history-compaction-entry", parentId: "history-assistant-entry", summary: "History compact", tokensBefore: 100, firstKeptEntryId: "kept-history", timestamp: 3 },
          ],
          leafId: "history-compaction-entry",
        };
        process.stdout.write(JSON.stringify(base) + "\n");
      }, 25);
      continue;
    }
    else if (command.type === "get_entries") base.data = { entries: [], leafId: "history-compaction-entry" };
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
      experimentalNotificationsEnabled: true,
      proxy: { mode: "inherit" as const },
      fileMentionRespectSearchExclude: true,
      fileMentionRespectIgnoreFiles: true,
      fileMentionFollowSymlinks: true,
    };
    const secrets = new ProxySecretStore({ get: () => Promise.resolve(undefined) } as never);
    const logger = { error: vi.fn(), info: vi.fn() };
    const runtime = new SessionRuntime("session", dir, "History", () => configuration, secrets, logger as never, {
      onChange: vi.fn(),
      onEditorText: vi.fn(),
    });
    runtimes.push(runtime);

    await runtime.start(sessionFile);
    expect(runtime.view.status).toBe("ready");
    expect(runtime.view.historyStatus).toBe("queued");
    expect(conversationTurns(runtime.view)).toHaveLength(0);

    await runtime.loadHistory(false);
    expect(runtime.view.historyStatus).toBe("deferred");
    expect(conversationTurns(runtime.view)).toHaveLength(0);

    const repeatedAutomaticLoad = runtime.loadHistory(false);
    const explicitLoad = runtime.loadHistory(true);
    await Promise.all([repeatedAutomaticLoad, explicitLoad]);
    expect(runtime.view.historyStatus).toBe("loaded");
    expect(conversationTurns(runtime.view)).toHaveLength(1);
    expect(conversationTurns(runtime.view).flatMap((turn) => turn.items).filter((item) => item.type === "response")).toEqual([
      expect.objectContaining({ type: "response", blocks: [{ type: "text", text: "Live response" }] }),
    ]);
    expect(runtime.view.conversationItems.filter((item) => item.type === "compaction")).toHaveLength(1);
    expect(runtime.view.cacheHitPercent).toBe(60);
    expect(conversationNotices(runtime.view)).toEqual([
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
    else if (command.type === "get_entries") base.data = { entries: [], leafId: null };
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
      experimentalNotificationsEnabled: true,
      proxy: { mode: "inherit" as const },
      fileMentionRespectSearchExclude: true,
      fileMentionRespectIgnoreFiles: true,
      fileMentionFollowSymlinks: true,
    };
    const secrets = new ProxySecretStore({ get: () => Promise.resolve(undefined) } as never);
    const logger = { error: vi.fn(), info: vi.fn() };
    const runtime = new SessionRuntime("session", dir, "Extension command", () => configuration, secrets, logger as never, {
      onChange: vi.fn(),
      onEditorText: vi.fn(),
    });
    runtimes.push(runtime);

    await runtime.start();
    await waitFor(() => runtime.view.commands.some((command) => command.name === "toggle-web-proxy"));

    await runtime.sendPrompt("  /toggle-web-proxy on  ", []);

    expect(runtime.view.isStreaming).toBe(false);
    expect(runtime.view.status).toBe("ready");
    expect(conversationTurns(runtime.view)).toHaveLength(1);
    expect(conversationTurns(runtime.view)[0]?.userMessage?.blocks).toEqual([
      { type: "text", text: "/toggle-web-proxy on" },
    ]);
    expect(conversationTurns(runtime.view)[0]?.status).toBe("completed");
    const notice = conversationTurns(runtime.view)[0]?.items.find((item) => item.type === "notice");
    expect(notice?.type).toBe("notice");
    if (notice?.type === "notice") {
      expect(notice.text).toContain("args=/toggle-web-proxy on");
    }
  });

  it("warns when a known extension command has not confirmed completion before the prompt deadline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-runtime-unconfirmed-command-"));
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
      response.data = { model: null, thinkingLevel: "off", isStreaming: false, isCompacting: false, pendingMessageCount: 0, sessionId: "unconfirmed-command" };
    } else if (command.type === "get_commands") {
      response.data = { commands: [{ name: "external-command", source: "extension" }] };
    } else if (command.type === "get_available_models") response.data = { models: [] };
    else if (command.type === "get_entries") response.data = { entries: [], leafId: null };
    else if (command.type === "get_session_stats") {
      response.data = {
        sessionId: "unconfirmed-command",
        userMessages: 0,
        assistantMessages: 0,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        cost: 0,
      };
    } else if (command.type === "prompt") continue;
    process.stdout.write(JSON.stringify(response) + "\n");
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
      experimentalNotificationsEnabled: true,
      proxy: { mode: "inherit" as const },
      fileMentionRespectSearchExclude: true,
      fileMentionRespectIgnoreFiles: true,
      fileMentionFollowSymlinks: true,
    };
    const warnings: string[] = [];
    const runtime = new SessionRuntime(
      "session",
      dir,
      "Unconfirmed command",
      () => configuration,
      new ProxySecretStore({ get: () => Promise.resolve(undefined) } as never),
      { error: vi.fn(), info: vi.fn() } as never,
      {
        onChange: vi.fn(),
        onEditorText: vi.fn(),
        onExtensionCommandCompletionUnconfirmed: (_runtime, message) => warnings.push(message),
      },
    );
    runtimes.push(runtime);

    await runtime.start();
    await waitFor(() => runtime.view.commands.some((command) => command.name === "external-command"));

    vi.useFakeTimers();
    try {
      const submission = runtime.sendPrompt("/external-command", []);
      await vi.advanceTimersByTimeAsync(30_000);
      await expect(submission).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }

    const warning = "FrostPi has not confirmed that /external-command completed. Pi may still be waiting for input or may finish later; the session is still running.";
    expect(warnings).toEqual([warning]);
    expect(conversationTurns(runtime.view)[0]?.status).toBe("completed");
    expect(conversationNotices(runtime.view)).toContainEqual(expect.objectContaining({ level: "warning", text: warning }));
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
      experimentalNotificationsEnabled: true,
      proxy: { mode: "inherit" as const },
      fileMentionRespectSearchExclude: true,
      fileMentionRespectIgnoreFiles: true,
      fileMentionFollowSymlinks: true,
    };
    const secrets = new ProxySecretStore({ get: () => Promise.resolve(undefined) } as never);
    const logger = { error: vi.fn(), info: vi.fn() };
    const runtime = new SessionRuntime("session", dir, "Prompt command", () => configuration, secrets, logger as never, {
      onChange: vi.fn(),
      onEditorText: vi.fn(),
    });
    runtimes.push(runtime);

    await runtime.start();
    await waitFor(() => runtime.view.commands.some((command) => command.name === "inspect"));

    await runtime.sendPrompt("/inspect src", []);
    await waitFor(() => runtime.view.isStreaming);

    // Misclassifying as extension would force-complete after idle checks.
    expect(conversationTurns(runtime.view)[0]?.status).toBe("running");
    expect(conversationTurns(runtime.view)[0]?.userMessage?.blocks).toEqual([{ type: "text", text: "/inspect src" }]);
  });

  it("parks explicit steering and follow-up prompts while streaming and clears them on abort", async () => {
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
    else if (command.type === "get_entries") base.data = { entries: [], leafId: null };
    else if (command.type === "get_session_stats") {
      base.data = { sessionId: "followup", userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0, totalMessages: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };
    } else if (command.type === "prompt") {
      process.stdout.write(JSON.stringify(base) + "\n");
      if (!streaming) {
        streaming = true;
        process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\n");
      } else if (command.message === "queued later") {
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
      experimentalNotificationsEnabled: true,
      proxy: { mode: "inherit" as const },
      fileMentionRespectSearchExclude: true,
      fileMentionRespectIgnoreFiles: true,
      fileMentionFollowSymlinks: true,
    };
    const secrets = new ProxySecretStore({ get: () => Promise.resolve(undefined) } as never);
    const logger = { error: vi.fn(), info: vi.fn() };
    const runtime = new SessionRuntime("session", dir, "Follow-up", () => configuration, secrets, logger as never, {
      onChange: vi.fn(),
      onEditorText: vi.fn(),
    });
    runtimes.push(runtime);

    await runtime.start();
    await runtime.sendPrompt("first", []);
    await waitFor(() => runtime.view.isStreaming);
    expect(conversationTurns(runtime.view)).toHaveLength(1);

    await runtime.sendPrompt("redirect now", [], "steer");
    await runtime.sendPrompt("queued later", [], "followUp");
    await waitFor(() => runtime.view.status === "ready");
    expect(conversationTurns(runtime.view)).toHaveLength(1);
    expect(runtime.view.queuedSteers.map((item) => item.text)).toEqual(["redirect now"]);
    expect(runtime.view.queuedFollowUps.map((item) => item.text)).toEqual(["queued later"]);
    await expect(runtime.executeFork("any-entry")).rejects.toThrow("Wait for queued prompts to settle");

    await runtime.abort();
    expect(runtime.view.queuedSteers).toEqual([]);
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
      experimentalNotificationsEnabled: true,
      proxy: { mode: "inherit" as const },
      fileMentionRespectSearchExclude: true,
      fileMentionRespectIgnoreFiles: true,
      fileMentionFollowSymlinks: true,
    };
    const secrets = new ProxySecretStore({ get: () => Promise.resolve(undefined) } as never);
    const logger = { error: vi.fn(), info: vi.fn() };
    const runtime = new SessionRuntime("session", dir, "Live stats", () => configuration, secrets, logger as never, {
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

  it("derives cache rate from the latest assistant response while reconciling tree navigation", async () => {
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
  { type: "message", id: "answer", parentId: "root", timestamp: "2026-01-01T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "Answer" }], timestamp: 2, usage: { input: 100, output: 20, cacheRead: 100, cacheWrite: 0 } } },
  { type: "message", id: "old-user", parentId: "answer", timestamp: "2026-01-01T00:00:03.000Z", message: { role: "user", content: "Old path", timestamp: 3 } },
  { type: "message", id: "old-end", parentId: "old-user", timestamp: "2026-01-01T00:00:04.000Z", message: { role: "assistant", content: [{ type: "text", text: "Old end" }], timestamp: 4 } },
  { type: "message", id: "target-user", parentId: "answer", timestamp: "2026-01-01T00:00:05.000Z", message: { role: "user", content: [{ type: "text", text: "Revise this" }, { type: "image", id: "image", fileName: "shot.png", mimeType: "image/png", data: "AA==", size: 1 }], timestamp: 5 } },
];
let leafId = "old-end";
let messages = [entries[0].message, entries[1].message, entries[2].message, entries[3].message];
let failEntries = false;
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
    else if (command.type === "get_messages") response.data = { messages };
    else if (command.type === "get_entries") {
      if (failEntries) {
        response.success = false;
        response.error = "entry reload failed";
        failEntries = false;
      } else response.data = { entries, leafId };
    }
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
        if (request.customInstructions === "entry-fail") failEntries = true;
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
      experimentalNotificationsEnabled: true,
      proxy: { mode: "inherit" as const },
      fileMentionRespectSearchExclude: true,
      fileMentionRespectIgnoreFiles: true,
      fileMentionFollowSymlinks: true,
    };
    const secrets = new ProxySecretStore({ get: () => Promise.resolve(undefined) } as never);
    const runtime = new SessionRuntime("session", dir, "Tree", () => configuration, secrets, { error: vi.fn(), info: vi.fn() } as never, {
      onChange: vi.fn(),
      onEditorText: vi.fn(),
    }, artifactPath);
    runtimes.push(runtime);

    await runtime.start();
    await waitFor(() => runtime.view.sessionTreeAvailable);
    expect(runtime.view.cacheHitPercent).toBeUndefined();
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
    expect(runtime.view.conversationItems).toContainEqual(
      expect.objectContaining({
        type: "branchControl",
        branchPointId: "answer",
        activeChildEntryId: "old-user",
        pathCount: 2,
      }),
    );
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
    expect(runtime.view.cacheHitPercent).toBe(50);
    expect(conversationTurns(runtime.view)).toHaveLength(1);
    expect(result).toEqual({
      cancelled: false,
      seed: {
        id: "tree-target-user",
        text: "Revise this",
        images: [{ id: "image", name: "shot.png", mimeType: "image/png", dataUrl: "data:image/png;base64,AA==", size: 1 }],
      },
    });

    await expect(runtime.navigateTree("old-user", { summarize: true, customInstructions: "entry-fail" }))
      .rejects.toThrow("entry reload failed");
    expect(runtime.view.historyStatus).toBe("failed");

    await runtime.stop();
    await expect(access(launch.resultDirectory)).rejects.toThrow();
  });

  it("reconciles a complete retry lifecycle after settlement without duplicate completion", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-retry-runtime-"));
    const configuration = {
      piExecutable: join(process.cwd(), "test", "e2e", "fake-pi.cjs"),
      piArguments: [],
      startSessionOnOpen: true,
      streamingBehavior: "followUp" as const,
      collapseTurnTrace: true,
      questionToolEnabled: false,
      maxImageBytes: 10 * 1024 * 1024,
      diagnosticsLevel: "info" as const,
      experimentalNotificationsEnabled: true,
      proxy: { mode: "inherit" as const },
      fileMentionRespectSearchExclude: true,
      fileMentionRespectIgnoreFiles: true,
      fileMentionFollowSymlinks: true,
    };
    const onAgentTurnCompleted = vi.fn();
    const runtime = new SessionRuntime(
      "retry-session",
      dir,
      "Retry",
      () => configuration,
      new ProxySecretStore({ get: () => Promise.resolve(undefined) } as never),
      { error: vi.fn(), info: vi.fn() } as never,
      { onChange: vi.fn(), onEditorText: vi.fn(), onAgentTurnCompleted },
    );
    runtimes.push(runtime);

    await runtime.start();
    await runtime.sendPrompt("retry", []);
    await waitFor(() => runtime.view.status === "ready" && onAgentTurnCompleted.mock.calls.length === 1);
    await waitFor(() => conversationTurns(runtime.view)[0]?.userMessage?.sourceEntryId !== undefined);

    const projectedTurns = conversationTurns(runtime.view);
    expect(projectedTurns).toHaveLength(1);
    expect(projectedTurns[0]?.status).toBe("completed");
    expect(projectedTurns[0]?.items.filter((item) => item.type === "response").map((item) => (
      item.type === "response"
        ? item.blocks.map((block) => block.type === "text" || block.type === "error" ? block.text : "").join("")
        : ""
    ))).toEqual(["Partial response", "Transient provider error", "E2E response"]);
    expect(projectedTurns[0]?.items.filter((item) => item.type === "notice")).toHaveLength(1);
    expect(onAgentTurnCompleted).toHaveBeenCalledTimes(1);
  });

  it("finalizes running tools when stopping or losing the Pi process", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-unresolved-tool-"));
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
    if (command.type === "get_state") response.data = { model: null, thinkingLevel: "off", isStreaming: false, isCompacting: false, sessionId: "tool-runtime" };
    else if (command.type === "get_entries") response.data = { entries: [], leafId: null };
    else if (command.type === "get_available_models") response.data = { models: [] };
    else if (command.type === "get_commands") response.data = { commands: [] };
    else if (command.type === "get_session_stats") response.data = { sessionId: "tool-runtime", userMessages: 1, assistantMessages: 1, toolCalls: 1, toolResults: 0, totalMessages: 2, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };
    else if (command.type === "prompt") {
      const timestamp = command.message === "restart" ? 20 : 10;
      process.stdout.write(JSON.stringify(response) + "\n");
      process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\n");
      process.stdout.write(JSON.stringify({ type: "message_start", message: { role: "user", content: command.message, timestamp: timestamp - 1 } }) + "\n");
      process.stdout.write(JSON.stringify({ type: "message_start", message: { role: "assistant", content: [], timestamp } }) + "\n");
      process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } }) + "\n");
      process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: command.message === "restart" ? "new" : "old" } }) + "\n");
      if (command.message === "restart") {
        process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "new" }], stopReason: "stop", timestamp } }) + "\n");
        process.stdout.write(JSON.stringify({ type: "agent_end", messages: [], willRetry: false }) + "\n");
        process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\n");
      } else {
        process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 1 } }) + "\n");
        process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 1, delta: '{"path":"partial.ts"' } }) + "\n");
        if (command.message === "crash") setTimeout(() => process.exit(7), 20);
      }
      continue;
    }
    process.stdout.write(JSON.stringify(response) + "\n");
  }
});
process.on("SIGTERM", () => process.exit(0));
`);
    const configuration = runtimeConfiguration(fakePi);
    const createRuntime = (id: string) => new SessionRuntime(
      id,
      dir,
      "Tool runtime",
      () => configuration,
      new ProxySecretStore({ get: () => Promise.resolve(undefined) } as never),
      { error: vi.fn(), info: vi.fn() } as never,
      { onChange: vi.fn(), onEditorText: vi.fn() },
    );

    const stopped = createRuntime("stopped-tool");
    runtimes.push(stopped);
    await stopped.start();
    await stopped.sendPrompt("stop", []);
    await waitFor(() => projectedTools(stopped.view)[0]?.state === "preparing");
    await stopped.stop();
    expect(projectedTools(stopped.view)[0]).toMatchObject({
      state: "preparing",
      status: "cancelled",
      rawArguments: '{"path":"partial.ts"',
      isError: false,
    });

    await stopped.start();
    await stopped.sendPrompt("restart", []);
    await waitFor(() => stopped.view.status === "ready" && conversationText(stopped.view).at(-1) === "new");
    expect(conversationText(stopped.view)).not.toContain("oldnew");

    const failed = createRuntime("failed-tool");
    runtimes.push(failed);
    await failed.start();
    await failed.sendPrompt("crash", []);
    await waitFor(() => failed.view.status === "failed");
    expect(projectedTools(failed.view)[0]).toMatchObject({
      state: "preparing",
      status: "cancelled",
      rawArguments: '{"path":"partial.ts"',
      isError: false,
    });
  });

  it("applies the Question tool setting only to the started Pi process", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frostpi-question-runtime-"));
    const launchRecord = join(dir, "launch.json");
    const fakePi = join(dir, "fake-pi.cjs");
    const artifactPath = join(dir, "question-tool.js");
    await writeFile(artifactPath, "export default function () {}\n");
    await writeFile(fakePi, String.raw`#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(launchRecord)}, JSON.stringify({
  args: process.argv.slice(2),
  token: process.env.FROSTPI_QUESTION_TOKEN,
  requestDirectory: process.env.FROSTPI_QUESTION_REQUEST_DIR,
}));
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  input += chunk;
  while (input.includes("\n")) {
    const index = input.indexOf("\n");
    const command = JSON.parse(input.slice(0, index));
    input = input.slice(index + 1);
    const response = { type: "response", id: command.id, success: true };
    if (command.type === "get_state") response.data = { model: null, thinkingLevel: "off", isStreaming: false, isCompacting: false, sessionId: "question-runtime" };
    else if (command.type === "get_messages") response.data = { messages: [] };
    else if (command.type === "get_entries") response.data = { entries: [], leafId: null };
    else if (command.type === "get_available_models") response.data = { models: [] };
    else if (command.type === "get_commands") response.data = { commands: [] };
    else if (command.type === "get_session_stats") response.data = { sessionId: "question-runtime", userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0, totalMessages: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };
    process.stdout.write(JSON.stringify(response) + "\n");
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
      questionToolEnabled: true,
      maxImageBytes: 10 * 1024 * 1024,
      diagnosticsLevel: "info" as const,
      experimentalNotificationsEnabled: true,
      proxy: { mode: "inherit" as const },
      fileMentionRespectSearchExclude: true,
      fileMentionRespectIgnoreFiles: true,
      fileMentionFollowSymlinks: true,
    };
    const runtime = new SessionRuntime(
      "question-session",
      dir,
      "Question",
      () => configuration,
      new ProxySecretStore({ get: () => Promise.resolve(undefined) } as never),
      { error: vi.fn(), info: vi.fn() } as never,
      { onChange: vi.fn(), onEditorText: vi.fn() },
      undefined,
      artifactPath,
    );
    runtimes.push(runtime);

    await runtime.start();
    const launch = JSON.parse(await readFile(launchRecord, "utf8")) as {
      args: string[];
      token: string;
      requestDirectory: string;
    };
    expect(launch.args).toContain(artifactPath);
    expect(launch.token).toHaveLength(43);
    expect(runtime.view.questionTool).toEqual({ configuredEnabled: true, appliedEnabled: true, restartRequired: false });

    configuration.questionToolEnabled = false;
    runtime.refreshConfigurationState();
    expect(runtime.view.questionTool).toEqual({ configuredEnabled: false, appliedEnabled: true, restartRequired: true });

    await runtime.stop();
    await expect(access(launch.requestDirectory)).rejects.toThrow();
  });
});

function conversationTurns(view: Readonly<SessionViewModel>): AgentTurnView[] {
  return view.conversationItems.filter((item): item is AgentTurnView => item.type === "turn");
}

function projectedTools(view: Readonly<SessionViewModel>) {
  return conversationTurns(view)
    .flatMap((turn) => turn.items)
    .filter((item) => item.type === "tool")
    .map((item) => item.tool);
}

function conversationText(view: Readonly<SessionViewModel>): string[] {
  return conversationTurns(view).flatMap((turn) => turn.items.flatMap((item) => {
    if (item.type === "reasoning") return [item.text];
    if (item.type !== "response") return [];
    return item.blocks.flatMap((block) => block.type === "text" || block.type === "error" ? block.text : []);
  }));
}

function conversationNotices(view: Readonly<SessionViewModel>): SessionNoticeView[] {
  return view.conversationItems.flatMap((item) => {
    if (item.type === "notice") return [item];
    if (item.type !== "turn") return [];
    return item.items.filter((turnItem): turnItem is SessionNoticeView => turnItem.type === "notice");
  });
}

function runtimeConfiguration(piExecutable: string) {
  return {
    piExecutable,
    piArguments: [],
    startSessionOnOpen: true,
    streamingBehavior: "followUp" as const,
    collapseTurnTrace: true,
    questionToolEnabled: false,
    maxImageBytes: 10 * 1024 * 1024,
    diagnosticsLevel: "info" as const,
    experimentalNotificationsEnabled: true,
    proxy: { mode: "inherit" as const },
    fileMentionRespectSearchExclude: true,
    fileMentionRespectIgnoreFiles: true,
    fileMentionFollowSymlinks: true,
  };
}

function argsRecordingConfiguration(piExecutable: string) {
  return { ...runtimeConfiguration(piExecutable), piArguments: ["--no-extensions"] };
}

/** Writes a fake Pi CLI that records its argv to FROSTPI_TEST_ARGS_FILE and answers the rpc handshake. */
async function writeArgsRecordingPi(dir: string): Promise<string> {
  const fakePi = join(dir, "fake-pi.cjs");
  await writeFile(fakePi, String.raw`#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(process.env.FROSTPI_TEST_ARGS_FILE, JSON.stringify(process.argv.slice(2)));
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  input += chunk;
  while (input.includes("\n")) {
    const index = input.indexOf("\n");
    const command = JSON.parse(input.slice(0, index));
    input = input.slice(index + 1);
    const response = { type: "response", id: command.id, success: true };
    if (command.type === "get_state") response.data = { model: null, thinkingLevel: "off", isStreaming: false, isCompacting: false, sessionId: "memory" };
    else if (command.type === "get_available_models") response.data = { models: [] };
    else if (command.type === "get_commands") response.data = { commands: [] };
    else if (command.type === "get_entries") response.data = { entries: [], leafId: null };
    else if (command.type === "get_session_stats") response.data = { sessionId: "memory", userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0, totalMessages: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };
    process.stdout.write(JSON.stringify(response) + "\n");
  }
});
process.on("SIGTERM", () => process.exit(0));
`);
  return fakePi;
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
