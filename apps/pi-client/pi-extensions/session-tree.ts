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

type SessionTreeRequest = NavigateOptions & {
  token: string;
  requestId: string;
  targetId: string;
};

type SessionTreeResult = {
  version: 1;
  requestId: string;
  status: "cancelled" | "committed" | "failed";
  leafId: string | null;
};

type CommandContext = {
  waitForIdle(): Promise<void>;
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

  return value as SessionTreeRequest;
}

function navigationOptions(request: SessionTreeRequest): NavigateOptions | undefined {
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
