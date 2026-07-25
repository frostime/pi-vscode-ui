import { describe, expect, it } from "vitest";

import {
  decodeQuestionToolMarker,
  encodeQuestionToolMarker,
  parseQuestionRequestFile,
  parseQuestionToolResponse,
  validateCompleteQuestionSubmission,
} from "../../src/shared/question-tool/questionToolProtocol.js";

const token = "a".repeat(43);
const requestId = "123e4567-e89b-42d3-a456-426614174000";

function request() {
  return parseQuestionRequestFile({
    version: 1,
    token,
    requestId,
    questions: [{
      id: "deployment scope",
      label: "Scope",
      prompt: "Where should this run?",
      options: [{ value: "local", label: "Local", description: "Current machine" }],
    }],
  });
}

describe("FrostPi Question private protocol", () => {
  it("round-trips an authenticated request marker", () => {
    expect(decodeQuestionToolMarker(encodeQuestionToolMarker(token, requestId))).toEqual({ token, requestId });
    expect(decodeQuestionToolMarker(`FROSTPI_QUESTION:2:${token}:${requestId}`)).toBeNull();
    expect(decodeQuestionToolMarker("ordinary input title")).toBeNull();
  });

  it("accepts display-oriented question ids but rejects duplicate identities", () => {
    expect(request().questions[0]?.id).toBe("deployment scope");
    expect(() => parseQuestionRequestFile({
      ...request(),
      questions: [request().questions[0], request().questions[0]],
    })).toThrow(/unique/);
  });

  it("requires exactly one valid answer for every question", () => {
    const source = request();
    const response = parseQuestionToolResponse({
      version: 1,
      requestId,
      answers: [{ id: "deployment scope", value: "local", label: "Local", wasCustom: false, index: 1 }],
      extraNote: "Use the existing runner",
    });
    expect(() => validateCompleteQuestionSubmission(source, response)).not.toThrow();

    expect(() => validateCompleteQuestionSubmission(source, { ...response, answers: [] })).toThrow(/exactly one answer/);
    expect(() => validateCompleteQuestionSubmission(source, {
      ...response,
      answers: [{ ...response.answers[0]!, value: "remote" }],
    })).toThrow(/does not match/);
  });
});
