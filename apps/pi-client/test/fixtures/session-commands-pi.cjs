#!/usr/bin/env node
// A scripted Pi child for /clear, /rewind and /btw. It keeps a real entry tree, model
// state and session identity, and answers FrostPi's two private adapter commands the
// way the bundled extensions do, so Registry and Runtime run unmodified against it.
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const extensionPaths = args.flatMap((arg, index) => arg === "-e" ? [args[index + 1]] : []);
const treeExtension = extensionPaths.find((file) => path.basename(file) === "session-tree.js");
const sideExtension = extensionPaths.find((file) => path.basename(file) === "side-question.js");
const vetoNewSession = args.includes("--veto-new-session");
const noSession = args.includes("--no-session");
const resumedFile = args.includes("--session") ? args[args.indexOf("--session") + 1] : undefined;
// `new_session` waits, like Pi behind an extension dialog, until the next `get_commands`.
const holdNewSession = args.includes("--hold-new-session");
// The first `get_state` after a committed `new_session` fails.
const failStateAfterNewSession = args.includes("--fail-state-after-new-session");
// The bundled extensions were passed but did not load in this process.
const adaptersNotLoaded = args.includes("--adapters-not-loaded");

const MODELS = [
  { provider: "fake", id: "default", name: "Default", reasoning: true },
  { provider: "fake", id: "other", name: "Other", reasoning: true },
];
let generation = 1;
let model = MODELS[0];
let thinkingLevel = "medium";
let sessionName;
let entries = [];
let leafId = null;
let sequence = 0;
let streaming = false;
let finishHeldTurn;
let releaseNewSession;
let failNextState = false;
let heldSideQuestionResponses = [];

// Lets a test see when every result the adapter wrote has been consumed by the Host.
if (process.env.FROSTPI_SIDE_QUESTION_RESULT_DIR) {
  fs.appendFileSync(path.join(process.cwd(), "side-question-result-dirs"), `${process.env.FROSTPI_SIDE_QUESTION_RESULT_DIR}\n`);
}

// A resumed process reports the file it was given; a new conversation gets a name no
// other process reuses, so a test can tell "reopened" from "started fresh".
function sessionFile() {
  if (noSession) return undefined;
  if (resumedFile && generation === 1) return resumedFile;
  return path.join(process.cwd(), `fake-session-${process.pid}-${generation}.jsonl`);
}

function respond(id, data) {
  process.stdout.write(`${JSON.stringify({ type: "response", id, success: true, ...(data === undefined ? {} : { data }) })}\n`);
}

function fail(id, command, error) {
  process.stdout.write(`${JSON.stringify({ type: "response", id, command, success: false, error })}\n`);
}

function event(value) {
  if (value.type === "agent_start") streaming = true;
  if (value.type === "agent_settled") streaming = false;
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function append(message) {
  const id = `entry-${generation}-${++sequence}`;
  entries.push({ type: "message", id, parentId: leafId, timestamp: new Date(sequence * 1000).toISOString(), message });
  leafId = id;
  return id;
}

function activePathLength() {
  let count = 0;
  for (let id = leafId; id; id = entries.find((entry) => entry.id === id)?.parentId ?? null) count += 1;
  return count;
}

function decode(message) {
  return JSON.parse(Buffer.from(message.slice(message.indexOf(" ") + 1), "base64url").toString("utf8"));
}

function privateCommands() {
  if (adaptersNotLoaded) return [];
  const source = (file) => ({ path: file, source: "local", scope: "temporary", origin: "top-level" });
  return [
    ...(treeExtension ? [{ name: "frostpi.session-tree", source: "extension", sourceInfo: source(treeExtension) }] : []),
    ...(sideExtension ? [{ name: "frostpi.side-question", source: "extension", sourceInfo: source(sideExtension) }] : []),
  ];
}

function handle(command) {
  const id = command.id;
  switch (command.type) {
    case "get_state":
      if (failNextState) {
        failNextState = false;
        fail(id, "get_state", "transient get_state failure");
        return;
      }
      respond(id, {
        model, thinkingLevel, isStreaming: streaming, isCompacting: false, pendingMessageCount: 0,
        sessionFile: sessionFile(), sessionId: `fake-${generation}`, ...(sessionName ? { sessionName } : {}),
      });
      return;
    case "get_entries": {
      const sinceIndex = typeof command.since === "string" ? entries.findIndex((entry) => entry.id === command.since) : -1;
      // Like Pi, a cursor this session does not contain is an error, not "everything".
      if (typeof command.since === "string" && sinceIndex < 0) {
        fail(id, "get_entries", `Entry not found: ${command.since}`);
        return;
      }
      respond(id, { entries: sinceIndex >= 0 ? entries.slice(sinceIndex + 1) : entries, leafId });
      return;
    }
    case "get_messages": respond(id, { messages: [] }); return;
    case "get_available_models": respond(id, { models: MODELS }); return;
    case "get_commands":
      releaseNewSession?.();
      respond(id, { commands: [...privateCommands(), { name: "visible", description: "User command", source: "extension" }] });
      return;
    case "get_session_stats":
      respond(id, {
        sessionFile: sessionFile(), sessionId: `fake-${generation}`, userMessages: 0, assistantMessages: 0, toolCalls: 0,
        toolResults: 0, totalMessages: entries.length, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0,
      });
      return;
    case "set_model":
      model = MODELS.find((candidate) => candidate.provider === command.provider && candidate.id === command.modelId) ?? model;
      // Like Pi, a model switch falls back to that model's default thinking level.
      thinkingLevel = "medium";
      respond(id, model);
      return;
    case "set_thinking_level": thinkingLevel = command.level; respond(id); return;
    case "set_session_name": sessionName = command.name; respond(id); return;
    case "abort":
      finishHeldTurn?.();
      respond(id);
      return;
    case "new_session": {
      const finish = () => {
        releaseNewSession = undefined;
        if (vetoNewSession) {
          respond(id, { cancelled: true });
          return;
        }
        generation += 1;
        entries = [];
        leafId = null;
        sequence = 0;
        model = MODELS[0];
        thinkingLevel = "medium";
        sessionName = undefined;
        failNextState = failStateAfterNewSession;
        respond(id, { cancelled: false });
      };
      if (holdNewSession) releaseNewSession = finish;
      else finish();
      return;
    }
    case "prompt": prompt(command); return;
    default: respond(id);
  }
}

function prompt(command) {
  const id = command.id;
  const text = command.message;
  if (text.startsWith("/frostpi.session-tree ")) {
    const request = decode(text);
    const target = entries.find((entry) => entry.id === request.targetId);
    leafId = target?.message.role === "user" ? target.parentId : request.targetId;
    fs.writeFileSync(
      path.join(process.env.FROSTPI_SESSION_TREE_RESULT_DIR, `${request.requestId}.json`),
      JSON.stringify({ version: 1, requestId: request.requestId, status: "committed", leafId }),
    );
    respond(id);
    return;
  }
  if (text.startsWith("/frostpi.side-question ")) {
    const request = decode(text);
    // The model request never returns: the command stays pending until the process ends.
    if (request.question.includes("never-answer")) return;
    const file = path.join(process.env.FROSTPI_SIDE_QUESTION_RESULT_DIR, `${request.requestId}.json`);
    const write = (result) => fs.writeFileSync(file, JSON.stringify({ version: 1, requestId: request.requestId, ...result }));
    if (request.token !== process.env.FROSTPI_SIDE_QUESTION_TOKEN || request.question.includes("no-result")) {
      // The real adapter throws here; Pi reports the command handled and writes nothing.
    } else if (request.question.includes("provider-failure")) {
      write({ status: "failed", error: "429 rate limited" });
    } else {
      write({
        status: "answered",
        answer: `Answer to "${request.question}" from ${activePathLength()} entries${streaming ? " while busy" : ""}`,
        model: `${model.provider}/${model.id}`,
        usage: { input: 1200, output: 34, cacheRead: 1000 },
        ...(request.question.includes("cut-off") ? { incomplete: "length" } : {}),
      });
    }
    // A held answer is written at once and delivered just before the next question's.
    if (request.question.includes("held-answer")) {
      heldSideQuestionResponses.push(id);
      return;
    }
    for (const held of heldSideQuestionResponses.splice(0)) respond(held);
    const delayed = request.question.includes("slow-answer");
    setTimeout(() => respond(id), delayed ? 150 : 0);
    return;
  }

  respond(id);
  const userMessage = { role: "user", content: text, timestamp: (sequence + 1) * 1000 };
  event({ type: "agent_start" });
  event({ type: "message_start", message: userMessage });
  const finish = () => {
    finishHeldTurn = undefined;
    append(userMessage);
    const assistant = { role: "assistant", stopReason: "stop", timestamp: (sequence + 1) * 1000, content: [{ type: "text", text: `Reply to ${text}` }] };
    event({ type: "message_start", message: assistant });
    event({ type: "message_end", message: assistant });
    append(assistant);
    event({ type: "agent_end", messages: [], willRetry: false });
    event({ type: "agent_settled" });
  };
  if (text === "hold") finishHeldTurn = finish;
  else finish();
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) handle(JSON.parse(line));
  }
});
process.on("SIGTERM", () => process.exit(0));
