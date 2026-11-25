import type { RpcExtensionUiRequest } from "@frostime/pi-rpc";

import type { AgentTurnView } from "../../shared/model/conversationModel.js";
import type { QuestionSelectView } from "../../shared/model/extensionUiModel.js";
import { isRecord } from "../conversation/messageAssembler.js";
import { sanitizeExtensionUiText } from "./sanitizeExtensionUiText.js";

const recommendation = " (Recommended)";

/** Deferred questions can be restored before their original tool entry is loaded. */
export function projectDeferredQuestionSelect(title?: string, options?: readonly string[]): QuestionSelectView | undefined {
  if (!title || !options || options.length < 3) return;
  const [heading, ...preview] = title.split("\n\n--- ");
  const match = /^\[([^\]\n]+)\] (.+)$/s.exec(heading ?? "");
  const custom = options.at(-1);
  const customPrefix = `${options.length}. `;
  if (!custom?.startsWith(customPrefix)) return;
  const choices: QuestionSelectView["choices"] = [];
  for (const [index, option] of options.slice(0, -1).entries()) {
    const prefix = `${index + 1}. `;
    const divider = option.indexOf(" — ", prefix.length);
    if (!option.startsWith(prefix) || divider < 0) return;
    const label = option.slice(prefix.length, divider);
    const recommended = index === 0 && label.endsWith(recommendation);
    choices.push({ label: sanitizeExtensionUiText(recommended ? label.slice(0, -recommendation.length) : label),
      description: sanitizeExtensionUiText(option.slice(divider + 3)), recommended });
  }
  return { question: sanitizeExtensionUiText(match?.[2] ?? heading ?? title), header: sanitizeExtensionUiText(match?.[1] ?? ""),
    details: sanitizeExtensionUiText(preview.map(block => `--- ${block}`).join("\n\n")), choices,
    customLabel: sanitizeExtensionUiText(custom.slice(customPrefix.length)) };
}

// RPIV offers string choices in RPC mode. Use the running tool's structured
// arguments for presentation only when its title and answer values match.
export function matchQuestionSelect(request: RpcExtensionUiRequest, turns: readonly AgentTurnView[]): QuestionSelectView | undefined {
  const { title, options } = request;
  if (request.method !== "select" || !title || !options?.length) return;
  let match: QuestionSelectView | undefined;
  for (const turn of turns) {
    if (turn.status !== "running") continue;
    for (const item of turn.items) {
      if (item.type !== "tool" || item.tool.state !== "bound" || item.tool.status !== "running"
        || item.tool.name !== "ask_user_question" || !Array.isArray(item.tool.args.questions)) continue;
      for (const question of item.tool.args.questions) {
        const view = matchQuestion(title, options, question);
        if (!view) continue;
        if (match) return;
        match = view;
      }
    }
  }
  return match;
}

function matchQuestion(title: string, options: readonly string[], question: unknown): QuestionSelectView | undefined {
  if (!isRecord(question) || typeof question.question !== "string" || question.multiSelect === true
    || !Array.isArray(question.options) || question.options.length + 1 !== options.length) return;
  const header = typeof question.header === "string" ? normalize(question.header) : "";
  const prompt = normalize(question.question);
  const prefix = header ? `[${header}] ${prompt}` : prompt;
  if (title !== prefix && !title.startsWith(prefix + "\n\n--- ")) return;

  const choices: QuestionSelectView["choices"] = [];
  for (const [index, option] of question.options.entries()) {
    if (!isRecord(option) || typeof option.label !== "string" || typeof option.description !== "string") return;
    const label = normalize(option.label);
    const description = normalize(option.description);
    if (options[index] !== `${index + 1}. ${label} — ${description}`) return;
    const recommended = index === 0 && label.endsWith(recommendation);
    choices.push({
      label: sanitizeExtensionUiText(recommended ? label.slice(0, -recommendation.length) : label),
      description: sanitizeExtensionUiText(description),
      recommended,
    });
  }
  const customPrefix = `${options.length}. `;
  const custom = options.at(-1);
  if (!custom?.startsWith(customPrefix)) return;
  return { question: sanitizeExtensionUiText(prompt), header: sanitizeExtensionUiText(header),
    details: sanitizeExtensionUiText(title.slice(prefix.length).trimStart()), choices,
    customLabel: sanitizeExtensionUiText(custom.slice(customPrefix.length)) };
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "");
}
