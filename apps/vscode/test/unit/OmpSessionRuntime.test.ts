import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { FrostPiConfiguration } from "../../src/extension/configuration/configurationTypes.js";
import type { AgentTurnView, SessionNoticeView } from "../../src/shared/model/conversationModel.js";
import type { SessionViewModel } from "../../src/shared/model/sessionViewModel.js";

vi.mock("vscode", () => ({
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
  extensions: { getExtension: () => undefined },
}));

const { ProxySecretStore } = await import("../../src/extension/network/ProxySecretStore.js");
const { SessionRuntime } = await import("../../src/extension/sessions/SessionRuntime.js");
const runtimes: InstanceType<typeof SessionRuntime>[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("bounded OMP runtime commands", () => {
  it("shows only text commands and skills, sends original invocations, and restores skill history without expansion", async () => {
    const fixture = await createFixture();
    const runtime = fixture.runtime();
    await fixture.start(runtime);
    await vi.waitFor(() => expect(runtime.view.commands.map((command) => command.name)).toEqual(["review", "skill:test"]));
    await expect(runtime.sendPrompt("/ui", [])).rejects.toThrow("not supported");
    await expect(runtime.sendPrompt("/model:foo", [])).rejects.toThrow("not supported");
    expect(turns(runtime.view)).toEqual([]);

    await runtime.sendPrompt("/review auth", []);
    await vi.waitFor(() => expect(turns(runtime.view)[0]?.userMessage?.sourceEntryId).toBeDefined());
    expect(turns(runtime.view)[0]?.userMessage?.blocks).toEqual([{ type: "text", text: "/review auth" }]);
    await runtime.sendPrompt("/skill:test focus on auth", []);
    await vi.waitFor(() => expect(turns(runtime.view)[1]?.userMessage?.sourceEntryId).toBeDefined());
    expect(turns(runtime.view)).toHaveLength(2);
    expect(turns(runtime.view)[1]?.userMessage?.blocks).toEqual([{ type: "text", text: "/skill:test focus on auth" }]);
    expect(runtime.view.conversationItems.every((item) => item.type === "turn")).toBe(true);
    expect(JSON.parse(await readFile(fixture.submissions, "utf8"))).toEqual(["/review auth", "/skill:test focus on auth"]);

    await runtime.stop();
    const restored = fixture.runtime();
    await fixture.start(restored, fixture.history);
    await restored.loadHistory(true);
    expect(turns(restored.view).map((turn) => turn.userMessage?.blocks)).toEqual([
      [{ type: "text", text: "Expanded review prompt" }],
      [{ type: "text", text: "/skill:test focus on auth" }],
    ]);
    expect(turns(restored.view).map((turn) => turn.status)).toEqual(["completed", "completed"]);
    const persisted = JSON.parse(await readFile(fixture.history, "utf8")) as { type: string }[];
    expect(persisted.some((entry) => entry.type === "custom_message")).toBe(true);
  });

  it("rejects skill images before dispatch and closes a pre-agent failure even when its terminal precedes the ack", async () => {
    const fixture = await createFixture();
    const runtime = fixture.runtime();
    await fixture.start(runtime);
    await expect(runtime.sendPrompt("/skill:test", [{ id: "image", name: "image.png", mimeType: "image/png", data: "aGVsbG8=", size: 5 }])).rejects.toThrow("image attachments");
    expect(turns(runtime.view)).toEqual([]);
    await runtime.sendPrompt("/skill:test fail-before-agent", []);
    expect(turns(runtime.view).at(-1)?.status).toBe("error");
    expect(runtime.view.isStreaming).toBe(false);
    expect(notices(runtime.view).map((notice) => notice.text)).toContain("Skill could not be admitted");
    expect(JSON.parse(await readFile(fixture.submissions, "utf8"))).toEqual(["/skill:test fail-before-agent"]);
  });

  it("marks a pre-dispatch drop aborted even when OMP reports agentInvoked true", async () => {
    const fixture = await createFixture();
    const runtime = fixture.runtime();
    await fixture.start(runtime);
    await runtime.sendPrompt("/skill:test dropped-before-agent", []);
    expect(turns(runtime.view).at(-1)?.status).toBe("aborted");
    expect(fixture.completed).not.toHaveBeenCalled();
    expect(runtime.view.isStreaming).toBe(false);
    expect(runtime.view.queuedSteers).toEqual([]);
    expect(runtime.view.queuedFollowUps).toEqual([]);
  });

  it("keeps other work running after a queued rejection and delivers skills Steer before Queue", async () => {
    const fixture = await createFixture();
    const runtime = fixture.runtime();
    await fixture.start(runtime);
    await runtime.sendPrompt("hold", []);
    await vi.waitFor(() => expect(runtime.view.isStreaming).toBe(true));
    await runtime.sendPrompt("/skill:test later", [], "followUp");
    await runtime.sendPrompt("/skill:test now", [], "steer");
    await runtime.sendPrompt("/skill:test fail-before-agent", [], "followUp");
    expect(runtime.view.isStreaming).toBe(true);
    expect(runtime.view.queuedSteers.map((prompt) => prompt.text)).toEqual(["/skill:test now"]);
    expect(runtime.view.queuedFollowUps.map((prompt) => prompt.text)).toEqual(["/skill:test later"]);
    await writeFile(fixture.release, "release");
    await vi.waitFor(() => expect(runtime.view.isStreaming).toBe(false));
    await vi.waitFor(() => expect(turns(runtime.view).map((turn) => turn.userMessage?.sourceEntryId)).toEqual(["e1", "e3", "e5"]));
    expect(runtime.view.queuedSteers).toEqual([]);
    expect(runtime.view.queuedFollowUps).toEqual([]);
    expect(turns(runtime.view).map((turn) => turn.userMessage?.blocks)).toEqual([
      [{ type: "text", text: "hold" }],
      [{ type: "text", text: "/skill:test now" }],
      [{ type: "text", text: "/skill:test later" }],
    ]);
    expect(turns(runtime.view).map((turn) => turn.status)).toEqual(["completed", "completed", "completed"]);
    expect(fixture.completed).toHaveBeenCalledTimes(1);
  });
});

async function createFixture() {
  const dir = await mkdtemp(join(tmpdir(), "frostpi-omp-runtime-"));
  directories.push(dir);
  const fake = join(dir, "omp.cjs");
  const history = join(dir, "history.jsonl");
  const submissions = join(dir, "submissions.json");
  const release = join(dir, "release");
  await writeFile(history, "[]");
  await writeFile(submissions, "[]");
  await writeFile(fake, `
const fs = require("node:fs");
const history = ${JSON.stringify(history)}, submissions = ${JSON.stringify(submissions)}, release = ${JSON.stringify(release)};
const write = value => process.stdout.write(JSON.stringify(value) + "\\n");
let entries = JSON.parse(fs.readFileSync(history, "utf8")), leaf = entries.at(-1)?.id ?? null;
let input = "", active = null, steers = [], followUps = [];
const commands = [{ name: "model", source: "builtin" }, { name: "ui", source: "extension" }, { name: "script", source: "custom" }, { name: "review", source: "file" }, { name: "skill:test", source: "skill" }, { name: "model:foo", source: "file" }];
write({ type: "ready", supportedProtocolVersions: [1] });
write({ type: "available_commands_update", commands });
function persist(type, fields) {
  const entry = { type, id: "e" + (entries.length + 1), parentId: leaf, timestamp: new Date(entries.length + 1).toISOString(), ...fields };
  entries.push(entry); leaf = entry.id; fs.writeFileSync(history, JSON.stringify(entries)); return entry;
}
function begin(command) {
  active = command;
  write({ type: "agent_start" });
  const skill = command.message.startsWith("/skill:");
  const message = skill ? { role: "custom", customType: "skill-prompt", attribution: "user", display: true, content: "Expanded skill instructions", details: { name: "test", prompt: command.message }, timestamp: entries.length + 1 }
    : { role: "user", content: command.message.startsWith("/review") ? "Expanded review prompt" : command.message, timestamp: entries.length + 1 };
  if (skill) { const { role, ...fields } = message; persist("custom_message", fields); }
  else persist("message", { message });
  write({ type: "message_start", message }); write({ type: "message_end", message });
}
function finish() {
  const command = active;
  const message = { role: "assistant", timestamp: entries.length + 1, stopReason: "stop", content: [{ type: "text", text: "ok" }] };
  persist("message", { message });
  write({ type: "message_start", message }); write({ type: "message_end", message });
  write({ type: "agent_end", messages: [] }); active = null;
  const next = steers.shift() ?? followUps.shift();
  write({ type: "prompt_result", id: command.id, agentInvoked: true, status: "completed", sessionSettled: !next });
  if (next) { begin(next); finish(); } else write({ type: "session_settled" });
}
setInterval(() => { if (active?.message === "hold" && fs.existsSync(release)) finish(); }, 10);
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  input += chunk;
  while (input.includes("\\n")) {
    const index = input.indexOf("\\n"), command = JSON.parse(input.slice(0, index)); input = input.slice(index + 1);
    const response = { type: "response", id: command.id, command: command.type, success: true };
    if (command.type === "get_state") response.data = { model: null, thinkingLevel: "off", isStreaming: !!active, isCompacting: false, sessionId: "omp", sessionFile: history };
    else if (command.type === "get_available_commands") response.data = { commands };
    else if (command.type === "get_available_models") response.data = { models: [] };
    else if (command.type === "get_session_stats") response.data = { userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0, totalMessages: entries.length, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 };
    else if (command.type === "get_entries") response.data = { entries: command.since ? entries.slice(entries.findIndex(entry => entry.id === command.since) + 1) : entries, leafId: leaf };
    else if (command.type === "prompt") {
      const sent = JSON.parse(fs.readFileSync(submissions, "utf8")); sent.push(command.message); fs.writeFileSync(submissions, JSON.stringify(sent));
      if (command.message.includes("dropped-before-agent")) {
        write({ type: "prompt_result", id: command.id, agentInvoked: true, status: "aborted", sessionSettled: !active });
        write(response); continue;
      }
      if (command.message.includes("fail-before-agent")) {
        write({ type: "prompt_result", id: command.id, agentInvoked: false, status: "error", sessionSettled: !active, error: { message: "Skill could not be admitted" } });
        write(response); continue;
      }
      write(response);
      if (active) (command.streamingBehavior === "steer" ? steers : followUps).push(command);
      else { begin(command); if (command.message !== "hold") finish(); }
      continue;
    } else { response.success = false; response.error = "Unknown command: " + command.type; }
    write(response);
  }
});
process.on("SIGTERM", () => process.exit(0));
`);
  const initialized = new WeakSet<InstanceType<typeof SessionRuntime>>();
  const completed = vi.fn();
  function runtime() {
    const configuration: FrostPiConfiguration = {
      piExecutable: fake, runtimeCompatibility: "oh-my-pi", piArguments: [], streamingBehavior: "followUp",
      maxImageBytes: 10 * 1024 * 1024, questionToolEnabled: false, collapseTurnTrace: true,
      startSessionOnOpen: true, diagnosticsLevel: "info", experimentalNotificationsEnabled: false,
      fileMentionRespectSearchExclude: true, fileMentionRespectIgnoreFiles: true, fileMentionFollowSymlinks: true,
      proxy: { mode: "inherit" },
    };
    const runtime = new SessionRuntime("omp", dir, "OMP", () => configuration,
      new ProxySecretStore({ get: () => Promise.resolve(undefined) } as never),
      { error: vi.fn(), info: vi.fn() } as never, {
        onChange: (current) => { if (current.view.stats) initialized.add(current); },
        onEditorText: vi.fn(),
        onAgentTurnCompleted: completed,
      });
    runtimes.push(runtime);
    return runtime;
  }
  async function start(runtime: InstanceType<typeof SessionRuntime>, sessionFile?: string) {
    await runtime.start(sessionFile);
    await vi.waitFor(() => expect(initialized.has(runtime)).toBe(true));
  }
  return { runtime, start, history, submissions, release, completed };
}

function turns(view: Readonly<SessionViewModel>): AgentTurnView[] {
  return view.conversationItems.filter((item): item is AgentTurnView => item.type === "turn");
}

function notices(view: Readonly<SessionViewModel>): SessionNoticeView[] {
  return view.conversationItems.flatMap((item) => item.type === "notice" ? [item] : item.type === "turn" ? item.items.filter((activity): activity is SessionNoticeView => activity.type === "notice") : []);
}
