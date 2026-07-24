import type {
  QuestionAnswer,
  QuestionDraftSubmission,
  QuestionItem,
  QuestionOption,
} from "$shared/question-tool/questionToolProtocol";

export interface QuestionDraftState {
  answers: Record<string, QuestionAnswer>;
  extraNote: string;
}

export function createQuestionDraft(): QuestionDraftState {
  return { answers: {}, extraNote: "" };
}

export function selectQuestionOption(
  draft: QuestionDraftState,
  question: QuestionItem,
  option: QuestionOption,
  index: number,
): QuestionDraftState {
  return {
    ...draft,
    answers: {
      ...draft.answers,
      [question.id]: {
        id: question.id,
        value: option.value,
        label: option.label,
        wasCustom: false,
        index: index + 1,
      },
    },
  };
}

export function saveCustomQuestionAnswer(
  draft: QuestionDraftState,
  question: QuestionItem,
  value: string,
): QuestionDraftState {
  const answer = value.trim();
  if (!answer) return draft;
  return {
    ...draft,
    answers: {
      ...draft.answers,
      [question.id]: {
        id: question.id,
        value: answer,
        label: answer,
        wasCustom: true,
      },
    },
  };
}

export function questionDraftComplete(draft: QuestionDraftState, questions: readonly QuestionItem[]): boolean {
  return questions.every((question) => draft.answers[question.id] !== undefined);
}

export function questionSubmission(draft: QuestionDraftState, questions: readonly QuestionItem[]): QuestionDraftSubmission {
  if (!questionDraftComplete(draft, questions)) throw new Error("Answer every question before submitting.");
  const note = draft.extraNote.trim();
  return {
    answers: questions.map((question) => draft.answers[question.id]!),
    ...(note ? { extraNote: note } : {}),
  };
}
