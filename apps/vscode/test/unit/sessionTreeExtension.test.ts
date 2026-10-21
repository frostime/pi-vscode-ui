import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import sessionTreeExtension, {
  SESSION_TREE_COMMAND,
  SESSION_TREE_RESULT_DIR_ENV,
  SESSION_TREE_TOKEN_ENV,
} from "../../../pi-client/pi-extensions/session-tree.js";

type Handler = (args: string, context: CommandContext) => Promise<void>;
type NavigateOptions = { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean };
type CommandContext = {
  waitForIdle: Mock<() => Promise<void>>;
  navigateTree: Mock<(targetId: string, options?: NavigateOptions) => Promise<{ cancelled: boolean }>>;
  sessionManager: { getLeafId: () => string | null };
};

const directories: string[] = [];

beforeEach(async () => {
  process.env[SESSION_TREE_TOKEN_ENV] = "runtime-token";
  process.env[SESSION_TREE_RESULT_DIR_ENV] = await temporaryDirectory();
});

afterEach(async () => {
  delete process.env[SESSION_TREE_TOKEN_ENV];
  delete process.env[SESSION_TREE_RESULT_DIR_ENV];
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("session-tree Pi extension", () => {
  it("registers one private command and commits a no-summary navigation", async () => {
    const { handler, commandName, description } = registeredHandler();
    const context = createContext(["old-leaf", "target-entry"]);

    await handler(encodeRequest({ requestId: "request-1", targetId: "target-entry", summarize: false }), context);

    expect(commandName).toBe(SESSION_TREE_COMMAND);
    expect(description).toBe("FrostPi private session-tree adapter");
    expect(context.waitForIdle).toHaveBeenCalledOnce();
    expect(context.navigateTree).toHaveBeenCalledWith("target-entry", { summarize: false });
    await expect(readResult("request-1")).resolves.toEqual({
      version: 1,
      requestId: "request-1",
      status: "committed",
      leafId: "target-entry",
    });
  });

  it("passes custom summary options without writing summary content", async () => {
    const { handler } = registeredHandler();
    const context = createContext(["old-leaf", "summary-leaf"]);

    await handler(
      encodeRequest({
        requestId: "request-2",
        targetId: "target-entry",
        summarize: true,
        customInstructions: "Focus on decisions",
        replaceInstructions: true,
      }),
      context,
    );

    expect(context.navigateTree).toHaveBeenCalledWith("target-entry", {
      summarize: true,
      customInstructions: "Focus on decisions",
      replaceInstructions: true,
    });
    const body = await readFile(resultPath("request-2"), "utf8");
    expect(body).not.toContain("Focus on decisions");
    expect(JSON.parse(body)).toEqual({
      version: 1,
      requestId: "request-2",
      status: "committed",
      leafId: "summary-leaf",
    });
  });

  it("records Pi cancellation without claiming a commit", async () => {
    const { handler } = registeredHandler();
    const context = createContext(["old-leaf", "old-leaf"], { cancelled: true });

    await handler(encodeRequest({ requestId: "request-3", targetId: "target-entry" }), context);

    await expect(readResult("request-3")).resolves.toEqual({
      version: 1,
      requestId: "request-3",
      status: "cancelled",
      leafId: "old-leaf",
    });
  });

  it("rejects malformed payloads, wrong tokens, and caller-provided output paths", async () => {
    const { handler } = registeredHandler();
    const context = createContext(["old-leaf"]);

    await expect(handler("not+base64", context)).rejects.toThrow("request encoding");
    await expect(
      handler(encodeRequest({ requestId: "request-4", targetId: "target-entry", token: "wrong" }), context),
    ).rejects.toThrow("token");
    await expect(
      handler(
        encodeRequest({ requestId: "request-5", targetId: "target-entry", resultPath: "elsewhere.json" }),
        context,
      ),
    ).rejects.toThrow("request fields");
    expect(context.navigateTree).not.toHaveBeenCalled();
  });

  it("records whether a thrown navigation changed Pi's leaf", async () => {
    const failed = registeredHandler();
    const failedContext = createContext(["old-leaf", "old-leaf"], new Error("summary failed"));
    await expect(
      failed.handler(encodeRequest({ requestId: "request-6", targetId: "target-entry" }), failedContext),
    ).rejects.toThrow("summary failed");
    await expect(readResult("request-6")).resolves.toMatchObject({ status: "failed", leafId: "old-leaf" });

    const committed = registeredHandler();
    const committedContext = createContext(["old-leaf", "new-leaf"], new Error("post-commit hook failed"));
    await expect(
      committed.handler(encodeRequest({ requestId: "request-7", targetId: "target-entry" }), committedContext),
    ).rejects.toThrow("post-commit hook failed");
    await expect(readResult("request-7")).resolves.toMatchObject({ status: "committed", leafId: "new-leaf" });
  });
});

function registeredHandler(): { handler: Handler; commandName: string; description: string } {
  let handler: Handler | undefined;
  let commandName: string | undefined;
  let description: string | undefined;
  sessionTreeExtension({
    registerCommand: (name, options) => {
      commandName = name;
      description = options.description;
      handler = (args, context) => options.handler(args, context);
    },
  });
  if (!handler || !commandName || !description) throw new Error("Session-tree command was not registered");
  return { handler, commandName, description };
}

function createContext(
  leafIds: string[],
  navigation: { cancelled: boolean } | Error = { cancelled: false },
): CommandContext {
  let leafIndex = 0;
  return {
    waitForIdle: vi.fn().mockResolvedValue(undefined),
    navigateTree:
      navigation instanceof Error
        ? vi.fn().mockRejectedValue(navigation)
        : vi.fn().mockResolvedValue(navigation),
    sessionManager: {
      getLeafId: () => leafIds[Math.min(leafIndex++, leafIds.length - 1)] ?? null,
    },
  };
}

function encodeRequest(overrides: Record<string, unknown>): string {
  return Buffer.from(
    JSON.stringify({ token: "runtime-token", requestId: "request", targetId: "target", ...overrides }),
    "utf8",
  ).toString("base64url");
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "frostpi-session-tree-extension-"));
  directories.push(directory);
  return directory;
}

function resultPath(requestId: string): string {
  return join(process.env[SESSION_TREE_RESULT_DIR_ENV]!, `${requestId}.json`);
}

async function readResult(requestId: string): Promise<unknown> {
  return JSON.parse(await readFile(resultPath(requestId), "utf8"));
}
