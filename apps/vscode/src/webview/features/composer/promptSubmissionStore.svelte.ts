import { writable } from "svelte/store";

export interface PromptSubmissionResult {
  requestId: string;
  ok: boolean;
  error?: string;
}

export const promptSubmissionResult = writable<PromptSubmissionResult | null>(null);
