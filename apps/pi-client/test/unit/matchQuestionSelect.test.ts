import type { RpcExtensionUiRequest } from "@frostime/pi-rpc";
import { expect, it } from "vitest";

import { matchQuestionSelect } from "../../src/core/extension-ui/matchQuestionSelect.js";
import type { AgentTurnView } from "../../src/shared/model/conversationModel.js";

const question = {
  header: "Deployment",
  question: "Where should I deploy the preview?",
  options: [
    { label: "Preview — internal (Recommended)", description: "Share with the team." },
    { label: "Local only", description: "Keep this (Recommended) text in the description." },
  ],
};
const request: RpcExtensionUiRequest = {
  type: "extension_ui_request", id: "select-1", method: "select",
  title: "[Deployment] Where should I deploy the preview?",
  options: [
    "1. Preview — internal (Recommended) — Share with the team.",
    "2. Local only — Keep this (Recommended) text in the description.",
    "3. Écrire votre réponse.",
  ],
};
function runningQuestion(name = "ask_user_question"): AgentTurnView {
  return {
    type: "turn", id: "turn", status: "running", startedAt: 1,
    items: [{ type: "tool", id: "activity", timestamp: 1, tool: {
      state: "bound", id: "call", name, label: name, status: "running", startedAt: 1,
      isError: false, args: { questions: [question] },
    } }],
  };
}

it("uses authored labels, descriptions and the first-option recommendation for a matching select", () => {
  expect(matchQuestionSelect(request, [runningQuestion()])).toEqual({
    question: question.question, header: question.header, details: "",
    customLabel: "Écrire votre réponse.",
    choices: [
      { label: "Preview — internal", description: "Share with the team.", recommended: true },
      { label: "Local only", description: question.options[1]?.description, recommended: false },
    ],
  });
});

it("leaves unrelated, changed or ambiguous choices opaque", () => {
  expect(matchQuestionSelect(request, [runningQuestion("other_tool")])).toBeUndefined();
  expect(matchQuestionSelect({ ...request, options: ["1. Different", "2. Local only", "3. Custom"] }, [runningQuestion()])).toBeUndefined();
  expect(matchQuestionSelect({ ...request, title: "Another question" }, [runningQuestion()])).toBeUndefined();
  expect(matchQuestionSelect(request, [runningQuestion(), runningQuestion()])).toBeUndefined();
});
