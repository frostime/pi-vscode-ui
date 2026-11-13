import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SIDE_QUESTION_COMMAND = "frostpi.side-question";
export const SIDE_QUESTION_TOKEN_ENV = "FROSTPI_SIDE_QUESTION_TOKEN";
export const SIDE_QUESTION_RESULT_DIR_ENV = "FROSTPI_SIDE_QUESTION_RESULT_DIR";

export const MAX_SIDE_QUESTION_LENGTH = 16_000;
export const MAX_SIDE_QUESTION_ANSWER_LENGTH = 200_000;
const MAX_ENCODED_REQUEST_LENGTH = 96_000;
const MAX_ERROR_LENGTH = 2_000;
const REQUEST_TIMEOUT_MS = 180_000;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const SIDE_QUESTION_INSTRUCTIONS = [
  "<side_question>",
  "The user is asking a quick side question while the main task continues separately.",
  "Answer it directly in one reply, using only what is already in this conversation.",
  "Do not call tools, and do not continue, restart or change the main task.",
  "This exchange is not saved to the conversation.",
  "</side_question>",
].join("\n");

type SideQuestionRequest = {
  token: string;
  requestId: string;
  question: string;
};

export type SideQuestionUsage = {
  input: number;
  output: number;
  cacheRead: number;
};

/** Why an answer may be partial: the model hit its output limit, or tried to call a tool. */
export type SideQuestionIncompleteReason = "length" | "tool-call";

export type SideQuestionAnswer = {
  status: "answered";
  answer: string;
  truncated?: true;
  incomplete?: SideQuestionIncompleteReason;
  model?: string;
  usage?: SideQuestionUsage;
};

export type SideQuestionResult = {
  version: 1;
  requestId: string;
} & (SideQuestionAnswer | { status: "failed"; error: string });

/** Structural views of the Pi extension API: this adapter is bundled without Pi's packages. */
type ModelMessage = { role: string; content?: unknown; timestamp?: number; [key: string]: unknown };

type AssistantReply = {
  content?: unknown;
  stopReason?: string;
  errorMessage?: string;
  usage?: { input?: unknown; output?: unknown; cacheRead?: unknown };
};

type ToolDeclaration = { name: string; description: string; parameters: object };

type ModelContext = { systemPrompt?: string; tools?: ToolDeclaration[]; messages: ModelMessage[] };

type RequestOptions = { signal: AbortSignal; reasoning?: string; sessionId?: string };

type CommandContext = {
  model?: { id?: string; provider?: string; reasoning?: boolean } | undefined;
  thinkingLevel?: string;
  modelRegistry?: {
    streamSimple?(model: unknown, context: ModelContext, options: RequestOptions): { result(): Promise<AssistantReply> };
    complete?(model: unknown, context: ModelContext, options: { signal: AbortSignal }): Promise<AssistantReply>;
  };
  sessionManager?: {
    buildSessionProjection?(): { messages?: unknown };
    buildSessionContext?(): { messages?: unknown };
    getSessionId?(): string | undefined;
  };
  getSystemPrompt?(): string;
};

type ExtensionApi = {
  registerCommand(
    name: string,
    options: { description: string; handler(args: string, context: CommandContext): Promise<void> },
  ): void;
  getSettings?(): { images?: { blockImages?: unknown } } | undefined;
  getActiveTools?(): unknown;
  getAllTools?(): unknown;
};

/** The text Pi itself sends in place of an image when `images.blockImages` is on. */
const BLOCKED_IMAGE_TEXT = "Image reading is disabled.";

/**
 * Answers one question from the conversation Pi already holds, with Pi's own model and
 * credentials, without adding anything to the session. Pi runs extension commands at
 * once, so this also works while the agent is busy.
 *
 * The request goes through Pi's documented model API for extensions, not through the
 * agent loop. Pi's `images.blockImages` setting is applied here because of that; other
 * extensions' `context`, `before_provider_request` and `before_provider_headers` hooks
 * are not reachable from an extension and do not run for a side question.
 */
export default function sideQuestionExtension(pi: ExtensionApi): void {
  pi.registerCommand(SIDE_QUESTION_COMMAND, {
    description: "FrostPi private side-question adapter",
    handler: async (args, context) => {
      const request = decodeRequest(args);
      const token = requiredEnvironment(SIDE_QUESTION_TOKEN_ENV);
      if (request.token !== token) throw new Error("Invalid FrostPi side-question token");
      const resultDirectory = requiredEnvironment(SIDE_QUESTION_RESULT_DIR_ENV);

      let result: SideQuestionResult;
      try {
        result = { version: 1, requestId: request.requestId, ...await answer(pi, context, request.question) };
      } catch (error) {
        result = {
          version: 1,
          requestId: request.requestId,
          status: "failed",
          error: errorText(error).slice(0, MAX_ERROR_LENGTH),
        };
      }
      await writeResult(resultDirectory, result);
    },
  });
}

async function answer(pi: ExtensionApi, context: CommandContext, question: string): Promise<SideQuestionAnswer> {
  const model = context.model;
  if (!model) throw new Error("No model is selected for this session.");
  const registry = context.modelRegistry;
  const modelContext = buildModelContext(pi, context, question);
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  let reply: AssistantReply;
  if (typeof registry?.streamSimple === "function") {
    const reasoning = model.reasoning && context.thinkingLevel && context.thinkingLevel !== "off"
      ? context.thinkingLevel
      : undefined;
    const sessionId = context.sessionManager?.getSessionId?.();
    // The same thinking level and session id as the agent's own requests keep the
    // provider's prompt cache usable for the conversation prefix.
    reply = await registry.streamSimple(model, modelContext, {
      signal,
      ...(reasoning ? { reasoning } : {}),
      ...(sessionId ? { sessionId } : {}),
    }).result();
  } else if (typeof registry?.complete === "function") {
    reply = await registry.complete(model, modelContext, { signal });
  } else {
    throw new Error("This Pi version cannot answer side questions. Update Pi and restart the session.");
  }

  if (reply.stopReason === "error" || reply.stopReason === "aborted") {
    throw new Error(reply.errorMessage || (reply.stopReason === "aborted" ? "The side question timed out." : "The model request failed."));
  }
  const parts = Array.isArray(reply.content) ? reply.content.filter(isRecord) : [];
  const text = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n")
    .trim();
  const calledTool = reply.stopReason === "toolUse" || parts.some((part) => part.type === "toolCall");
  if (!text) {
    throw new Error(calledTool
      ? "The model tried to use a tool instead of answering. Side questions cannot use tools."
      : "The model returned no answer.");
  }
  // Text beside a tool call may be only a preamble, and a reply stopped at the output
  // limit is cut short. Either is still shown, marked so it is not read as complete.
  const incomplete: SideQuestionIncompleteReason | undefined = reply.stopReason === "length"
    ? "length"
    : calledTool ? "tool-call" : undefined;

  const truncated = text.length > MAX_SIDE_QUESTION_ANSWER_LENGTH;
  const usage = usageView(reply.usage);
  return {
    status: "answered",
    answer: truncated ? text.slice(0, MAX_SIDE_QUESTION_ANSWER_LENGTH) : text,
    ...(truncated ? { truncated: true as const } : {}),
    ...(incomplete ? { incomplete } : {}),
    ...(model.id ? { model: model.provider ? `${model.provider}/${model.id}` : model.id } : {}),
    ...(usage ? { usage } : {}),
  };
}

function buildModelContext(pi: ExtensionApi, context: CommandContext, question: string): ModelContext {
  const manager = context.sessionManager;
  const projection = typeof manager?.buildSessionProjection === "function"
    ? manager.buildSessionProjection()
    : typeof manager?.buildSessionContext === "function"
      ? manager.buildSessionContext()
      : undefined;
  if (!projection || !Array.isArray(projection.messages)) {
    throw new Error("This Pi version does not expose the conversation to extensions. Update Pi and restart the session.");
  }

  const converted = modelMessages(projection.messages);
  const messages = imagesBlocked(pi) ? withoutImages(converted) : converted;
  messages.push({
    role: "user",
    content: [{ type: "text", text: `${SIDE_QUESTION_INSTRUCTIONS}\n\n${question}` }],
    timestamp: Date.now(),
  });
  // Current Pi keeps the system prompt and tool set inside the transcript. Older
  // transcripts carry neither, so both are supplied the documented way: a history
  // with tool calls needs its tools declared to stay a valid request.
  if (messages.some((message) => message.role === "system")) return { messages };
  const systemPrompt = context.getSystemPrompt?.();
  const tools = activeToolDeclarations(pi);
  return { ...(systemPrompt ? { systemPrompt } : {}), ...(tools.length > 0 ? { tools } : {}), messages };
}

/**
 * Whether Pi's "do not send images to models" setting is on. A Pi that cannot report
 * its settings counts as blocking: leaving an image out is the recoverable mistake.
 */
function imagesBlocked(pi: ExtensionApi): boolean {
  if (typeof pi.getSettings !== "function") return true;
  try {
    return pi.getSettings()?.images?.blockImages === true;
  } catch {
    return true;
  }
}

/**
 * Pi's own substitution for blocked images, so the request prefix still matches what
 * the agent sends: each image becomes one placeholder text, consecutive ones collapse.
 */
function withoutImages(messages: readonly ModelMessage[]): ModelMessage[] {
  const isImage = (part: unknown): boolean => isRecord(part) && part.type === "image";
  const isPlaceholder = (part: unknown): boolean => isRecord(part) && part.type === "text" && part.text === BLOCKED_IMAGE_TEXT;
  return messages.map((message) => {
    if ((message.role !== "user" && message.role !== "toolResult") || !Array.isArray(message.content)) return message;
    const content: unknown[] = message.content;
    if (!content.some(isImage)) return message;
    const replaced = content.map((part) => isImage(part) ? { type: "text", text: BLOCKED_IMAGE_TEXT } : part);
    return {
      ...message,
      content: replaced.filter((part, index) => !(index > 0 && isPlaceholder(part) && isPlaceholder(replaced[index - 1]))),
    };
  });
}

function activeToolDeclarations(pi: ExtensionApi): ToolDeclaration[] {
  if (typeof pi.getActiveTools !== "function" || typeof pi.getAllTools !== "function") return [];
  try {
    const active = pi.getActiveTools();
    const all = pi.getAllTools();
    if (!Array.isArray(active) || !Array.isArray(all)) return [];
    return all.flatMap((tool: unknown): ToolDeclaration[] => {
      if (!isRecord(tool) || typeof tool.name !== "string" || !active.includes(tool.name) || !isRecord(tool.parameters)) return [];
      return [{ name: tool.name, description: typeof tool.description === "string" ? tool.description : "", parameters: tool.parameters }];
    });
  } catch {
    return [];
  }
}

/**
 * Pi's own session-to-model conversion: summaries, extension messages and shell runs
 * become user text; model-native roles pass through untouched.
 */
function modelMessages(source: readonly unknown[]): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (const value of source) {
    if (!isRecord(value) || typeof value.role !== "string") continue;
    const message = value as ModelMessage;
    const timestamp = typeof message.timestamp === "number" ? message.timestamp : Date.now();
    switch (message.role) {
      case "system":
      case "user":
      case "assistant":
      case "toolResult":
        messages.push(message);
        break;
      case "custom":
        messages.push({
          role: "user",
          content: typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content,
          timestamp,
        });
        break;
      case "compactionSummary":
        messages.push(userText(
          `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${stringField(message.summary)}\n</summary>`,
          timestamp,
        ));
        break;
      case "branchSummary":
        messages.push(userText(
          `The following is a summary of a branch that this conversation came back from:\n\n<summary>\n${stringField(message.summary)}</summary>`,
          timestamp,
        ));
        break;
      case "bashExecution":
        if (message.excludeFromContext !== true) messages.push(userText(shellRunText(message), timestamp));
        break;
      default:
        break;
    }
  }
  return messages;
}

function shellRunText(message: ModelMessage): string {
  const output = stringField(message.output);
  let text = `Ran \`${stringField(message.command)}\`\n${output ? `\`\`\`\n${output}\n\`\`\`` : "(no output)"}`;
  if (message.cancelled === true) text += "\n\n(command cancelled)";
  else if (typeof message.exitCode === "number" && message.exitCode !== 0) text += `\n\nCommand exited with code ${message.exitCode}`;
  return text;
}

function userText(text: string, timestamp: number): ModelMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp };
}

function usageView(usage: AssistantReply["usage"]): SideQuestionUsage | undefined {
  if (!usage) return undefined;
  const count = (value: unknown): number => typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  const view = { input: count(usage.input), output: count(usage.output), cacheRead: count(usage.cacheRead) };
  return view.input + view.output + view.cacheRead > 0 ? view : undefined;
}

function decodeRequest(encoded: string): SideQuestionRequest {
  if (!encoded || encoded.length > MAX_ENCODED_REQUEST_LENGTH || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error("Invalid FrostPi side-question request encoding");
  }

  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid FrostPi side-question request payload");
  }
  if (!isRecord(value)) throw new Error("Invalid FrostPi side-question request payload");

  const allowedKeys = new Set(["token", "requestId", "question"]);
  if (
    Object.keys(value).some((key) => !allowedKeys.has(key))
    || typeof value.token !== "string"
    || typeof value.requestId !== "string"
    || !IDENTIFIER_PATTERN.test(value.requestId)
    || typeof value.question !== "string"
    || !value.question.trim()
    || value.question.length > MAX_SIDE_QUESTION_LENGTH
  ) {
    throw new Error("Invalid FrostPi side-question request fields");
  }
  return value as SideQuestionRequest;
}

async function writeResult(directory: string, result: SideQuestionResult): Promise<void> {
  const resultPath = join(directory, `${result.requestId}.json`);
  const temporaryPath = `${resultPath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(result), { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporaryPath, resultPath);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
