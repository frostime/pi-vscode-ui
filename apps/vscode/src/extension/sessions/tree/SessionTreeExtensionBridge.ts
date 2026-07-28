import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, normalize, resolve } from "node:path";

import type { PiRpcApi, RpcCommandDescriptor } from "@frostime/pi-rpc";

const SESSION_TREE_COMMAND = "frostpi.session-tree";
const SESSION_TREE_TOKEN_ENV = "FROSTPI_SESSION_TREE_TOKEN";
const SESSION_TREE_RESULT_DIR_ENV = "FROSTPI_SESSION_TREE_RESULT_DIR";

export type SessionTreeSummaryOptions =
  | { summarize: false }
  | { summarize: true; customInstructions?: string; replaceInstructions?: boolean };

export interface SessionTreeNavigationResult {
  status: "cancelled" | "committed" | "failed";
  leafId: string | null;
}

export class SessionTreeExtensionBridge {
  readonly #artifactPath: string;
  readonly #token = randomBytes(32).toString("base64url");
  #resultDirectory: string | null = null;
  #commandName: string | null = null;

  constructor(artifactPath: string) {
    this.#artifactPath = resolve(artifactPath);
  }

  get available(): boolean {
    return this.#commandName !== null;
  }

  get commandName(): string | null {
    return this.#commandName;
  }

  async prepare(): Promise<void> {
    this.#resultDirectory ??= await mkdtemp(join(tmpdir(), "frostpi-session-tree-"));
  }

  launchArguments(): string[] {
    return ["-e", this.#artifactPath];
  }

  launchEnvironment(): NodeJS.ProcessEnv {
    if (!this.#resultDirectory) throw new Error("Session-tree extension bridge is not prepared");
    return {
      [SESSION_TREE_TOKEN_ENV]: this.#token,
      [SESSION_TREE_RESULT_DIR_ENV]: this.#resultDirectory,
    };
  }

  discover(commands: readonly RpcCommandDescriptor[]): RpcCommandDescriptor[] {
    const bundledCommands = commands.filter((command) => this.#matchesSource(command.sourceInfo?.path));
    this.#commandName = bundledCommands.find((command) => command.name === SESSION_TREE_COMMAND)?.name
      ?? bundledCommands[0]?.name
      ?? null;
    return commands.filter((command) => !bundledCommands.includes(command));
  }

  async navigate(
    api: PiRpcApi,
    targetId: string,
    summary: SessionTreeSummaryOptions,
  ): Promise<SessionTreeNavigationResult> {
    if (!this.#commandName || !this.#resultDirectory) {
      throw new Error("Session tree navigation is unavailable in this Pi process. Update Pi, restart the session, and check FrostPi diagnostics.");
    }
    const requestId = randomUUID();
    const encoded = Buffer.from(JSON.stringify({ token: this.#token, requestId, targetId, ...summary }), "utf8").toString("base64url");
    let commandError: unknown;
    try {
      await api.executeExtensionCommand(this.#commandName, encoded);
    } catch (error) {
      commandError = error;
    }

    const result = await this.#readResult(requestId).catch((error: unknown) => {
      throw asError(commandError ?? error);
    });
    if (result.status === "failed") throw asError(commandError ?? new Error("Pi did not commit session tree navigation."));
    return result;
  }

  async dispose(): Promise<void> {
    const directory = this.#resultDirectory;
    this.#resultDirectory = null;
    this.#commandName = null;
    if (directory) await rm(directory, { recursive: true, force: true });
  }

  async #readResult(requestId: string): Promise<SessionTreeNavigationResult> {
    const path = join(this.#resultDirectory!, `${requestId}.json`);
    const body = await readFile(path, "utf8");
    if (Buffer.byteLength(body, "utf8") > 1_024) throw new Error("Invalid session-tree extension result size");
    const value: unknown = JSON.parse(body);
    if (!isRecord(value)
      || value.version !== 1
      || value.requestId !== requestId
      || !["cancelled", "committed", "failed"].includes(String(value.status))
      || (value.leafId !== null && typeof value.leafId !== "string")) {
      throw new Error("Invalid session-tree extension result");
    }
    return { status: value.status as SessionTreeNavigationResult["status"], leafId: value.leafId };
  }

  #matchesSource(sourcePath: string | undefined): boolean {
    if (!sourcePath) return false;
    const expected = comparablePath(this.#artifactPath);
    const actual = comparablePath(sourcePath);
    return actual === expected
      || (basename(actual) === basename(expected) && comparablePath(dirname(actual)) === comparablePath(dirname(expected)));
  }
}

function comparablePath(path: string): string {
  const value = normalize(resolve(path));
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
