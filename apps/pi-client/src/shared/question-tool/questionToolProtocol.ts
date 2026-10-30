export const QUESTION_TOOL_PROTOCOL_VERSION = 1 as const;
export const QUESTION_TOOL_MARKER_PREFIX = "FROSTPI_QUESTION";
export const QUESTION_TOOL_TOKEN_ENV = "FROSTPI_QUESTION_TOKEN";
export const QUESTION_TOOL_REQUEST_DIR_ENV = "FROSTPI_QUESTION_REQUEST_DIR";
export const MAX_QUESTION_REQUEST_BYTES = 256 * 1024;
export const MAX_QUESTION_RESPONSE_BYTES = 256 * 1024;
export const MAX_QUESTION_COUNT = 8;
export const MAX_QUESTION_OPTIONS = 12;

export interface QuestionOption {
  value: string;
  label: string;
  description?: string;
}

export interface QuestionItem {
  id: string;
  label: string;
  prompt: string;
  options: QuestionOption[];
}

export interface QuestionRequestFile {
  version: typeof QUESTION_TOOL_PROTOCOL_VERSION;
  token: string;
  requestId: string;
  questions: QuestionItem[];
}

export interface QuestionAnswer {
  id: string;
  value: string;
  label: string;
  wasCustom: boolean;
  index?: number | undefined;
}

export interface QuestionDraftSubmission {
  answers: QuestionAnswer[];
  extraNote?: string | undefined;
}

export interface QuestionToolResponse extends QuestionDraftSubmission {
  version: typeof QUESTION_TOOL_PROTOCOL_VERSION;
  requestId: string;
}

export function encodeQuestionToolMarker(token: string, requestId: string): string {
  if (!validToken(token) || !validRequestId(requestId)) throw new Error("Invalid FrostPi Question marker identity");
  return `${QUESTION_TOOL_MARKER_PREFIX}:${QUESTION_TOOL_PROTOCOL_VERSION}:${token}:${requestId}`;
}

export function decodeQuestionToolMarker(value: string | undefined): { token: string; requestId: string } | null {
  if (!value) return null;
  const [prefix, version, token, requestId, extra] = value.split(":");
  if (extra !== undefined || prefix !== QUESTION_TOOL_MARKER_PREFIX || version !== String(QUESTION_TOOL_PROTOCOL_VERSION)) return null;
  if (!token || !requestId || !validToken(token) || !validRequestId(requestId)) return null;
  return { token, requestId };
}

export function parseQuestionRequestFile(value: unknown): QuestionRequestFile {
  const request = requireRecord(value, "Question request");
  if (request.version !== QUESTION_TOOL_PROTOCOL_VERSION) throw new Error("Unsupported Question request version");
  if (!validToken(request.token)) throw new Error("Invalid Question request token");
  if (!validRequestId(request.requestId)) throw new Error("Invalid Question request id");
  if (!Array.isArray(request.questions) || request.questions.length < 1 || request.questions.length > MAX_QUESTION_COUNT) {
    throw new Error(`Question request must contain 1-${MAX_QUESTION_COUNT} questions`);
  }

  const ids = new Set<string>();
  const questions = request.questions.map((value, index) => {
    const question = requireRecord(value, `Question ${index + 1}`);
    const id = requireString(question.id, `Question ${index + 1} id`, 128, true);
    if (ids.has(id)) throw new Error("Question ids must be unique");
    ids.add(id);
    const label = requireString(question.label, `Question ${index + 1} label`, 256, true);
    const prompt = requireString(question.prompt, `Question ${index + 1} prompt`, 32_768, true);
    if (!Array.isArray(question.options) || question.options.length > MAX_QUESTION_OPTIONS) {
      throw new Error(`Question ${id} has too many options`);
    }
    const options = question.options.map((optionValue, optionIndex) => {
      const option = requireRecord(optionValue, `Question ${id} option ${optionIndex + 1}`);
      return {
        value: requireString(option.value, `Question ${id} option value`, 16_384),
        label: requireString(option.label, `Question ${id} option label`, 16_384, true),
        ...(option.description === undefined
          ? {}
          : { description: requireString(option.description, `Question ${id} option description`, 32_768) }),
      };
    });
    return { id, label, prompt, options };
  });

  return {
    version: QUESTION_TOOL_PROTOCOL_VERSION,
    token: request.token,
    requestId: request.requestId,
    questions,
  };
}

export function parseQuestionToolResponse(value: unknown): QuestionToolResponse {
  const response = requireRecord(value, "Question response");
  if (response.version !== QUESTION_TOOL_PROTOCOL_VERSION) throw new Error("Unsupported Question response version");
  if (!validRequestId(response.requestId)) throw new Error("Invalid Question response id");
  if (!Array.isArray(response.answers) || response.answers.length < 1 || response.answers.length > MAX_QUESTION_COUNT) {
    throw new Error("Invalid Question response answers");
  }
  const answers = response.answers.map((value, index) => {
    const answer = requireRecord(value, `Answer ${index + 1}`);
    if (typeof answer.wasCustom !== "boolean") throw new Error(`Answer ${index + 1} has an invalid custom flag`);
    if (answer.index !== undefined && (!Number.isInteger(answer.index) || Number(answer.index) < 1 || Number(answer.index) > MAX_QUESTION_OPTIONS)) {
      throw new Error(`Answer ${index + 1} has an invalid option index`);
    }
    return {
      id: requireString(answer.id, `Answer ${index + 1} id`, 128, true),
      value: requireString(answer.value, `Answer ${index + 1} value`, 32_768, true),
      label: requireString(answer.label, `Answer ${index + 1} label`, 32_768, true),
      wasCustom: answer.wasCustom,
      ...(answer.index === undefined ? {} : { index: Number(answer.index) }),
    };
  });
  return {
    version: QUESTION_TOOL_PROTOCOL_VERSION,
    requestId: response.requestId,
    answers,
    ...(response.extraNote === undefined
      ? {}
      : { extraNote: requireString(response.extraNote, "Question response note", 64 * 1024) }),
  };
}

export function validateCompleteQuestionSubmission(
  request: Pick<QuestionRequestFile, "requestId" | "questions">,
  submission: QuestionToolResponse,
): void {
  if (submission.requestId !== request.requestId) throw new Error("Question response request id does not match");
  const answers = new Map(submission.answers.map((answer) => [answer.id, answer]));
  if (answers.size !== submission.answers.length || answers.size !== request.questions.length) {
    throw new Error("Question response must contain exactly one answer per question");
  }

  for (const question of request.questions) {
    const answer = answers.get(question.id);
    if (!answer) throw new Error(`Question ${question.id} is unanswered`);
    if (answer.wasCustom) {
      if (answer.index !== undefined) throw new Error(`Custom answer ${question.id} must not include an option index`);
      continue;
    }
    if (answer.index === undefined) throw new Error(`Selected answer ${question.id} must include an option index`);
    const option = question.options[answer.index - 1];
    if (!option || option.value !== answer.value || option.label !== answer.label) {
      throw new Error(`Selected answer ${question.id} does not match its option`);
    }
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string, maximum: number, nonempty = false): string {
  if (typeof value !== "string" || value.length > maximum || (nonempty && value.length === 0)) {
    throw new Error(`${label} must be ${nonempty ? "a non-empty " : "a "}string no longer than ${maximum} characters`);
  }
  return value;
}

function validToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 32 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
}

function validRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
