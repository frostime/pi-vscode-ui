#!/usr/bin/env node

let buffer = "";
let sessionName = "E2E session";
let entries = [];
let entrySequence = 0;
let isStreaming = false;
let cancelStreaming;
const streamReleaseIndex = process.argv.indexOf("--stream-084-release");
const streamRelease = streamReleaseIndex >= 0 ? process.argv[streamReleaseIndex + 1] : undefined;
const startupMailRaceIndex = process.argv.indexOf("--startup-mail-race");
const startupMailRaceRelease = startupMailRaceIndex >= 0 ? process.argv[startupMailRaceIndex + 1] : undefined;
let pendingStartupModelsId = null;
const persistSessionFixture = process.argv.includes("--persist-session-fixture");
const resumeFileIndex = process.argv.indexOf("--session");
const sessionFile = process.argv.includes("--no-session")
  ? undefined
  : persistSessionFixture && resumeFileIndex >= 0
    ? process.argv[resumeFileIndex + 1]
    : `${process.cwd().replaceAll("\\", "/")}/.frostpi-e2e-session${persistSessionFixture ? `-${process.pid}` : ""}.jsonl`;
let fixtureHeader = { type: "session", version: 3, id: "e2e-session", cwd: process.cwd(), timestamp: new Date().toISOString() };
if (persistSessionFixture && sessionFile) {
  const fs = require("node:fs");
  if (resumeFileIndex >= 0) {
    const saved = fs.readFileSync(sessionFile, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
    fixtureHeader = saved[0];
    entries = saved.slice(1);
    entrySequence = entries.length;
    sessionName = fixtureHeader.sessionName || sessionName;
  }
  fs.appendFileSync(`${sessionFile}.starts`, `${process.pid}\n`);
  persistFixtureEntries();
}

function persistFixtureEntries() {
  if (!persistSessionFixture || !sessionFile) return;
  const header = { ...fixtureHeader, sessionName };
  require("node:fs").writeFileSync(sessionFile, [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}

process.stdout.write(JSON.stringify({
  type: "ready",
  protocolVersion: 1,
  supportedProtocolVersions: [1, 2],
  maxFrameBytes: 1048576,
  maxReassembledFrameBytes: 67108864,
}) + "\n");

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (true) {
    const index = buffer.indexOf("\n");
    if (index < 0) break;
    const line = buffer.slice(0, index).replace(/\r$/, "");
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    handle(JSON.parse(line));
  }
});

function handle(command) {
  if (command.type === "extension_ui_response") return;
  const id = command.id;
  switch (command.type) {
    case "negotiate_protocol": respond(id, { protocolVersion: 2 }); break;
    case "get_state":
      respond(id, {
        model: { provider: "e2e", id: "model", name: "E2E Model", supportsImages: true, reasoning: true },
        thinkingLevel: "medium",
        isStreaming,
        isCompacting: false,
        sessionFile,
        sessionId: "e2e-session",
        sessionName,
      });
      break;
    case "get_messages": respond(id, { messages: [] }); break;
    case "get_entries": {
      const sinceIndex = typeof command.since === "string" ? entries.findIndex((entry) => entry.id === command.since) : -1;
      respond(id, {
        entries: sinceIndex >= 0 ? entries.slice(sinceIndex + 1) : entries,
        leafId: entries.at(-1)?.id ?? null,
      });
      break;
    }
    case "get_available_models":
      if (startupMailRaceRelease && entries.length === 0) pendingStartupModelsId = id;
      else respondModels(id);
      break;
    case "get_commands":
      respond(id, { commands: [{ name: "echo", description: "E2E extension command", source: "extension" }] });
      break;
    case "get_session_stats":
      respond(id, {
        sessionFile,
        sessionId: "e2e-session",
        userMessages: 0,
        assistantMessages: 0,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        cost: 0,
      });
      break;
    case "set_session_name": sessionName = command.name; persistFixtureEntries(); respond(id); break;
    case "set_model":
      respond(id, { provider: command.provider, id: command.modelId, name: "E2E Model", supportsImages: true, reasoning: true });
      break;
    case "set_thinking_level": respond(id); break;
    case "abort": cancelStreaming?.(); respond(id); event({ type: "agent_settled" }); break;
    case "compact":
      event({ type: "compaction_start", reason: "manual" });
      event({
        type: "compaction_end",
        reason: "manual",
        result: {
          summary: `Compacted context${command.customInstructions ? `: ${command.customInstructions}` : ""}`,
          firstKeptEntryId: "kept-entry",
          tokensBefore: 42_000,
          estimatedTokensAfter: 8_000,
          details: {},
        },
        aborted: false,
        willRetry: false,
      });
      respond(id, { summary: "Compacted context", tokensBefore: 42_000 });
      break;
    case "prompt": {
      const timestamp = ++entrySequence * 10;
      const parentId = entries.at(-1)?.id ?? null;
      const userId = `user-${entrySequence}`;
      const userMessage = { role: "user", content: command.message, timestamp };
      respond(id);
      if (command.message === "fail-process") {
        setTimeout(() => process.exit(1), 0);
        break;
      }
      event({ type: "agent_start" });
      event({ type: "message_start", message: userMessage });

      if (command.message === "stream-084") {
        stream084({ timestamp, parentId, userId, userMessage });
        break;
      }

      if (command.message === "custom-mail") {
        customMail({ timestamp, parentId, userId, userMessage });
        break;
      }

      if (command.message === "retry") {
        const failedId = `assistant-failed-${entrySequence}`;
        const successId = `assistant-success-${entrySequence}`;
        const failedMessage = {
          role: "assistant",
          timestamp: timestamp + 1,
          stopReason: "error",
          errorMessage: "Transient provider error",
          content: [{ type: "text", text: "Partial response" }],
        };
        const successMessage = {
          role: "assistant",
          timestamp: timestamp + 2,
          stopReason: "stop",
          content: [{ type: "text", text: "E2E response" }],
        };
        event({ type: "message_start", message: failedMessage });
        event({ type: "message_end", message: failedMessage });
        event({ type: "agent_end", messages: [], willRetry: true });
        event({ type: "auto_retry_start", attempt: 2, maxAttempts: 3, delayMs: 0, errorMessage: "Transient provider error" });
        event({ type: "agent_start" });
        event({ type: "message_start", message: successMessage });
        event({ type: "message_end", message: successMessage });
        event({ type: "agent_end", messages: [], willRetry: false });
        entries = [
          ...entries,
          { type: "message", id: userId, parentId, timestamp, message: userMessage },
          { type: "message", id: failedId, parentId: userId, timestamp: timestamp + 1, message: failedMessage },
          { type: "message", id: successId, parentId: failedId, timestamp: timestamp + 2, message: successMessage },
        ];
      } else {
        const assistantId = `assistant-${entrySequence}`;
        const assistantMessage = {
          role: "assistant",
          timestamp: timestamp + 1,
          stopReason: "stop",
          content: [{ type: "text", text: command.message === "mermaid" ? "```mermaid\nflowchart LR\nA[Shared] --> B[Desktop]\n```" : command.message === "typography" ? "Typography text\n\n```ts\nconst shared = true;\n```" : "E2E response" }],
        };
        event({ type: "message_start", message: assistantMessage });
        event({ type: "message_end", message: assistantMessage });
        event({ type: "agent_end", messages: [], willRetry: false });
        entries = [
          ...entries,
          { type: "message", id: userId, parentId, timestamp, message: userMessage },
          { type: "message", id: assistantId, parentId: userId, timestamp: timestamp + 1, message: assistantMessage },
        ];
      }
      event({ type: "agent_settled" });
      break;
    }
    default: respond(id);
  }
}

function stream084({ timestamp, parentId, userId, userMessage }) {
  const assistantId = `assistant-${entrySequence}`;
  const toolResultId = `tool-result-${entrySequence}`;
  const toolCall = { type: "toolCall", id: `tool-${entrySequence}`, name: "read", arguments: { path: "stream.ts" } };
  const assistantMessage = {
    role: "assistant",
    timestamp: timestamp + 1,
    stopReason: "toolUse",
    content: [
      { type: "thinking", thinking: "Checked the file" },
      { type: "text", text: "Streaming response" },
      toolCall,
    ],
  };

  event({ type: "message_start", message: { role: "assistant", timestamp: timestamp + 1, content: [] } });
  event({ type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } });
  event({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Checking" } });
  event({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 1 } });
  event({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "Streaming" } });
  event({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 2 } });
  event({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 2, delta: '{"path":"stream.ts"' } });

  let cancelled = false;
  let progressed = false;
  let finishTimer;
  const progress = () => {
    if (cancelled || progressed) return;
    progressed = true;
    event({ type: "message_update", assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "Checked the file" } });
    event({ type: "message_update", assistantMessageEvent: { type: "text_end", contentIndex: 1, content: "Streaming response" } });
    event({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 2, toolCall } });
    event({ type: "message_end", message: assistantMessage });
    event({ type: "tool_execution_start", toolCallId: toolCall.id, toolName: toolCall.name, args: toolCall.arguments });
  };
  const progressTimer = setTimeout(progress, 120);

  const cancel = () => {
    cancelled = true;
    clearTimeout(progressTimer);
    clearTimeout(finishTimer);
    if (cancelStreaming === cancel) cancelStreaming = undefined;
  };
  cancelStreaming = cancel;
  const finish = () => {
    if (cancelled) return;
    progress();
    cancel();
    const toolResultMessage = {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{ type: "text", text: "file body" }],
      isError: false,
      timestamp: timestamp + 2,
    };
    event({
      type: "tool_execution_end",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
      result: toolResultMessage.content,
      isError: false,
    });
    entries = [
      ...entries,
      { type: "message", id: userId, parentId, timestamp, message: userMessage },
      { type: "message", id: assistantId, parentId: userId, timestamp: timestamp + 1, message: assistantMessage },
      { type: "message", id: toolResultId, parentId: assistantId, timestamp: timestamp + 2, message: toolResultMessage },
    ];
    event({ type: "agent_end", messages: [], willRetry: false });
    event({ type: "agent_settled" });
  };
  // Native smoke controls completion explicitly rather than racing a short wall-clock window.
  finishTimer = streamRelease
    ? setInterval(() => { if (require("node:fs").existsSync(streamRelease)) finish(); }, 10)
    : setTimeout(finish, 240);
}

function customMail({ timestamp, parentId, userId, userMessage }) {
  const assistantId = `assistant-${entrySequence}`;
  const toolResultId = `tool-result-${entrySequence}`;
  const mailId = `custom-mail-${entrySequence}`;
  const replyId = `reply-${entrySequence}`;
  const tool = { type: "toolCall", id: `tool-${entrySequence}`, name: "read", arguments: { path: "mail.ts" } };
  const assistant = { role: "assistant", timestamp: timestamp + 1, stopReason: "toolUse", content: [tool] };
  const result = { role: "toolResult", toolCallId: tool.id, toolName: tool.name, content: [{ type: "text", text: "file body" }], timestamp: timestamp + 2 };
  const mail = {
    role: "custom",
    customType: "pi-mail",
    display: true,
    content: "<pi_mail>Live peer mail</pi_mail>",
    details: { messageId: "peer-message", threadId: "peer-thread", recipientKind: "to" },
    timestamp: timestamp + 3,
  };
  const boundaryEntry = {
    type: "custom_message", id: `custom-boundary-${entrySequence}`, parentId: toolResultId,
    customType: mail.customType, display: false, content: "Boundary bookkeeping",
    timestamp: new Date(timestamp + 3).toISOString(),
  };
  event({ type: "message_start", message: assistant });
  event({ type: "message_end", message: assistant });
  event({ type: "tool_execution_start", toolCallId: tool.id, toolName: tool.name, args: tool.arguments });
  event({ type: "tool_execution_end", toolCallId: tool.id, toolName: tool.name, result: result.content, isError: false });
  // Boundary drafts do not produce a custom message_start/message_end pair.
  event({ type: "entry_appended", entry: boundaryEntry });
  event({ type: "message_start", message: mail });
  event({ type: "message_end", message: mail });
  event({ type: "message_start", message: { role: "assistant", timestamp: timestamp + 5, content: [] } });
  event({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
  event({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Reading the mail" } });
  entries = [
    ...entries,
    { type: "message", id: userId, parentId, timestamp, message: userMessage },
    { type: "message", id: assistantId, parentId: userId, timestamp: timestamp + 1, message: assistant },
    { type: "message", id: toolResultId, parentId: assistantId, timestamp: timestamp + 2, message: result },
    boundaryEntry,
    // Pi records custom entry timestamps at delivery, not queue creation.
    { type: "custom_message", id: mailId, parentId: boundaryEntry.id, timestamp: new Date(timestamp + 4).toISOString(), customType: mail.customType, content: mail.content, display: mail.display, details: mail.details },
  ];
  if (pendingStartupModelsId) {
    respondModels(pendingStartupModelsId);
    pendingStartupModelsId = null;
  }
  const finish = () => {
    const reply = { role: "assistant", timestamp: timestamp + 5, stopReason: "stop", content: [{ type: "text", text: "Mail handled" }] };
    event({ type: "message_end", message: reply });
    entries.push({ type: "message", id: replyId, parentId: mailId, timestamp: timestamp + 5, message: reply });
    event({ type: "agent_end", messages: [], willRetry: false });
    event({ type: "agent_settled" });
  };
  if (startupMailRaceRelease) {
    const timer = setInterval(() => {
      if (!require("node:fs").existsSync(startupMailRaceRelease)) return;
      clearInterval(timer);
      finish();
    }, 10);
  } else setTimeout(finish, 250);
}

function respondModels(id) {
  respond(id, { models: [{ provider: "e2e", id: "model", name: "E2E Model", supportsImages: true, reasoning: true }] });
}

function respond(id, data) {
  process.stdout.write(`${JSON.stringify({ type: "response", id, success: true, ...(data === undefined ? {} : { data }) })}\n`);
}

function event(value) {
  if (value.type === "agent_start") isStreaming = true;
  if (value.type === "agent_settled") {
    isStreaming = false;
    persistFixtureEntries();
  }
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

process.on("SIGTERM", () => process.exit(0));
