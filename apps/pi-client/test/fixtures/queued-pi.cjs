#!/usr/bin/env node
// Controlled RPC boundary for recovery tests. No provider, tools, network, or session files.
const fs = require("node:fs");
const readline = require("node:readline");
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const omp = process.argv.includes("--omp");
const release = arg("--recovery-release");
const clearRelease = arg("--recovery-clear-release");
const admissionRelease = arg("--recovery-admission-release");
const compactRelease = arg("--recovery-compact-release");
let streaming = false;
let compacting = false;
let sequence = 0;
let activeAssistant;
const entries = [];
let steering = [];
let followUp = [];
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\n");
const respond = (id, data) => send({ type: "response", id, success: true, ...(data === undefined ? {} : { data }) });
function append(message) {
  const entry = { type: "message", id: `entry-${++sequence}`, parentId: entries.at(-1)?.id ?? null, timestamp: message.timestamp, message };
  entries.push(entry);
}
function user(item) {
  const message = { role: "user", content: [{ type: "text", text: item.text }, ...(item.images ?? [])], timestamp: ++sequence };
  send({ type: "message_start", message });
  send({ type: "message_end", message });
  append(message);
}
function assistantStart() {
  activeAssistant = { role: "assistant", id: `assistant-${++sequence}`, timestamp: sequence, content: [] };
  send({ type: "message_start", message: activeAssistant });
}
function assistantEnd() {
  const message = { ...activeAssistant, content: [{ type: "text", text: "completed" }], stopReason: "stop" };
  send({ type: "message_end", message });
  append(message);
}
function queueUpdate() {
  send({ type: "queue_update", steering: steering.map((p) => p.text), followUp: followUp.map((p) => p.text) });
}
function finish() {
  if (!streaming) return;
  assistantEnd();
  for (const pending of [...steering, ...followUp]) {
    user(pending);
    assistantStart();
    assistantEnd();
  }
  steering = [];
  followUp = [];
  queueUpdate();
  streaming = false;
  send({ type: "agent_end", messages: [], willRetry: false });
  send({ type: omp ? "session_settled" : "agent_settled" });
}
async function waitForFile(path) {
  if (!path) return;
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(path)) {
    if (Date.now() > deadline) throw new Error("Recovery fixture barrier timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function handle(command) {
  const id = command.id;
  switch (command.type) {
    case "negotiate_protocol": respond(id, { protocolVersion: 2 }); return;
    case "get_state":
      respond(id, { model: null, thinkingLevel: "off", isStreaming: streaming, isCompacting: compacting,
        pendingMessageCount: steering.length + followUp.length, sessionId: "recovery-fixture" }); return;
    case "get_commands": respond(id, { commands: [] }); return;
    case "get_available_commands": respond(id, { commands: [] }); return;
    case "get_available_models": respond(id, { models: [] }); return;
    case "set_session_name": respond(id); return;
    case "get_entries": {
      const cursor = entries.findIndex((entry) => entry.id === command.since);
      respond(id, { entries: cursor >= 0 ? entries.slice(cursor + 1) : entries, leafId: entries.at(-1)?.id ?? null }); return;
    }
    case "get_session_stats":
      respond(id, { userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0, totalMessages: entries.length,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 }); return;
    case "prompt": {
      if (command.message === "delayed") await waitForFile(admissionRelease);
      const item = { text: command.message, images: command.images };
      if (streaming) {
        (command.streamingBehavior === "steer" ? steering : followUp).push(item);
        queueUpdate();
      } else {
        streaming = true;
        send({ type: "agent_start" });
        user(item);
        assistantStart();
      }
      respond(id);
      return;
    }
    case "clear_queue": {
      const result = { steering: steering.map((p) => p.text), followUp: followUp.map((p) => p.text) };
      steering = [];
      followUp = [];
      await waitForFile(clearRelease);
      respond(id, result); return;
    }
    case "remove_queued_message": {
      const queue = command.queue === "steering" ? steering : followUp;
      const index = queue.findIndex((p) => p.text === command.message);
      const removed = index < 0 ? undefined : queue.splice(index, 1)[0];
      queueUpdate();
      await waitForFile(clearRelease);
      respond(id, { removed: removed !== undefined, ...(removed?.images ? { images: removed.images } : {}) }); return;
    }
    case "compact":
      compacting = true;
      send({ type: "compaction_start" });
      await waitForFile(compactRelease);
      compacting = false;
      send({ type: "compaction_end" });
      respond(id, {}); return;
    case "abort":
      finish(); respond(id); return;
    default: respond(id); return;
  }
}
const poll = release ? setInterval(() => { if (fs.existsSync(release)) finish(); }, 5) : undefined;
send({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2] });
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const command = JSON.parse(line);
  void handle(command).catch((error) => send({ type: "response", id: command.id, success: false, error: error.message }));
});
input.on("close", () => { if (poll) clearInterval(poll); process.exit(0); });
process.on("SIGTERM", () => process.exit(0));
