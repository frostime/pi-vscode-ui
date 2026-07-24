import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import questionTool from "../../pi-extensions/question-tool.js";
import {
  decodeQuestionToolMarker,
  parseQuestionRequestFile,
  QUESTION_TOOL_REQUEST_DIR_ENV,
  QUESTION_TOOL_TOKEN_ENV,
} from "../../src/shared/question-tool/questionToolProtocol.js";

type RegisteredTool = {
  execute(
    toolCallId: string,
    params: { questions: Array<{ id: string; prompt: string; options: Array<{ value: string; label: string }> }> },
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    context: { ui: { input(title: string, placeholder?: string, options?: { signal?: AbortSignal }): Promise<string | undefined> } },
  ): Promise<{ content: Array<{ type: string; text: string }>; details: { cancelled: boolean; answers: unknown[] } }>;
};

const originalRequestDirectory = process.env[QUESTION_TOOL_REQUEST_DIR_ENV];
const originalToken = process.env[QUESTION_TOOL_TOKEN_ENV];
const createdDirectories: string[] = [];

afterEach(async () => {
  setEnvironment(QUESTION_TOOL_REQUEST_DIR_ENV, originalRequestDirectory);
  setEnvironment(QUESTION_TOOL_TOKEN_ENV, originalToken);
  await Promise.all(createdDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("bundled Pi question tool", () => {
  it("publishes the request before waiting and returns the submitted answer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "frostpi-question-extension-test-"));
    createdDirectories.push(directory);
    const token = "b".repeat(43);
    process.env[QUESTION_TOOL_REQUEST_DIR_ENV] = directory;
    process.env[QUESTION_TOOL_TOKEN_ENV] = token;
    let registered: RegisteredTool | undefined;
    questionTool({ registerTool: (tool: unknown) => { registered = tool as RegisteredTool; } });

    let requestId = "";
    const result = await registered!.execute("tool-1", {
      questions: [{ id: "scope", prompt: "Choose scope", options: [{ value: "local", label: "Local" }] }],
    }, undefined, undefined, {
      ui: {
        input: async (title) => {
          const marker = decodeQuestionToolMarker(title)!;
          requestId = marker.requestId;
          const request = parseQuestionRequestFile(JSON.parse(await readFile(join(directory, `${marker.requestId}.json`), "utf8")));
          expect(request.questions[0]).toMatchObject({ id: "scope", label: "Q1", prompt: "Choose scope" });
          return JSON.stringify({
            version: 1,
            requestId: marker.requestId,
            answers: [{ id: "scope", value: "local", label: "Local", wasCustom: false, index: 1 }],
          });
        },
      },
    });

    expect(result.details).toMatchObject({ cancelled: false, answers: [{ id: "scope", value: "local" }] });
    expect(result.content[0]?.text).toBe("Q1: user selected: 1. Local");
    await expect(access(join(directory, `${requestId}.json`))).rejects.toThrow();
  });

  it("resolves an undefined UI response as cancellation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "frostpi-question-extension-test-"));
    createdDirectories.push(directory);
    process.env[QUESTION_TOOL_REQUEST_DIR_ENV] = directory;
    process.env[QUESTION_TOOL_TOKEN_ENV] = "c".repeat(43);
    let registered: RegisteredTool | undefined;
    questionTool({ registerTool: (tool: unknown) => { registered = tool as RegisteredTool; } });
    const result = await registered!.execute("tool-2", {
      questions: [{ id: "scope", prompt: "Choose scope", options: [] }],
    }, undefined, undefined, { ui: { input: () => Promise.resolve(undefined) } });
    expect(result.details).toMatchObject({ cancelled: true, answers: [] });
  });
});

function setEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
