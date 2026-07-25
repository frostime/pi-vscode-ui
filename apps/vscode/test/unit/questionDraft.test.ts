import { describe, expect, it } from "vitest";

import {
  createQuestionDraft,
  questionDraftComplete,
  questionSubmission,
  saveCustomQuestionAnswer,
  selectQuestionOption,
} from "../../src/webview/features/question-tool/questionDraft.js";
import type { QuestionItem } from "../../src/shared/question-tool/questionToolProtocol.js";

const questions: QuestionItem[] = [
  { id: "scope", label: "Scope", prompt: "Choose scope", options: [{ value: "local", label: "Local" }] },
  { id: "priority", label: "Priority", prompt: "Choose priority", options: [] },
];

describe("Question draft", () => {
  it("becomes submittable only after every answer is explicitly saved", () => {
    let draft = createQuestionDraft();
    draft = selectQuestionOption(draft, questions[0]!, questions[0]!.options[0]!, 0);
    expect(questionDraftComplete(draft, questions)).toBe(false);
    expect(() => questionSubmission(draft, questions)).toThrow(/Answer every question/);

    expect(saveCustomQuestionAnswer(draft, questions[1]!, "   ")).toBe(draft);
    draft = saveCustomQuestionAnswer(draft, questions[1]!, "  Blocker first  ");
    draft = { ...draft, extraNote: "  Preserve conversation context  " };

    expect(questionDraftComplete(draft, questions)).toBe(true);
    expect(questionSubmission(draft, questions)).toEqual({
      answers: [
        { id: "scope", value: "local", label: "Local", wasCustom: false, index: 1 },
        { id: "priority", value: "Blocker first", label: "Blocker first", wasCustom: true },
      ],
      extraNote: "Preserve conversation context",
    });
  });

  it("returns plain answers that VS Code can clone across the Webview boundary", () => {
    const selected = selectQuestionOption(createQuestionDraft(), questions[0]!, questions[0]!.options[0]!, 0);
    const answer = selected.answers.scope!;
    const draft = {
      ...selected,
      answers: { scope: new Proxy(answer, {}) },
    };

    expect(() => structuredClone(draft.answers.scope)).toThrow();
    expect(() => structuredClone(questionSubmission(draft, [questions[0]!]))).not.toThrow();
  });
});
