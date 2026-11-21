import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import sideQuestionExtension, {
  MAX_SIDE_QUESTION_ANSWER_LENGTH,
  SIDE_QUESTION_COMMAND,
  SIDE_QUESTION_RESULT_DIR_ENV,
  SIDE_QUESTION_TOKEN_ENV,
} from "../../../pi-client/pi-extensions/side-question.js";

type Handler = (args: string, context: unknown) => Promise<void>;
type StreamSimple = (model: unknown, context: { systemPrompt?: string; tools?: unknown[]; messages: Message[] }, options: Record<string, unknown>) => { result(): Promise<Reply> };
type PiApi = Omit<Parameters<typeof sideQuestionExtension>[0], "registerCommand">;
type Reply = { content?: unknown; stopReason?: string; errorMessage?: string; usage?: Record<string, unknown> };
type Message = { role: string; content?: unknown };

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "frostpi-side-question-extension-"));
  process.env[SIDE_QUESTION_TOKEN_ENV] = "runtime-token";
  process.env[SIDE_QUESTION_RESULT_DIR_ENV] = directory;
});

afterEach(async () => {
  delete process.env[SIDE_QUESTION_TOKEN_ENV];
  delete process.env[SIDE_QUESTION_RESULT_DIR_ENV];
  await rm(directory, { recursive: true, force: true });
});

/** `api` is the rest of Pi's extension API; by default images are allowed, as in Pi. */
function registeredHandler(api: PiApi = { getSettings: () => ({}) }): { handler: Handler; commandName: string } {
  let handler: Handler | undefined;
  let commandName = "";
  sideQuestionExtension({
    ...api,
    registerCommand: (name, options) => {
      commandName = name;
      handler = (args, context) => options.handler(args, context as never);
    },
  });
  if (!handler) throw new Error("The extension did not register a command.");
  return { handler, commandName };
}

function encodeRequest(request: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify({ token: "runtime-token", ...request }), "utf8").toString("base64url");
}

async function readResult(requestId: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(directory, `${requestId}.json`), "utf8")) as Record<string, unknown>;
}

function textReply(text: string, extra: Partial<Reply> = {}): Reply {
  return { stopReason: "stop", content: [{ type: "text", text }], ...extra };
}

function currentPiContext(messages: Message[], reply: Reply | (() => Promise<Reply>)) {
  const streamSimple = vi.fn<StreamSimple>(() => ({
    result: () => typeof reply === "function" ? reply() : Promise.resolve(reply),
  }));
  return {
    streamSimple,
    context: {
      model: { provider: "anthropic", id: "claude", reasoning: true },
      thinkingLevel: "high",
      modelRegistry: { streamSimple },
      sessionManager: { buildSessionProjection: () => ({ messages }), getSessionId: () => "session-1" },
      getSystemPrompt: () => "SYSTEM PROMPT",
    },
  };
}

describe("side-question Pi extension", () => {
  it("answers with the session's own transcript, model, thinking level and cache identity", async () => {
    const { handler, commandName } = registeredHandler();
    const transcript: Message[] = [
      { role: "system", content: "You are Pi." },
      { role: "user", content: [{ type: "text", text: "Fix the bug" }] },
      { role: "assistant", content: [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }] },
      { role: "toolResult", content: [{ type: "text", text: "ok" }] },
    ];
    const { context, streamSimple } = currentPiContext(transcript, textReply("  It is in parser.ts.  ", {
      usage: { input: 20, output: 5, cacheRead: 4000, cacheWrite: 0 },
    }));

    await handler(encodeRequest({ requestId: "q1", question: "Where is the bug?" }), context);

    expect(commandName).toBe(SIDE_QUESTION_COMMAND);
    const [model, modelContext, options] = streamSimple.mock.calls[0]!;
    expect(model).toBe(context.model);
    // The transcript already carries the system prompt and tool set: the prefix is sent unchanged.
    expect(modelContext.systemPrompt).toBeUndefined();
    expect(modelContext.tools).toBeUndefined();
    expect(modelContext.messages.slice(0, 4)).toEqual(transcript);
    expect(modelContext.messages).toHaveLength(5);
    const question = modelContext.messages[4] as { role: string; content: Array<{ text: string }> };
    expect(question.role).toBe("user");
    expect(question.content[0]!.text).toContain("<side_question>");
    expect(question.content[0]!.text).toContain("Do not call tools");
    expect(question.content[0]!.text.endsWith("Where is the bug?")).toBe(true);
    expect(options).toMatchObject({ reasoning: "high", sessionId: "session-1" });
    expect(options.signal).toBeInstanceOf(AbortSignal);

    await expect(readResult("q1")).resolves.toEqual({
      version: 1,
      requestId: "q1",
      status: "answered",
      answer: "It is in parser.ts.",
      model: "anthropic/claude",
      usage: { input: 20, output: 5, cacheRead: 4000 },
    });
    // The transcript the session owns is never mutated by the side question.
    expect(transcript).toHaveLength(4);
  });

  it("writes an owner-only result and leaves no temporary file", async () => {
    const { handler } = registeredHandler();
    await handler(encodeRequest({ requestId: "q-mode", question: "?" }), currentPiContext([], textReply("yes")).context);

    expect(await readdir(directory)).toEqual(["q-mode.json"]);
    if (process.platform !== "win32") expect((await stat(join(directory, "q-mode.json"))).mode & 0o777).toBe(0o600);
  });

  it("converts Pi's own session messages the way Pi does and drops what Pi keeps out of context", async () => {
    const { handler } = registeredHandler();
    const { context, streamSimple } = currentPiContext([
      { role: "compactionSummary", summary: "Earlier work" } as never,
      { role: "branchSummary", summary: "Other branch" } as never,
      { role: "custom", content: "Injected note" },
      { role: "bashExecution", command: "ls", output: "a.txt", exitCode: 2 } as never,
      { role: "bashExecution", command: "secret", output: "x", excludeFromContext: true } as never,
      { role: "somethingNew", content: "ignored" },
    ], textReply("ok"));

    await handler(encodeRequest({ requestId: "q2", question: "Summarize" }), context);

    const sent = streamSimple.mock.calls[0]![1].messages.slice(0, -1) as Array<{ role: string; content: Array<{ text: string }> }>;
    expect(sent.map((message) => message.role)).toEqual(["user", "user", "user", "user"]);
    expect(sent[0]!.content[0]!.text).toContain("<summary>\nEarlier work\n</summary>");
    expect(sent[1]!.content[0]!.text).toContain("Other branch");
    expect(sent[2]!.content[0]!.text).toBe("Injected note");
    expect(sent[3]!.content[0]!.text).toBe("Ran `ls`\n```\na.txt\n```\n\nCommand exited with code 2");
    // Without a system message in the transcript, the prompt is supplied the documented way.
    expect(streamSimple.mock.calls[0]![1].systemPrompt).toBe("SYSTEM PROMPT");
  });

  describe("images in the conversation", () => {
    const image = { type: "image", data: "AAAA", mimeType: "image/png" };
    const transcript = (): Message[] => [
      { role: "system", content: "You are Pi." },
      { role: "user", content: [{ type: "text", text: "Look" }, image, image] },
      { role: "toolResult", content: [image, { type: "text", text: "shot" }] },
      { role: "custom", content: [image] },
      { role: "assistant", content: [{ type: "text", text: "Seen." }] },
    ];
    const placeholder = { type: "text", text: "Image reading is disabled." };

    it.each([
      ["Pi's blockImages setting is on", { getSettings: () => ({ images: { blockImages: true } }) }],
      ["this Pi cannot report its settings", {}],
      ["reading the settings fails", { getSettings: () => { throw new Error("Extension runtime not initialized"); } }],
    ] satisfies Array<[string, PiApi]>)("sends Pi's placeholder instead of every image when %s", async (_label, api) => {
      const { handler } = registeredHandler(api);
      const source = transcript();
      const { context, streamSimple } = currentPiContext(source, textReply("ok"));

      await handler(encodeRequest({ requestId: "q-blocked", question: "What is in the screenshot?" }), context);

      const sent = streamSimple.mock.calls[0]![1].messages;
      expect(JSON.stringify(sent)).not.toContain("AAAA");
      // The same substitution as Pi's own requests, consecutive placeholders collapsed.
      expect(sent[1]!.content).toEqual([{ type: "text", text: "Look" }, placeholder]);
      expect(sent[2]!.content).toEqual([placeholder, { type: "text", text: "shot" }]);
      expect(sent[3]).toMatchObject({ role: "user", content: [placeholder] });
      expect(sent[4]).toBe(source[4]);
      // The session's own messages are not edited.
      expect(source[1]!.content).toHaveLength(3);
      await expect(readResult("q-blocked")).resolves.toMatchObject({ status: "answered" });
    });

    it.each([
      ["unset", {}],
      ["off", { images: { blockImages: false } }],
    ])("sends them unchanged when the setting is %s", async (_label, settings) => {
      const { handler } = registeredHandler({ getSettings: () => settings });
      const source = transcript();
      const { context, streamSimple } = currentPiContext(source, textReply("ok"));

      await handler(encodeRequest({ requestId: "q-images", question: "?" }), context);

      expect(streamSimple.mock.calls[0]![1].messages.slice(0, 3)).toEqual(source.slice(0, 3));
    });
  });

  it("declares the active tools for a transcript that carries no system message", async () => {
    const parameters = { type: "object", properties: {} };
    const { handler } = registeredHandler({
      getSettings: () => ({}),
      getActiveTools: () => ["bash"],
      getAllTools: () => [
        { name: "bash", description: "Run a command", parameters, exposure: "direct" },
        { name: "inactive", description: "Not declared to the model", parameters },
      ],
    });
    const { context, streamSimple } = currentPiContext([
      { role: "user", content: [{ type: "text", text: "Run it" }] },
      { role: "assistant", content: [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }] },
      { role: "toolResult", content: [{ type: "text", text: "ok" }] },
    ], textReply("done"));

    await handler(encodeRequest({ requestId: "q-tools", question: "?" }), context);

    // A history with tool calls is only a valid request with those tools declared.
    expect(streamSimple.mock.calls[0]![1]).toMatchObject({
      systemPrompt: "SYSTEM PROMPT",
      tools: [{ name: "bash", description: "Run a command", parameters }],
    });
  });

  it.each([
    ["stopped at its output limit", { stopReason: "length", content: [{ type: "text", text: "The first half" }] }, "length"],
    ["also tried to call a tool", { stopReason: "toolUse", content: [{ type: "text", text: "Let me check." }, { type: "toolCall", name: "bash" }] }, "tool-call"],
  ] satisfies Array<[string, Reply, string]>)("marks the answer as possibly partial when the model %s", async (_label, reply, incomplete) => {
    const { handler } = registeredHandler();
    await handler(encodeRequest({ requestId: "q-partial", question: "?" }), currentPiContext([], reply).context);
    await expect(readResult("q-partial")).resolves.toMatchObject({ status: "answered", incomplete });
  });

  it("sends no reasoning option when thinking is off or the model cannot reason", async () => {
    const { handler } = registeredHandler();
    const off = currentPiContext([], textReply("a"));
    off.context.thinkingLevel = "off";
    await handler(encodeRequest({ requestId: "q-off", question: "?" }), off.context);
    expect(off.streamSimple.mock.calls[0]![2]).not.toHaveProperty("reasoning");

    const plain = currentPiContext([], textReply("a"));
    plain.context.model.reasoning = false;
    await handler(encodeRequest({ requestId: "q-plain", question: "?" }), plain.context);
    expect(plain.streamSimple.mock.calls[0]![2]).not.toHaveProperty("reasoning");
  });

  it.each([
    ["a provider error", { stopReason: "error", errorMessage: "529 overloaded" }, "529 overloaded"],
    ["a tool call instead of an answer", { stopReason: "toolUse", content: [{ type: "toolCall", name: "bash" }] }, "The model tried to use a tool instead of answering. Side questions cannot use tools."],
    ["an empty reply", { stopReason: "stop", content: [{ type: "thinking", thinking: "hm" }] }, "The model returned no answer."],
  ] satisfies Array<[string, Reply, string]>)("reports %s as a failed result", async (_label, reply, error) => {
    const { handler } = registeredHandler();
    await handler(encodeRequest({ requestId: "q-fail", question: "?" }), currentPiContext([], reply).context);
    await expect(readResult("q-fail")).resolves.toEqual({ version: 1, requestId: "q-fail", status: "failed", error });
  });

  it("reports a thrown request, a missing model and an unsupported Pi as failed results", async () => {
    const { handler } = registeredHandler();
    await handler(encodeRequest({ requestId: "q-throw", question: "?" }), currentPiContext([], () => Promise.reject(new Error("socket hang up"))).context);
    await expect(readResult("q-throw")).resolves.toMatchObject({ status: "failed", error: "socket hang up" });

    const noModel = currentPiContext([], textReply("a")).context;
    await handler(encodeRequest({ requestId: "q-model", question: "?" }), { ...noModel, model: undefined });
    await expect(readResult("q-model")).resolves.toMatchObject({ status: "failed", error: "No model is selected for this session." });

    await handler(encodeRequest({ requestId: "q-old", question: "?" }), { ...noModel, modelRegistry: {} });
    await expect(readResult("q-old")).resolves.toMatchObject({ status: "failed", error: expect.stringContaining("cannot answer side questions") as string });

    await handler(encodeRequest({ requestId: "q-context", question: "?" }), { ...noModel, sessionManager: {} });
    await expect(readResult("q-context")).resolves.toMatchObject({ status: "failed", error: expect.stringContaining("does not expose the conversation") as string });
  });

  it("falls back to complete() on a Pi without streamSimple", async () => {
    const { handler } = registeredHandler();
    const complete = vi.fn(() => Promise.resolve(textReply("from complete")));
    const base = currentPiContext([], textReply("unused")).context;
    await handler(encodeRequest({ requestId: "q-complete", question: "?" }), { ...base, modelRegistry: { complete } });
    expect(complete).toHaveBeenCalledOnce();
    await expect(readResult("q-complete")).resolves.toMatchObject({ status: "answered", answer: "from complete" });
  });

  it("bounds the answer it hands back", async () => {
    const { handler } = registeredHandler();
    await handler(encodeRequest({ requestId: "q-long", question: "?" }), currentPiContext([], textReply("x".repeat(MAX_SIDE_QUESTION_ANSWER_LENGTH + 10))).context);
    const result = await readResult("q-long");
    expect(result).toMatchObject({ status: "answered", truncated: true });
    expect((result.answer as string).length).toBe(MAX_SIDE_QUESTION_ANSWER_LENGTH);
  });

  it.each([
    ["a wrong token", encodeRequest({ token: "other", requestId: "bad", question: "?" }), "Invalid FrostPi side-question token"],
    ["an unknown field", encodeRequest({ requestId: "bad", question: "?", targetId: "x" }), "Invalid FrostPi side-question request fields"],
    ["a path-like request id", encodeRequest({ requestId: "../escape", question: "?" }), "Invalid FrostPi side-question request fields"],
    ["an empty question", encodeRequest({ requestId: "bad", question: "   " }), "Invalid FrostPi side-question request fields"],
    ["a non-encoded argument", "what is this?", "Invalid FrostPi side-question request encoding"],
  ])("refuses %s without calling the model or writing a result", async (_label, args, message) => {
    const { handler } = registeredHandler();
    const { context, streamSimple } = currentPiContext([], textReply("a"));
    await expect(handler(args, context)).rejects.toThrow(message);
    expect(streamSimple).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });
});
