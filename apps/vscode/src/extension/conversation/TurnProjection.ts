import type { RpcEvent } from "@frostime/pi-rpc";

import type {
  AgentActivityView,
  AgentTurnStatus,
  AgentTurnView,
  ResponseActivityView,
  SessionNoticeView,
  SessionNoticeLevel,
} from "../../shared/model/agentTurnModel.js";
import type { WebviewImageInput } from "../../shared/bridge/webviewToHost.js";
import type {
  BranchSummaryView,
  CompactionView,
  ConversationMessageView,
  CustomMessageView,
  ImageAttachmentView,
  MessageBlockView,
  MessageStatus,
  QueuedFollowUpView,
} from "../../shared/model/conversationModel.js";
import type { ToolCallView } from "../../shared/model/toolCallModel.js";
import { createToolView, extractText, isRecord, recordValue, stringValue } from "./messageAssembler.js";
import type { UserEntryReference } from "./userEntryReferences.js";

export interface TurnProjectionSnapshot {
  turns: AgentTurnView[];
  notices: SessionNoticeView[];
  compactions: CompactionView[];
  branchSummaries: BranchSummaryView[];
  customMessages: CustomMessageView[];
  queuedFollowUps: QueuedFollowUpView[];
}

interface ActivityLocation {
  turnId: string;
  activityId: string;
}

export class TurnProjection {
  #turns: AgentTurnView[] = [];
  #notices: SessionNoticeView[] = [];
  #compactions: CompactionView[] = [];
  #branchSummaries: BranchSummaryView[] = [];
  #customMessages: CustomMessageView[] = [];
  #queuedFollowUps: QueuedFollowUpView[] = [];
  #activeTurnId: string | null = null;
  #streamingMessageId: string | null = null;
  #sequence = 0;
  readonly #messageActivities = new Map<string, ActivityLocation[]>();
  readonly #toolActivities = new Map<string, ActivityLocation>();

  snapshot(): TurnProjectionSnapshot {
    return {
      turns: this.#turns,
      notices: this.#notices,
      compactions: this.#compactions,
      branchSummaries: this.#branchSummaries,
      customMessages: this.#customMessages,
      queuedFollowUps: this.#queuedFollowUps,
    };
  }

  hydrate(rawMessages: unknown[], userEntries: readonly UserEntryReference[] = []): void {
    this.#turns = [];
    this.#notices = [];
    this.#compactions = [];
    this.#branchSummaries = [];
    this.#customMessages = [];
    this.#queuedFollowUps = [];
    this.#activeTurnId = null;
    this.#streamingMessageId = null;
    this.#messageActivities.clear();
    this.#toolActivities.clear();

    const entryQueues = userEntryQueues(userEntries);

    let currentTurnId: string | null = null;
    let fallbackTimestamp = Date.now();
    for (const raw of rawMessages) {
      if (!isRecord(raw) || typeof raw.role !== "string") continue;
      const timestamp = typeof raw.timestamp === "number" ? raw.timestamp : fallbackTimestamp++;
      if (raw.role === "compactionSummary" && typeof raw.summary === "string" && typeof raw.tokensBefore === "number") {
        this.#appendCompaction(raw.summary, raw.tokensBefore, timestamp);
        currentTurnId = null;
        continue;
      }
      if (raw.role === "branchSummary" && typeof raw.summary === "string" && typeof raw.fromId === "string") {
        this.#branchSummaries = [...this.#branchSummaries, {
          id: `branch-summary-${timestamp}-${++this.#sequence}`,
          summary: raw.summary,
          fromId: raw.fromId,
          timestamp,
        }];
        currentTurnId = null;
        continue;
      }

      if (raw.role === "custom" && typeof raw.customType === "string" && raw.display === true) {
        const content = extractText(raw.content);
        if (content) {
          const message: CustomMessageView = {
            id: `custom-${timestamp}-${++this.#sequence}`,
            customType: raw.customType,
            content,
            display: true,
            timestamp,
          };
          if (isRecord(raw.details)) message.details = raw.details;
          this.#customMessages = [...this.#customMessages, message];
        }
        currentTurnId = null;
        continue;
      }

      if (raw.role === "user") {
        const entry = entryQueues.get(timestamp)?.shift();
        const message = createUserMessage(raw, timestamp, `history-user-${++this.#sequence}`, entry?.entryId);
        const turn: AgentTurnView = {
          id: `turn-${message.id}`,
          userMessage: message,
          activities: [],
          status: "completed",
          startedAt: timestamp,
        };
        this.#turns = [...this.#turns, turn];
        currentTurnId = turn.id;
        continue;
      }

      if (raw.role === "assistant") {
        const turnId: string = currentTurnId ?? this.#ensureTurn(timestamp).id;
        currentTurnId = turnId;
        const messageId = rawMessageId(raw, `history-assistant-${++this.#sequence}`);
        const status = assistantMessageStatus(raw.stopReason);
        const activities = activitiesFromAssistant(messageId, raw.content, raw.errorMessage, status, timestamp);
        this.#replaceMessageActivities(turnId, messageId, activities);
        this.#setTurnStatus(turnId, statusToTurnStatus(status), timestamp);
        continue;
      }

      if (raw.role === "toolResult" && typeof raw.toolCallId === "string") {
        const turnId: string = currentTurnId ?? this.#ensureTurn(timestamp).id;
        currentTurnId = turnId;
        this.#upsertTool(turnId, raw.toolCallId, {
          name: stringValue(raw.toolName, "tool"),
          args: {},
          status: raw.isError === true ? "error" : "complete",
          output: extractText(raw.content),
          isError: raw.isError === true,
          endedAt: timestamp,
          timestamp,
        });
        continue;
      }

      if (raw.role === "bashExecution") {
        const command = stringValue(raw.command, "command");
        const output = stringValue(raw.output, "");
        this.appendNotice(`Ran \`${command}\`${output ? `\n\n${output}` : ""}`, Number(raw.exitCode ?? 0) === 0 ? "info" : "error", timestamp);
      }
    }
  }

  attachUserEntryReferences(userEntries: readonly UserEntryReference[]): boolean {
    const assigned = new Set(this.#turns.flatMap((turn) => turn.userMessage?.sourceEntryId ? [turn.userMessage.sourceEntryId] : []));
    const entryQueues = userEntryQueues(userEntries.filter((entry) => !assigned.has(entry.entryId)));
    if (!entryQueues.size) return false;

    let changed = false;
    this.#turns = this.#turns.map((turn) => {
      const message = turn.userMessage;
      if (!message || message.sourceEntryId) return turn;
      const entry = entryQueues.get(message.timestamp)?.shift();
      if (!entry) return turn;
      changed = true;
      return { ...turn, userMessage: { ...message, sourceEntryId: entry.entryId } };
    });
    return changed;
  }

  appendUserPrompt(text: string, images: WebviewImageInput[], timestamp = Date.now()): string {
    const turn = this.#createUserTurn(text, images, timestamp);
    this.#turns = [...this.#turns, turn];
    this.#activeTurnId = turn.id;
    return turn.id;
  }

  /**
   * Park a follow-up outside the durable timeline while the current agent run is still open.
   * Promoted into a normal turn on the next agent_start after that run settles.
   */
  enqueueFollowUp(text: string, images: WebviewImageInput[], timestamp = Date.now()): string {
    const id = `queued-follow-up-${timestamp}-${++this.#sequence}`;
    this.#queuedFollowUps = [...this.#queuedFollowUps, {
      id,
      text,
      images: toImageViews(images),
      timestamp,
    }];
    return id;
  }

  clearQueuedFollowUps(): void {
    if (this.#queuedFollowUps.length === 0) return;
    this.#queuedFollowUps = [];
  }

  removeQueuedFollowUp(id: string): boolean {
    const next = this.#queuedFollowUps.filter((item) => item.id !== id);
    if (next.length === this.#queuedFollowUps.length) return false;
    this.#queuedFollowUps = next;
    return true;
  }

  appendNotice(text: string, level: SessionNoticeLevel = "info", timestamp = Date.now()): void {
    const notice = {
      id: `notice-${timestamp}-${++this.#sequence}`,
      text,
      level,
      timestamp,
    };
    if (this.#activeTurnId) {
      this.#upsertActivity(this.#activeTurnId, { ...notice, type: "notice" });
      return;
    }
    this.#notices = [...this.#notices, notice];
  }

  /**
   * Close a specific local turn that never entered an agent run.
   * Used for Pi extension slash commands, which complete without agent_settled.
   */
  completeTurn(turnId: string, status: AgentTurnStatus = "completed"): boolean {
    const turn = this.#turns.find((item) => item.id === turnId);
    if (!turn || turn.status !== "running") return false;
    this.#setTurnStatus(turnId, status, Date.now());
    if (this.#activeTurnId === turnId) {
      this.#activeTurnId = null;
      this.#streamingMessageId = null;
    }
    return true;
  }

  applyEvent(event: RpcEvent): void {
    switch (event.type) {
      case "agent_start": {
        let active = this.#activeTurn();
        // Defense: an idle-gap local turn (running, no activities) must not steal promotion.
        if (this.#queuedFollowUps.length > 0 && active?.status === "running" && active.activities.length === 0) {
          this.#turns = this.#turns.filter((turn) => turn.id !== active!.id);
          this.#activeTurnId = null;
          active = undefined;
        }
        const turn = active?.status === "running"
          ? active
          : this.#promoteQueuedFollowUp() ?? active ?? this.#ensureTurn(Date.now());
        this.#activeTurnId = turn.id;
        this.#setTurnStatus(turn.id, "running");
        break;
      }
      case "agent_settled": {
        if (this.#activeTurnId) {
          const active = this.#turn(this.#activeTurnId);
          if (active.status === "running") this.#setTurnStatus(this.#activeTurnId, "completed", Date.now());
        }
        this.#activeTurnId = null;
        this.#streamingMessageId = null;
        break;
      }
      case "message_start": {
        // Pi drains follow-ups inside the same agent run (before agent_end), emitting
        // message_start(role=user) without a fresh agent_start. Promote on that signal.
        if (this.#tryPromoteQueuedUserMessage(event)) break;
        if (this.#alignActiveUserTimestamp(event)) break;
        this.#applyMessageEvent(event);
        break;
      }
      case "message_update":
      case "message_end":
        this.#applyMessageEvent(event);
        break;
      case "tool_execution_start":
        this.#applyToolStart(event);
        break;
      case "tool_execution_update":
        this.#applyToolUpdate(event);
        break;
      case "tool_execution_end":
        this.#applyToolEnd(event);
        break;
      case "extension_error":
        this.appendNotice(`Extension error: ${stringValue(event.error, "Unknown extension error")}`, "error");
        break;
      case "auto_retry_start":
        this.appendNotice(`Retrying after a transient provider error (attempt ${typeof event.attempt === "number" || typeof event.attempt === "string" ? event.attempt : "?"}).`);
        break;
      case "auto_retry_end":
        if (event.success === false) this.appendNotice(`Automatic retry failed: ${stringValue(event.finalError, "Unknown error")}`, "error");
        break;
      case "compaction_end": {
        const result = recordValue(event.result);
        if (typeof result.summary === "string" && typeof result.tokensBefore === "number") {
          this.#appendCompaction(result.summary, result.tokensBefore, Date.now());
          this.#activeTurnId = null;
        }
        break;
      }
      default:
        break;
    }
  }

  #appendCompaction(summary: string, tokensBefore: number, timestamp: number): void {
    const previous = this.#compactions.at(-1);
    if (previous?.summary === summary && previous.tokensBefore === tokensBefore) return;
    this.#compactions = [...this.#compactions, {
      id: `compaction-${timestamp}-${++this.#sequence}`,
      summary,
      tokensBefore,
      timestamp,
    }];
  }

  #applyMessageEvent(event: RpcEvent): void {
    const raw = event.message;
    if (!isRecord(raw) || raw.role !== "assistant") return;
    const turn = this.#activeTurn() ?? this.#ensureTurn(typeof raw.timestamp === "number" ? raw.timestamp : Date.now());
    this.#activeTurnId = turn.id;
    if (!this.#streamingMessageId) this.#streamingMessageId = rawMessageId(raw, `assistant-${Date.now()}-${++this.#sequence}`);
    const messageId = this.#streamingMessageId;
    const delta = isRecord(event.assistantMessageEvent) ? event.assistantMessageEvent : {};
    const status: MessageStatus = event.type === "message_end"
      ? raw.stopReason === "aborted" ? "aborted" : raw.stopReason === "error" ? "error" : "complete"
      : delta.type === "error" ? delta.reason === "aborted" ? "aborted" : "error"
      : "streaming";
    const timestamp = typeof raw.timestamp === "number" ? raw.timestamp : Date.now();
    const activities = activitiesFromAssistant(messageId, raw.content, raw.errorMessage, status, timestamp);
    this.#replaceMessageActivities(turn.id, messageId, activities);
    if (status === "streaming") this.#setTurnStatus(turn.id, "running");
    else if (status === "aborted" || status === "error") this.#setTurnStatus(turn.id, statusToTurnStatus(status), Date.now());
    if (event.type === "message_end") this.#streamingMessageId = null;
  }

  #applyToolStart(event: RpcEvent): void {
    if (typeof event.toolCallId !== "string") return;
    const turn = this.#activeTurn() ?? this.#ensureTurn(Date.now());
    this.#activeTurnId = turn.id;
    this.#upsertTool(turn.id, event.toolCallId, {
      name: stringValue(event.toolName, "tool"),
      args: recordValue(event.args),
      status: "running",
      isError: false,
      timestamp: Date.now(),
    });
  }

  #applyToolUpdate(event: RpcEvent): void {
    if (typeof event.toolCallId !== "string") return;
    const turn = this.#activeTurn() ?? this.#ensureTurn(Date.now());
    this.#upsertTool(turn.id, event.toolCallId, {
      name: stringValue(event.toolName, "tool"),
      args: recordValue(event.args),
      status: "running",
      output: extractText(event.partialResult).slice(-80_000),
      isError: false,
      timestamp: Date.now(),
    });
  }

  #applyToolEnd(event: RpcEvent): void {
    if (typeof event.toolCallId !== "string") return;
    const turn = this.#activeTurn() ?? this.#ensureTurn(Date.now());
    const isError = event.isError === true;
    this.#upsertTool(turn.id, event.toolCallId, {
      name: stringValue(event.toolName, "tool"),
      args: recordValue(event.args),
      status: isError ? "error" : "complete",
      output: extractText(event.result).slice(-160_000),
      isError,
      endedAt: Date.now(),
      timestamp: Date.now(),
    });
  }

  #upsertTool(
    fallbackTurnId: string,
    id: string,
    update: {
      name: string;
      args: Record<string, unknown>;
      status: ToolCallView["status"];
      output?: string;
      isError: boolean;
      endedAt?: number;
      timestamp: number;
    },
  ): void {
    const location = this.#toolActivities.get(id);
    const turnId = location?.turnId ?? fallbackTurnId;
    const current = location ? this.#activity(turnId, location.activityId) : undefined;
    const currentTool = current?.type === "tool" ? current.tool : undefined;
    const created = createToolView(id, update.name || currentTool?.name || "tool", Object.keys(update.args).length ? update.args : currentTool?.args ?? {}, currentTool?.startedAt ?? update.timestamp);
    const tool: ToolCallView = {
      ...created,
      ...currentTool,
      name: update.name || currentTool?.name || created.name,
      args: Object.keys(update.args).length ? update.args : currentTool?.args ?? created.args,
      status: update.status,
      isError: update.isError,
      ...(update.output !== undefined ? { output: update.output } : currentTool?.output !== undefined ? { output: currentTool.output } : {}),
      ...(update.endedAt !== undefined ? { endedAt: update.endedAt } : currentTool?.endedAt !== undefined ? { endedAt: currentTool.endedAt } : {}),
    };
    const activity: AgentActivityView = {
      id: location?.activityId ?? `tool-${id}`,
      type: "tool",
      tool,
      timestamp: current?.timestamp ?? tool.startedAt,
    };
    this.#upsertActivity(turnId, activity);
    this.#toolActivities.set(id, { turnId, activityId: activity.id });
  }

  #replaceMessageActivities(turnId: string, messageId: string, activities: AgentActivityView[]): void {
    const previousIds = new Set((this.#messageActivities.get(messageId) ?? []).map((item) => item.activityId));
    const replacements = new Map(activities.map((activity) => [activity.id, activity]));
    const observedIds = new Set<string>();
    const turn = this.#turn(turnId);
    const nextActivities: AgentActivityView[] = [];
    for (const current of turn.activities) {
      const replacement = replacements.get(current.id);
      if (replacement) {
        nextActivities.push(replacement);
        observedIds.add(current.id);
      } else if (!previousIds.has(current.id)) {
        nextActivities.push(current);
      }
    }
    for (const activity of activities) {
      if (!observedIds.has(activity.id)) nextActivities.push(activity);
    }
    this.#replaceTurn({ ...turn, activities: nextActivities });
    const locations = activities.map((activity) => ({ turnId, activityId: activity.id }));
    this.#messageActivities.set(messageId, locations);
    for (const activity of activities) {
      if (activity.type === "tool") this.#toolActivities.set(activity.tool.id, { turnId, activityId: activity.id });
    }
  }

  #upsertActivity(turnId: string, activity: AgentActivityView): void {
    const turn = this.#turn(turnId);
    const index = turn.activities.findIndex((item) => item.id === activity.id);
    const activities = [...turn.activities];
    if (index === -1) activities.push(activity);
    else activities[index] = activity;
    this.#replaceTurn({ ...turn, activities });
  }

  #setTurnStatus(turnId: string, status: AgentTurnStatus, endedAt?: number): void {
    const turn = this.#turn(turnId);
    this.#replaceTurn({ ...turn, status, ...(endedAt ? { endedAt } : {}) });
  }

  #ensureTurn(timestamp: number): AgentTurnView {
    const turn: AgentTurnView = {
      id: `turn-orphan-${timestamp}-${++this.#sequence}`,
      activities: [],
      status: "running",
      startedAt: timestamp,
    };
    this.#turns = [...this.#turns, turn];
    this.#activeTurnId = turn.id;
    return turn;
  }

  #tryPromoteQueuedUserMessage(event: RpcEvent): boolean {
    if (this.#queuedFollowUps.length === 0) return false;
    const raw = event.message;
    if (!isRecord(raw) || raw.role !== "user") return false;

    const remaining = [...this.#queuedFollowUps];
    const [promoted] = remaining.splice(0, 1);
    if (!promoted) return false;
    this.#queuedFollowUps = remaining;

    // Close the prior turn so B/C activities do not append under A.
    if (this.#activeTurnId) {
      const prior = this.#turn(this.#activeTurnId);
      if (prior.status === "running") this.#setTurnStatus(this.#activeTurnId, "completed", Date.now());
    }
    this.#streamingMessageId = null;

    const turn = this.#createUserTurn(promoted.text, promoted.images, typeof raw.timestamp === "number" ? raw.timestamp : promoted.timestamp);
    this.#turns = [...this.#turns, turn];
    this.#activeTurnId = turn.id;
    return true;
  }

  #alignActiveUserTimestamp(event: RpcEvent): boolean {
    const raw = event.message;
    if (!isRecord(raw) || raw.role !== "user" || typeof raw.timestamp !== "number") return false;
    const turn = this.#activeTurn();
    if (!turn?.userMessage || turn.userMessage.sourceEntryId) return true;
    this.#replaceTurn({
      ...turn,
      startedAt: raw.timestamp,
      userMessage: { ...turn.userMessage, timestamp: raw.timestamp },
    });
    return true;
  }

  #promoteQueuedFollowUp(): AgentTurnView | undefined {
    const [next, ...rest] = this.#queuedFollowUps;
    if (!next) return undefined;
    this.#queuedFollowUps = rest;
    const turn = this.#createUserTurn(next.text, next.images, next.timestamp);
    this.#turns = [...this.#turns, turn];
    return turn;
  }

  #createUserTurn(text: string, images: WebviewImageInput[] | ImageAttachmentView[], timestamp: number): AgentTurnView {
    const blocks: MessageBlockView[] = [];
    if (text) blocks.push({ type: "text", text });
    const resolvedImages = toImageViews(images);
    if (resolvedImages.length) blocks.push({ type: "images", images: resolvedImages });
    const message: ConversationMessageView = {
      id: `local-user-${timestamp}-${++this.#sequence}`,
      role: "user",
      blocks,
      status: "complete",
      timestamp,
    };
    return {
      id: `turn-${message.id}`,
      userMessage: message,
      activities: [],
      status: "running",
      startedAt: timestamp,
    };
  }

  #activeTurn(): AgentTurnView | undefined {
    return this.#activeTurnId ? this.#turns.find((turn) => turn.id === this.#activeTurnId) : undefined;
  }

  #turn(turnId: string): AgentTurnView {
    const turn = this.#turns.find((item) => item.id === turnId);
    if (!turn) throw new Error(`Unknown projected turn: ${turnId}`);
    return turn;
  }

  #replaceTurn(next: AgentTurnView): void {
    this.#turns = this.#turns.map((turn) => turn.id === next.id ? next : turn);
  }

  #activity(turnId: string, activityId: string): AgentActivityView | undefined {
    return this.#turns.find((turn) => turn.id === turnId)?.activities.find((activity) => activity.id === activityId);
  }
}

function userEntryQueues(userEntries: readonly UserEntryReference[]): Map<number, UserEntryReference[]> {
  const queues = new Map<number, UserEntryReference[]>();
  for (const entry of userEntries) {
    if (entry.timestamp === undefined) continue;
    queues.set(entry.timestamp, [...(queues.get(entry.timestamp) ?? []), entry]);
  }
  return queues;
}

function toImageViews(images: Array<WebviewImageInput | ImageAttachmentView>): ImageAttachmentView[] {
  return images.map((image) => {
    if ("dataUrl" in image) return image;
    return {
      id: image.id,
      name: image.name,
      mimeType: image.mimeType,
      dataUrl: `data:${image.mimeType};base64,${image.data}`,
      size: image.size,
    };
  });
}

function createUserMessage(
  raw: Record<string, unknown>,
  timestamp: number,
  fallbackId: string,
  sourceEntryId?: string,
): ConversationMessageView {
  return {
    id: rawMessageId(raw, fallbackId),
    ...(sourceEntryId ? { sourceEntryId } : {}),
    role: "user",
    blocks: userBlocks(raw.content, raw.attachments),
    status: "complete",
    timestamp,
  };
}

function userBlocks(content: unknown, attachments: unknown): MessageBlockView[] {
  const blocks: MessageBlockView[] = [];
  if (typeof content === "string" && content) blocks.push({ type: "text", text: content });
  const images: ImageAttachmentView[] = [];
  for (const part of arrayValue(content)) {
    if (!isRecord(part)) continue;
    if (part.type === "text" && typeof part.text === "string") blocks.push({ type: "text", text: part.text });
    if (part.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string") images.push(imageView(part, part.data));
  }
  for (const attachment of arrayValue(attachments)) {
    if (!isRecord(attachment) || attachment.type !== "image" || typeof attachment.content !== "string" || typeof attachment.mimeType !== "string") continue;
    images.push(imageView(attachment, attachment.content));
  }
  if (images.length) blocks.push({ type: "images", images });
  return blocks.length ? blocks : [{ type: "text", text: "" }];
}

function activitiesFromAssistant(
  messageId: string,
  content: unknown,
  errorMessage: unknown,
  status: MessageStatus,
  timestamp: number,
): AgentActivityView[] {
  const activities: AgentActivityView[] = [];
  let index = 0;
  if (typeof content === "string") {
    if (content) activities.push(responseActivity(messageId, index++, [{ type: "text", text: content }], status, timestamp));
  } else {
    for (const part of arrayValue(content)) {
      if (!isRecord(part) || typeof part.type !== "string") continue;
      if (part.type === "thinking" && typeof part.thinking === "string") {
        activities.push({ id: `${messageId}:reasoning:${index++}`, type: "reasoning", text: part.thinking, status, timestamp });
        continue;
      }
      if (part.type === "text" && typeof part.text === "string" && part.text) {
        activities.push(responseActivity(messageId, index++, [{ type: "text", text: part.text }], status, timestamp));
        continue;
      }
      if (part.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string") {
        activities.push(responseActivity(messageId, index++, [{ type: "images", images: [imageView(part, part.data)] }], status, timestamp));
        continue;
      }
      if (part.type === "toolCall" && typeof part.id === "string") {
        const tool = createToolView(part.id, stringValue(part.name, "tool"), recordValue(part.arguments), timestamp);
        activities.push({ id: `tool-${part.id}`, type: "tool", tool, timestamp });
        index++;
      }
    }
  }
  if (status === "error" && typeof errorMessage === "string" && errorMessage) {
    activities.push(responseActivity(messageId, index, [{ type: "error", text: errorMessage }], status, timestamp));
  }
  return activities;
}

function responseActivity(messageId: string, index: number, blocks: MessageBlockView[], status: MessageStatus, timestamp: number): ResponseActivityView {
  return { id: `${messageId}:response:${index}`, type: "response", blocks, status, timestamp };
}

function imageView(raw: Record<string, unknown>, data: string): ImageAttachmentView {
  const mimeType = stringValue(raw.mimeType, "image/png");
  return {
    id: stringValue(raw.id, Math.random().toString(36).slice(2, 10)),
    name: stringValue(raw.fileName, "image"),
    mimeType,
    dataUrl: `data:${mimeType};base64,${data}`,
    size: typeof raw.size === "number" ? raw.size : Math.floor((data.length * 3) / 4),
  };
}

function rawMessageId(raw: Record<string, unknown>, fallback: string): string {
  return typeof raw.id === "string" ? raw.id : `${fallback}-${typeof raw.timestamp === "number" ? raw.timestamp : Date.now()}`;
}

function assistantMessageStatus(stopReason: unknown): MessageStatus {
  if (stopReason === "aborted") return "aborted";
  if (stopReason === "error") return "error";
  return "complete";
}

function statusToTurnStatus(status: MessageStatus): AgentTurnStatus {
  if (status === "streaming") return "running";
  if (status === "aborted") return "aborted";
  if (status === "error") return "error";
  return "completed";
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
