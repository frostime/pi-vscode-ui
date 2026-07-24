import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  encodeQuestionToolMarker,
  MAX_QUESTION_RESPONSE_BYTES,
  QUESTION_TOOL_PROTOCOL_VERSION,
  QUESTION_TOOL_REQUEST_DIR_ENV,
  QUESTION_TOOL_TOKEN_ENV,
  parseQuestionRequestFile,
  parseQuestionToolResponse,
  validateCompleteQuestionSubmission,
  type QuestionAnswer,
  type QuestionItem,
  type QuestionRequestFile,
} from "../src/shared/question-tool/questionToolProtocol.js";

interface QuestionnaireParams {
  questions: Array<{
    id: string;
    label?: string;
    prompt: string;
    options: Array<{ value: string; label: string; description?: string }>;
  }>;
}

interface ToolContext {
  ui: {
    input(title: string, placeholder?: string, options?: { signal?: AbortSignal }): Promise<string | undefined>;
  };
}

interface ExtensionApi {
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    parameters: Record<string, unknown>;
    execute(
      toolCallId: string,
      params: QuestionnaireParams,
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      context: ToolContext,
    ): Promise<unknown>;
  }): void;
}

interface QuestionnaireResult {
  questions: QuestionItem[];
  answers: QuestionAnswer[];
  extraNote?: string;
  cancelled: boolean;
}

const QuestionnaireSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      description: "Questions to ask the user",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Unique identifier for this question" },
          label: { type: "string", description: "Short contextual label for tab bar, e.g. 'Scope', 'Priority' (defaults to Q1, Q2)" },
          prompt: { type: "string", description: "The full question text to display" },
          options: {
            type: "array",
            description: "Available options to choose from",
            items: {
              type: "object",
              properties: {
                value: { type: "string", description: "The value returned when selected" },
                label: { type: "string", description: "Display label for the option" },
                description: { type: "string", description: "Optional description shown below label" },
              },
              required: ["value", "label"],
              additionalProperties: false,
            },
          },
        },
        required: ["id", "prompt", "options"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
} as const;

export default function questionTool(pi: ExtensionApi) {
  const requestDirectory = process.env[QUESTION_TOOL_REQUEST_DIR_ENV];
  const token = process.env[QUESTION_TOOL_TOKEN_ENV];
  if (!requestDirectory || !token) return;

  pi.registerTool({
    name: "question",
    label: "Question",
    description: "Ask the user one or more questions. Use for clarifying requirements, getting preferences, or confirming decisions. For single questions, shows a simple option list. For multiple questions, shows a tab-based interface.",
    parameters: QuestionnaireSchema,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (params.questions.length === 0) return errorResult("Error: No questions provided");

      const requestId = randomUUID();
      const questions: QuestionItem[] = params.questions.map((question, index) => ({
        ...question,
        label: question.label?.trim() || `Q${index + 1}`,
      }));
      let request: QuestionRequestFile;
      try {
        request = parseQuestionRequestFile({
          version: QUESTION_TOOL_PROTOCOL_VERSION,
          token,
          requestId,
          questions,
        });
      } catch (error) {
        return errorResult(`Error: Invalid question request (${errorMessage(error)})`, questions);
      }

      const finalPath = join(requestDirectory, `${requestId}.json`);
      const temporaryPath = join(requestDirectory, `.${requestId}.${process.pid}.tmp`);
      try {
        await writeFile(temporaryPath, JSON.stringify(request), { encoding: "utf8", flag: "wx" });
        await rename(temporaryPath, finalPath);
        const value = await ctx.ui.input(
          encodeQuestionToolMarker(token, requestId),
          "Answer in FrostPi",
          signal ? { signal } : undefined,
        );
        if (value === undefined) return cancelledResult(questions);
        if (Buffer.byteLength(value, "utf8") > MAX_QUESTION_RESPONSE_BYTES) {
          return errorResult("Error: Question response is too large", questions);
        }

        const response = parseQuestionToolResponse(JSON.parse(value));
        validateCompleteQuestionSubmission(request, response);
        const result: QuestionnaireResult = {
          questions,
          answers: response.answers,
          ...(response.extraNote?.trim() ? { extraNote: response.extraNote.trim() } : {}),
          cancelled: false,
        };
        const answerLines = response.answers.map((answer) => {
          const label = questions.find((question) => question.id === answer.id)?.label ?? answer.id;
          return answer.wasCustom
            ? `${label}: user wrote: ${answer.label}`
            : `${label}: user selected: ${answer.index}. ${answer.label}`;
        });
        if (result.extraNote) answerLines.push(`Extra Note: ${result.extraNote}`);
        return { content: [{ type: "text" as const, text: answerLines.join("\n") }], details: result };
      } catch (error) {
        if (signal?.aborted) return cancelledResult(questions);
        return errorResult(`Error: Question UI failed (${errorMessage(error)})`, questions);
      } finally {
        await Promise.allSettled([
          rm(temporaryPath, { force: true }),
          rm(finalPath, { force: true }),
        ]);
      }
    },
  });
}

function cancelledResult(questions: QuestionItem[]) {
  return {
    content: [{ type: "text" as const, text: "User cancelled the questionnaire" }],
    details: { questions, answers: [], cancelled: true } satisfies QuestionnaireResult,
  };
}

function errorResult(message: string, questions: QuestionItem[] = []) {
  return {
    content: [{ type: "text" as const, text: message }],
    details: { questions, answers: [], cancelled: true } satisfies QuestionnaireResult,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
