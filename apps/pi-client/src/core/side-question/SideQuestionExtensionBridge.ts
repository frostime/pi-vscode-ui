import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, normalize, resolve } from "node:path";

import type { PiRpcApi, RpcCommandDescriptor } from "@frostime/pi-rpc";

const SIDE_QUESTION_COMMAND = "frostpi.side-question";
const SIDE_QUESTION_TOKEN_ENV = "FROSTPI_SIDE_QUESTION_TOKEN";
const SIDE_QUESTION_RESULT_DIR_ENV = "FROSTPI_SIDE_QUESTION_RESULT_DIR";

export const MAX_SIDE_QUESTION_LENGTH = 16_000;
const MAX_ANSWER_LENGTH = 200_000;
/** Answer bound plus JSON escaping and the small fixed fields. */
const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const MAX_ERROR_LENGTH = 2_000;

export interface SideQuestionAnswer {
  answer: string;
  truncated: boolean;
  /** The model stopped at its output limit, or tried to call a tool beside its text. */
  incomplete?: "length" | "tool-call";
  model?: string;
  usage?: { input: number; output: number; cacheRead: number };
}

/**
 * Host side of the bundled side-question adapter. The adapter runs inside Pi, so the
 * model call uses Pi's own model and credentials and FrostPi stores neither. The
 * question travels in a private command; the answer comes back through an owner-only
 * directory and is deleted once read.
 */
export class SideQuestionExtensionBridge {
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

  /**
   * Called before each process launch. What an earlier process loaded proves nothing
   * about this one, and a private command sent to a Pi without the adapter would be
   * read as a prompt, so the command must be discovered again.
   */
  async prepare(): Promise<void> {
    this.#commandName = null;
    this.#resultDirectory ??= await mkdtemp(join(tmpdir(), "frostpi-side-question-"));
  }

  launchArguments(): string[] {
    return ["-e", this.#artifactPath];
  }

  launchEnvironment(): NodeJS.ProcessEnv {
    if (!this.#resultDirectory) throw new Error("Side-question extension bridge is not prepared");
    return {
      [SIDE_QUESTION_TOKEN_ENV]: this.#token,
      [SIDE_QUESTION_RESULT_DIR_ENV]: this.#resultDirectory,
    };
  }

  /** Records the adapter's command and hides it from the user-visible command list. */
  discover(commands: readonly RpcCommandDescriptor[]): RpcCommandDescriptor[] {
    const bundledCommands = commands.filter((command) => this.#matchesSource(command.sourceInfo?.path));
    this.#commandName = bundledCommands.find((command) => command.name === SIDE_QUESTION_COMMAND)?.name
      ?? bundledCommands[0]?.name
      ?? null;
    return commands.filter((command) => !bundledCommands.includes(command));
  }

  async ask(api: PiRpcApi, question: string): Promise<SideQuestionAnswer> {
    if (!this.#commandName || !this.#resultDirectory) {
      throw new Error("Side questions are unavailable in this Pi process. Update Pi, restart the session, and check FrostPi diagnostics.");
    }
    const requestId = randomUUID();
    const encoded = Buffer.from(JSON.stringify({ token: this.#token, requestId, question }), "utf8").toString("base64url");
    let commandError: unknown;
    try {
      await api.executeExtensionCommand(this.#commandName, encoded);
    } catch (error) {
      commandError = error;
    }

    const result = await this.#takeResult(requestId).catch((error: unknown) => {
      if (commandError) throw asError(commandError);
      // The adapter writes a result for every request it accepts.
      throw isMissingFile(error) ? new Error("Pi did not return an answer to the side question.") : asError(error);
    });
    if (result.status === "failed") throw new Error(result.error);
    return result.answer;
  }

  async dispose(): Promise<void> {
    const directory = this.#resultDirectory;
    this.#resultDirectory = null;
    this.#commandName = null;
    if (directory) await rm(directory, { recursive: true, force: true });
  }

  async #takeResult(requestId: string): Promise<{ status: "answered"; answer: SideQuestionAnswer } | { status: "failed"; error: string }> {
    const path = join(this.#resultDirectory!, `${requestId}.json`);
    try {
      if ((await stat(path)).size > MAX_RESULT_BYTES) throw new Error("Invalid side-question extension result size");
      const value: unknown = JSON.parse(await readFile(path, "utf8"));
      if (!isRecord(value) || value.version !== 1 || value.requestId !== requestId) {
        throw new Error("Invalid side-question extension result");
      }
      if (value.status === "failed" && typeof value.error === "string") {
        return { status: "failed", error: value.error.slice(0, MAX_ERROR_LENGTH) || "The side question failed." };
      }
      if (value.status !== "answered" || typeof value.answer !== "string" || !value.answer) {
        throw new Error("Invalid side-question extension result");
      }
      const usage = usageView(value.usage);
      return {
        status: "answered",
        answer: {
          answer: value.answer.slice(0, MAX_ANSWER_LENGTH),
          truncated: value.truncated === true || value.answer.length > MAX_ANSWER_LENGTH,
          ...(value.incomplete === "length" || value.incomplete === "tool-call" ? { incomplete: value.incomplete } : {}),
          ...(typeof value.model === "string" && value.model ? { model: value.model.slice(0, 256) } : {}),
          ...(usage ? { usage } : {}),
        },
      };
    } finally {
      // The answer quotes the conversation; it must not outlive its delivery.
      await rm(path, { force: true }).catch(() => undefined);
    }
  }

  #matchesSource(sourcePath: string | undefined): boolean {
    if (!sourcePath) return false;
    const expected = comparablePath(this.#artifactPath);
    const actual = comparablePath(sourcePath);
    return actual === expected
      || (basename(actual) === basename(expected) && comparablePath(dirname(actual)) === comparablePath(dirname(expected)));
  }
}

function usageView(value: unknown): SideQuestionAnswer["usage"] {
  if (!isRecord(value)) return undefined;
  const count = (field: unknown): number => typeof field === "number" && Number.isFinite(field) && field > 0 ? Math.round(field) : 0;
  return { input: count(value.input), output: count(value.output), cacheRead: count(value.cacheRead) };
}

function comparablePath(path: string): string {
  const value = normalize(resolve(path));
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
