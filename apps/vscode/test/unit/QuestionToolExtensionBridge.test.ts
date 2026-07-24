import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { QuestionToolExtensionBridge } from "../../src/extension/question-tool/QuestionToolExtensionBridge.js";
import {
  encodeQuestionToolMarker,
  MAX_QUESTION_REQUEST_BYTES,
  QUESTION_TOOL_REQUEST_DIR_ENV,
  QUESTION_TOOL_TOKEN_ENV,
} from "../../src/shared/question-tool/questionToolProtocol.js";

const requestId = "123e4567-e89b-42d3-a456-426614174000";
const bridges: QuestionToolExtensionBridge[] = [];

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.dispose()));
});

describe("FrostPi Question extension bridge", () => {
  it("accepts only requests authenticated for its runtime and removes runtime files on dispose", async () => {
    const bridge = new QuestionToolExtensionBridge("dist/pi-extensions/question-tool.js");
    bridges.push(bridge);
    await bridge.prepare();
    const environment = bridge.launchEnvironment();
    const token = environment[QUESTION_TOOL_TOKEN_ENV]!;
    const directory = environment[QUESTION_TOOL_REQUEST_DIR_ENV]!;
    await writeFile(join(directory, `${requestId}.json`), JSON.stringify({
      version: 1,
      token,
      requestId,
      questions: [{ id: "scope", label: "Scope", prompt: "Choose scope", options: [] }],
    }));

    const pending = await bridge.resolve({
      type: "extension_ui_request",
      id: "rpc-request",
      method: "input",
      title: encodeQuestionToolMarker(token, requestId),
    });
    expect(pending).toMatchObject({
      id: "rpc-request",
      method: "question",
      requestId,
      title: "Scope",
      questions: [{ id: "scope", prompt: "Choose scope" }],
    });

    await expect(bridge.resolve({
      type: "extension_ui_request",
      id: "spoofed-request",
      method: "input",
      title: encodeQuestionToolMarker("x".repeat(43), requestId),
    })).rejects.toThrow(/Invalid FrostPi Question request marker/);

    await bridge.dispose();
    expect(() => bridge.launchEnvironment()).toThrow(/not prepared/);
    await expect(access(directory)).rejects.toThrow();
  });

  it("rejects oversized request files before parsing them", async () => {
    const bridge = new QuestionToolExtensionBridge("dist/pi-extensions/question-tool.js");
    bridges.push(bridge);
    await bridge.prepare();
    const environment = bridge.launchEnvironment();
    const token = environment[QUESTION_TOOL_TOKEN_ENV]!;
    const directory = environment[QUESTION_TOOL_REQUEST_DIR_ENV]!;
    await writeFile(join(directory, `${requestId}.json`), "x".repeat(MAX_QUESTION_REQUEST_BYTES + 1));

    await expect(bridge.resolve({
      type: "extension_ui_request",
      id: "oversized-request",
      method: "input",
      title: encodeQuestionToolMarker(token, requestId),
    })).rejects.toThrow(/Invalid FrostPi Question request file/);
  });
});
