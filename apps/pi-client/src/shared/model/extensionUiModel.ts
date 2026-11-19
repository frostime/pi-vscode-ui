import type { QuestionItem } from "../question-tool/questionToolProtocol.js";

export type StandardExtensionUiRequestKind = "select" | "confirm" | "input" | "editor";

export interface QuestionSelectView {
  question: string;
  header: string;
  details: string;
  choices: { label: string; description: string; recommended: boolean }[];
  customLabel: string;
}

export interface PendingStandardExtensionUiView {
  id: string;
  method: StandardExtensionUiRequestKind;
  title: string;
  message?: string;
  options?: string[];
  questionSelect?: QuestionSelectView;
  placeholder?: string;
  prefill?: string;
  receivedAt: number;
}

export interface PendingQuestionUiView {
  id: string;
  method: "question";
  title: string;
  requestId: string;
  questions: QuestionItem[];
  receivedAt: number;
}

export type PendingExtensionUiView = PendingStandardExtensionUiView | PendingQuestionUiView;

export interface ExtensionStatusView {
  key: string;
  text: string;
}

export interface ExtensionWidgetView {
  key: string;
  lines: string[];
  placement: "above" | "below";
}
