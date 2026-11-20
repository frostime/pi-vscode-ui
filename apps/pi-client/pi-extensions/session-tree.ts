import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SESSION_TREE_COMMAND = "frostpi.session-tree";
export const SESSION_TREE_TOKEN_ENV = "FROSTPI_SESSION_TREE_TOKEN";
export const SESSION_TREE_RESULT_DIR_ENV = "FROSTPI_SESSION_TREE_RESULT_DIR";

const MAX_ENCODED_REQUEST_LENGTH = 16_384;
const MAX_CUSTOM_INSTRUCTIONS_LENGTH = 8_192;
const MAX_RESULT_LENGTH = 1_024;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

type NavigateOptions = {
  summarize?: boolean;
  customInstructions?: string;
  replaceInstructions?: boolean;
};

type NavigateRequest = NavigateOptions & {
  token: string;
  requestId: string;
  targetId: string;
};

/** `/reload`: Pi's own reload flow, which RPC mode exposes only to extension commands. */
type ReloadRequest = {
  token: string;
  requestId: string;
  action: "reload";
};

type SessionTreeRequest = NavigateRequest | ReloadRequest;

type SessionTreeResult = {
  version: 1;
  requestId: string;
  status: "cancelled" | "committed" | "failed";
  leafId: string | null;
};

type CommandContext = {
  waitForIdle(): Promise<void>;
  reload?(): Promise<void>;
  navigateTree(targetId: string, options?: NavigateOptions): Promise<{ cancelled: boolean }>;
  sessionManager: { getLeafId(): string | null };
};

type ExtensionApi = {
  registerCommand(
    name: string,
    options: { description: string; handler(args: string, context: CommandContext): Promise<void> },
  ): void;
};

export default function sessionTreeExtension(pi: ExtensionApi): void {
  pi.registerCommand(SESSION_TREE_COMMAND, {
    description: "FrostPi private session-tree adapter",
    handler: async (args, context) => {
      const request = decodeRequest(args);
      const token = requiredEnvironment(SESSION_TREE_TOKEN_ENV);
      if (request.token !== token) throw new Error("Invalid FrostPi session-tree token");

      const resultDirectory = requiredEnvironment(SESSION_TREE_RESULT_DIR_ENV);
      if ("action" in request) {
        await reload(context, request, resultDirectory);
        return;
      }
      const beforeLeafId = context.sessionManager.getLeafId();
      let result: SessionTreeResult;

      try {
        await context.waitForIdle();
        const navigation = await context.navigateTree(request.targetId, navigationOptions(request));
        result = {
          version: 1,
          requestId: request.requestId,
          status: navigation.cancelled ? "cancelled" : "committed",
          leafId: context.sessionManager.getLeafId(),
        };
      } catch (error) {
        const leafId = context.sessionManager.getLeafId();
        result = {
          version: 1,
          requestId: request.requestId,
          status: leafId !== beforeLeafId ? "committed" : "failed",
          leafId,
        };
        await writeResult(resultDirectory, result);
        throw error;
      }

      await writeResult(resultDirectory, result);
    },
  });
}

async function reload(context: CommandContext, request: ReloadRequest, resultDirectory: string): Promise<void> {
  if (typeof context.reload !== "function") {
    await writeResult(resultDirectory, { version: 1, requestId: request.requestId, status: "failed", leafId: null });
    throw new Error("This Pi version cannot reload from an extension command. Update Pi, or restart the session.");
  }
  const leafId = context.sessionManager.getLeafId();
  try {
    await context.waitForIdle();
    // Reload replaces this extension's runtime: nothing below may touch `context` again.
    await context.reload();
  } catch (error) {
    await writeResult(resultDirectory, { version: 1, requestId: request.requestId, status: "failed", leafId });
    throw error;
  }
  await writeResult(resultDirectory, { version: 1, requestId: request.requestId, status: "committed", leafId });
}

function decodeRequest(encoded: string): SessionTreeRequest {
  if (!encoded || encoded.length > MAX_ENCODED_REQUEST_LENGTH || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error("Invalid FrostPi session-tree request encoding");
  }

  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid FrostPi session-tree request payload");
  }
  if (!isRecord(value)) throw new Error("Invalid FrostPi session-tree request payload");

  if ("action" in value) {
    if (
      Object.keys(value).some((key) => !["token", "requestId", "action"].includes(key))
      || value.action !== "reload"
      || typeof value.token !== "string"
      || !IDENTIFIER_PATTERN.test(value.requestId as string)
    ) {
      throw new Error("Invalid FrostPi session-tree request fields");
    }
    return value as ReloadRequest;
  }

  const allowedKeys = new Set([
    "token",
    "requestId",
    "targetId",
    "summarize",
    "customInstructions",
    "replaceInstructions",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("Invalid FrostPi session-tree request fields");
  }
  if (
    typeof value.token !== "string" ||
    !IDENTIFIER_PATTERN.test(value.requestId as string) ||
    !IDENTIFIER_PATTERN.test(value.targetId as string) ||
    (value.summarize !== undefined && typeof value.summarize !== "boolean") ||
    (value.replaceInstructions !== undefined && typeof value.replaceInstructions !== "boolean") ||
    (value.customInstructions !== undefined &&
      (typeof value.customInstructions !== "string" ||
        value.customInstructions.length > MAX_CUSTOM_INSTRUCTIONS_LENGTH))
  ) {
    throw new Error("Invalid FrostPi session-tree request fields");
  }
  if (value.customInstructions !== undefined && value.summarize !== true) {
    throw new Error("Custom summary instructions require summarization");
  }

  return value as NavigateRequest;
}

function navigationOptions(request: NavigateRequest): NavigateOptions | undefined {
  if (request.summarize === undefined) return undefined;
  return {
    summarize: request.summarize,
    ...(request.customInstructions !== undefined ? { customInstructions: request.customInstructions } : {}),
    ...(request.replaceInstructions !== undefined ? { replaceInstructions: request.replaceInstructions } : {}),
  };
}

async function writeResult(directory: string, result: SessionTreeResult): Promise<void> {
  const body = JSON.stringify(result);
  if (Buffer.byteLength(body, "utf8") > MAX_RESULT_LENGTH) throw new Error("FrostPi session-tree result is too large");

  const resultPath = join(directory, `${result.requestId}.json`);
  const temporaryPath = `${resultPath}.tmp`;
  await writeFile(temporaryPath, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporaryPath, resultPath);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
