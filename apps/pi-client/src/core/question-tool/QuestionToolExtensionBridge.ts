import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import type { RpcExtensionUiRequest } from "@frostime/pi-rpc";

import type { PendingQuestionUiView } from "../../shared/model/extensionUiModel.js";
import {
  decodeQuestionToolMarker,
  MAX_QUESTION_REQUEST_BYTES,
  MAX_QUESTION_RESPONSE_BYTES,
  QUESTION_TOOL_PROTOCOL_VERSION,
  QUESTION_TOOL_REQUEST_DIR_ENV,
  QUESTION_TOOL_TOKEN_ENV,
  parseQuestionRequestFile,
  parseQuestionToolResponse,
  validateCompleteQuestionSubmission,
  type QuestionDraftSubmission,
} from "../../shared/question-tool/questionToolProtocol.js";

export class QuestionToolExtensionBridge {
  readonly #artifactPath: string;
  readonly #token = randomBytes(32).toString("base64url");
  #requestDirectory: string | null = null;

  constructor(artifactPath: string) {
    this.#artifactPath = resolve(artifactPath);
  }

  async prepare(): Promise<void> {
    this.#requestDirectory ??= await mkdtemp(join(tmpdir(), "frostpi-question-tool-"));
  }

  launchArguments(): string[] {
    return ["-e", this.#artifactPath];
  }

  launchEnvironment(): NodeJS.ProcessEnv {
    if (!this.#requestDirectory) throw new Error("Question tool bridge is not prepared");
    return {
      [QUESTION_TOOL_TOKEN_ENV]: this.#token,
      [QUESTION_TOOL_REQUEST_DIR_ENV]: this.#requestDirectory,
    };
  }

  recognizes(request: RpcExtensionUiRequest): boolean {
    return request.method === "input" && request.title?.startsWith("FROSTPI_QUESTION:") === true;
  }

  async resolve(request: RpcExtensionUiRequest): Promise<PendingQuestionUiView> {
    if (!this.#requestDirectory) throw new Error("Question tool bridge is not prepared");
    const marker = decodeQuestionToolMarker(request.title);
    if (!marker || marker.token !== this.#token) throw new Error("Invalid FrostPi Question request marker");

    const requestPath = this.#requestPath(marker.requestId);
    const info = await stat(requestPath);
    if (!info.isFile() || info.size > MAX_QUESTION_REQUEST_BYTES) throw new Error("Invalid FrostPi Question request file");
    const body = await readFile(requestPath, "utf8");
    if (Buffer.byteLength(body, "utf8") > MAX_QUESTION_REQUEST_BYTES) throw new Error("FrostPi Question request is too large");
    const value = parseQuestionRequestFile(JSON.parse(body));
    if (value.token !== marker.token || value.requestId !== marker.requestId) {
      throw new Error("FrostPi Question request identity does not match its marker");
    }
    return {
      id: request.id,
      method: "question",
      title: value.questions.length === 1 ? value.questions[0]!.label : `${value.questions.length} questions`,
      requestId: value.requestId,
      questions: value.questions,
      receivedAt: Date.now(),
    };
  }

  responseValue(request: PendingQuestionUiView, submission: QuestionDraftSubmission): string {
    const response = parseQuestionToolResponse({
      version: QUESTION_TOOL_PROTOCOL_VERSION,
      requestId: request.requestId,
      ...submission,
    });
    validateCompleteQuestionSubmission({ requestId: request.requestId, questions: request.questions }, response);
    const value = JSON.stringify(response);
    if (Buffer.byteLength(value, "utf8") > MAX_QUESTION_RESPONSE_BYTES) throw new Error("FrostPi Question response is too large");
    return value;
  }

  async dispose(): Promise<void> {
    const directory = this.#requestDirectory;
    this.#requestDirectory = null;
    if (directory) await rm(directory, { recursive: true, force: true });
  }

  #requestPath(requestId: string): string {
    const directory = resolve(this.#requestDirectory!);
    const path = resolve(directory, `${requestId}.json`);
    if (dirname(path) !== directory || basename(path) !== `${requestId}.json`) throw new Error("Invalid FrostPi Question request path");
    return path;
  }
}
