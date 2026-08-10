#!/usr/bin/env node

let buffer = "";
let sessionName = "E2E session";
let entries = [];
let entrySequence = 0;
const sessionFile = process.argv.includes("--no-session")
  ? undefined
  : `${process.cwd().replaceAll("\\", "/")}/.frostpi-e2e-session.jsonl`;

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
    case "get_state":
      respond(id, {
        model: { provider: "e2e", id: "model", name: "E2E Model", supportsImages: true, reasoning: true },
        thinkingLevel: "medium",
        isStreaming: false,
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
      respond(id, { models: [{ provider: "e2e", id: "model", name: "E2E Model", supportsImages: true, reasoning: true }] });
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
    case "set_session_name": sessionName = command.name; respond(id); break;
    case "set_model":
      respond(id, { provider: command.provider, id: command.modelId, name: "E2E Model", supportsImages: true, reasoning: true });
      break;
    case "set_thinking_level": respond(id); break;
    case "abort": respond(id); event({ type: "agent_settled" }); break;
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
          content: [{ type: "text", text: "E2E response" }],
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

  setTimeout(() => {
    event({ type: "message_update", assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "Checked the file" } });
    event({ type: "message_update", assistantMessageEvent: { type: "text_end", contentIndex: 1, content: "Streaming response" } });
    event({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 2, toolCall } });
    event({ type: "message_end", message: assistantMessage });
    event({ type: "tool_execution_start", toolCallId: toolCall.id, toolName: toolCall.name, args: toolCall.arguments });
  }, 120);

  setTimeout(() => {
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
  }, 240);
}

function respond(id, data) {
  process.stdout.write(`${JSON.stringify({ type: "response", id, success: true, ...(data === undefined ? {} : { data }) })}\n`);
}

function event(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

process.on("SIGTERM", () => process.exit(0));
