import type { RpcCommandDescriptor, RpcEvent, RpcSessionEntry } from "@frostime/pi-rpc";

import { commandName } from "./normalizePiSlashPrompt.js";

export type OmpSubmissionTarget = { turnId: string } | { queuedId: string };

export interface OmpPromptResult {
  target: OmpSubmissionTarget;
  agentInvoked: boolean;
  status: "completed" | "aborted" | "error";
  sessionSettled: boolean;
  error?: string;
}

/** Product semantics that cannot be reduced to an OMP wire-name translation. */
export class OmpPromptCompatibility {
  readonly #submissions = new Map<string, OmpSubmissionTarget>();

  assertSupported(message: string, imageCount: number, commands: readonly RpcCommandDescriptor[]): void {
    const name = commandName(message);
    if (!name) return;
    const command = commands.find((candidate) => candidate.name === name);
    if (!command || (command.source !== "prompt" && command.source !== "skill")) {
      throw new Error("This OMP slash command is not supported. Only discovered Markdown commands and skills are available.");
    }
    if (command.source === "skill" && imageCount > 0) {
      throw new Error("OMP skill commands do not support image attachments. Send the images in a separate message.");
    }
  }

  track(requestId: string, target: OmpSubmissionTarget): void {
    this.#submissions.set(requestId, target);
  }

  forget(requestId: string): void {
    this.#submissions.delete(requestId);
  }

  clearSubmissions(): void {
    this.#submissions.clear();
  }

  takeResult(event: RpcEvent): OmpPromptResult | undefined {
    if (event.type !== "prompt_result" || typeof event.id !== "string") return undefined;
    const target = this.#submissions.get(event.id);
    if (!target || typeof event.agentInvoked !== "boolean"
      || (event.status !== "completed" && event.status !== "aborted" && event.status !== "error")) return undefined;
    this.#submissions.delete(event.id);
    const error = isRecord(event.error) && typeof event.error.message === "string" ? event.error.message : undefined;
    return {
      target,
      agentInvoked: event.agentInvoked,
      status: event.status,
      sessionSettled: event.sessionSettled === true,
      ...(error ? { error } : {}),
    };
  }

  projectEvent(event: RpcEvent): RpcEvent {
    if (event.type === "entry_appended" && isRecord(event.entry) && event.entry.type === "custom_message") {
      const invocation = skillInvocation(event.entry);
      if (invocation === undefined) return event;
      return {
        ...event,
        entry: { ...event.entry, type: "message", message: { role: "user", content: [{ type: "text", text: invocation }] } },
      };
    }
    if (event.type !== "message_start" && event.type !== "message_end") return event;
    const message = event.message;
    if (!isRecord(message) || message.role !== "custom") return event;
    const invocation = skillInvocation(message);
    if (invocation === undefined) return event;
    return { ...event, message: { ...message, role: "user", content: [{ type: "text", text: invocation }] } };
  }

  projectEntries(entries: readonly RpcSessionEntry[]): readonly RpcSessionEntry[] {
    return entries.map((entry) => this.projectEntry(entry));
  }

  projectEntry(entry: RpcSessionEntry): RpcSessionEntry {
    if (entry.type !== "custom_message") return entry;
    const invocation = skillInvocation(entry);
    if (invocation === undefined) return entry;
    // This is a presentation projection only. SessionEntryState keeps the original
    // custom entry, parent chain, and id; OMP remains the persistence authority.
    return { ...entry, type: "message", message: { role: "user", content: [{ type: "text", text: invocation }] } };
  }
}

function skillInvocation(message: Record<string, unknown>): string | undefined {
  if (message.customType !== "skill-prompt" || message.attribution !== "user" || !isRecord(message.details)) return undefined;
  if (typeof message.details.prompt === "string" && message.details.prompt.trim()) return message.details.prompt;
  // Older skill entries may omit the original draft but retain the invocation fields.
  const name = message.details.name;
  if (typeof name !== "string" || !name || /\s/u.test(name)) return undefined;
  const args = typeof message.details.args === "string" ? message.details.args : "";
  return `/skill:${name}${args ? ` ${args}` : ""}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
