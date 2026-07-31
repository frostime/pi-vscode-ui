import type { RpcEvent, RpcSessionEntry } from "@frostime/pi-rpc";

import type { WebviewImageInput } from "../../shared/bridge/webviewToHost.js";
import type {
  AgentActivityView,
  AgentTurnStatus,
  AgentTurnView,
  BranchControlView,
  BranchSummaryView,
  CompactionView,
  ConversationAnnotationView,
  ConversationItemView,
  ConversationMessageView,
  CustomMessageView,
  ImageAttachmentView,
  MessageBlockView,
  MessageStatus,
  QueuedFollowUpView,
  ResponseActivityView,
  SessionNoticeLevel,
  SessionNoticeView,
} from "../../shared/model/conversationModel.js";
import type { ToolCallView } from "../../shared/model/toolCallModel.js";
import { validateProjectedImageAttachments } from "../attachments/normalizeImageAttachment.js";
import { contentToBlocks, createToolView, extractText, isRecord, recordValue, stringValue } from "./messageAssembler.js";

export interface ActiveBranchEdge {
  branchPointId: string | null;
  activeChildEntryId: string;
  pathCount: number;
}

export interface ConversationProjectionSnapshot {
  items: readonly ConversationItemView[];
  queuedFollowUps: readonly QueuedFollowUpView[];
  updatedAt: number;
}

export type ConversationReconcileResult = "applied" | "reload";

interface ItemLocation {
  turnId: string;
  itemId: string;
}

export class ConversationProjection {
  #items: ConversationItemView[] = [];
  #queuedFollowUps: QueuedFollowUpView[] = [];
  #activeTurnId: string | null = null;
  #persistedTurnId: string | null = null;
  #streamingMessageId: string | null = null;
  #sequence = 0;
  #updatedAt = Date.now();
  readonly #persistedEntryIds = new Set<string>();
  readonly #eligibleLiveTurnIds: string[] = [];
  readonly #eligibleLiveTurnIdSet = new Set<string>();
  readonly #messageItems = new Map<string, ItemLocation[]>();
  readonly #toolItems = new Map<string, ItemLocation>();
  readonly #pendingCompactionIds: string[] = [];
  #maxImageBytes: number;
  #maxImages: number;

  constructor(maxImageBytes = 10 * 1024 * 1024, maxImages = 12) {
    this.#maxImageBytes = maxImageBytes;
    this.#maxImages = maxImages;
  }

  read(): ConversationProjectionSnapshot {
    return {
      items: this.#items,
      queuedFollowUps: this.#queuedFollowUps,
      updatedAt: this.#updatedAt,
    };
  }

  replaceEntries(entries: readonly RpcSessionEntry[], branchEdges: readonly ActiveBranchEdge[]): void {
    this.#items = [];
    this.#activeTurnId = null;
    this.#persistedTurnId = null;
    this.#streamingMessageId = null;
    this.#persistedEntryIds.clear();
    this.#eligibleLiveTurnIds.length = 0;
    this.#eligibleLiveTurnIdSet.clear();
    this.#messageItems.clear();
    this.#toolItems.clear();
    this.#pendingCompactionIds.length = 0;

    this.#projectEntries(entries, branchEdges);
    this.#completePersistedTurn();
    this.#touch();
  }

  reconcileEntries(
    entries: readonly RpcSessionEntry[],
    branchEdges: readonly ActiveBranchEdge[],
  ): ConversationReconcileResult {
    const appendedEntryIds = new Set(entries.map((entry) => entry.id));
    const existingControlIds = new Set(this.#conversationItems().filter(isBranchControl).map((control) => control.id));
    for (const edge of branchEdges) {
      if (!existingControlIds.has(branchControlId(edge)) && !appendedEntryIds.has(edge.activeChildEntryId)) {
        return "reload";
      }
    }

    this.#refreshBranchControls(branchEdges);
    this.#projectEntries(entries, branchEdges);
    this.#completePersistedTurn();
    this.#touch();
    return "applied";
  }

  setImageLimits(maxImageBytes: number, maxImages: number): void {
    this.#maxImageBytes = maxImageBytes;
    this.#maxImages = maxImages;
  }

  userMessage(sourceEntryId: string): ConversationMessageView | undefined {
    for (const item of this.#items) {
      if (item.type === "turn" && item.userMessage?.sourceEntryId === sourceEntryId) return item.userMessage;
    }
    return undefined;
  }

  appendUserPrompt(text: string, images: WebviewImageInput[], timestamp = Date.now()): string {
    const turn = this.#createUserTurn(text, images, timestamp);
    this.#items = [...this.#items, turn];
    this.#activeTurnId = turn.id;
    this.#touch();
    return turn.id;
  }

  enqueueFollowUp(text: string, images: WebviewImageInput[], timestamp = Date.now()): string {
    const id = `queued-follow-up-${timestamp}-${++this.#sequence}`;
    this.#queuedFollowUps = [...this.#queuedFollowUps, {
      id,
      text,
      images: toImageViews(images),
      timestamp,
    }];
    this.#touch();
    return id;
  }

  clearQueuedFollowUps(): void {
    if (this.#queuedFollowUps.length === 0) return;
    this.#queuedFollowUps = [];
    this.#touch();
  }

  removeQueuedFollowUp(id: string): boolean {
    const next = this.#queuedFollowUps.filter((item) => item.id !== id);
    if (next.length === this.#queuedFollowUps.length) return false;
    this.#queuedFollowUps = next;
    this.#touch();
    return true;
  }

  appendNotice(text: string, level: SessionNoticeLevel = "info", timestamp = Date.now()): void {
    const notice: SessionNoticeView = {
      id: `notice-${timestamp}-${++this.#sequence}`,
      type: "notice",
      text,
      level,
      timestamp,
    };
    this.#appendLiveItem(notice);
    this.#touch();
  }

  completeTurn(turnId: string, status: AgentTurnStatus = "completed", endedAt = Date.now()): boolean {
    const turn = this.#findTurn(turnId);
    if (!turn || turn.status !== "running") return false;
    this.#setTurnStatus(turnId, status, endedAt);
    if (this.#activeTurnId === turnId) {
      this.#activeTurnId = null;
      this.#streamingMessageId = null;
    }
    this.#touch();
    return true;
  }

  applyEvent(event: RpcEvent): void {
    switch (event.type) {
      case "agent_start":
        this.#startAgentTurn();
        break;
      case "agent_settled":
        this.#settleAgentTurn();
        break;
      case "message_start":
        if (
          !this.#alignActiveTurnAwaitingUserMessage(event)
          && !this.#tryPromoteQueuedUserMessage(event)
          && !this.#alignActiveUserMessage(event)
        ) {
          this.#applyAssistantMessageEvent(event);
        }
        break;
      case "message_update":
      case "message_end":
        this.#applyAssistantMessageEvent(event);
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
        return;
      case "auto_retry_start":
        this.appendNotice(`Retrying after a transient provider error (attempt ${retryAttempt(event.attempt)}).`);
        return;
      case "auto_retry_end":
        if (event.success === false) this.appendNotice(`Automatic retry failed: ${stringValue(event.finalError, "Unknown error")}`, "error");
        return;
      case "compaction_end":
        this.#applyLiveCompaction(event);
        break;
      default:
        return;
    }
    this.#touch();
  }

  #projectEntries(entries: readonly RpcSessionEntry[], branchEdges: readonly ActiveBranchEdge[]): void {
    const edgesByChildId = new Map(branchEdges.map((edge) => [edge.activeChildEntryId, edge]));
    for (const entry of entries) {
      if (this.#persistedEntryIds.has(entry.id)) continue;
      const edge = edgesByChildId.get(entry.id);
      if (edge) this.#appendPersistedItem(branchControlView(edge));
      this.#projectEntry(entry);
      this.#persistedEntryIds.add(entry.id);
    }
  }

  #projectEntry(entry: RpcSessionEntry): void {
    switch (entry.type) {
      case "message":
        this.#projectMessageEntry(entry);
        break;
      case "compaction":
        this.#projectCompactionEntry(entry);
        break;
      case "branch_summary":
        this.#appendPersistedItem(branchSummaryView(entry));
        break;
      case "custom_message":
        if (entry.display === true) {
          this.#appendPersistedItem(customMessageView(
            entry,
            this.#validatedBlocks(entry.content, undefined, entry.id),
          ));
        }
        break;
      default:
        break;
    }
  }

  #projectMessageEntry(entry: RpcSessionEntry): void {
    const message = isRecord(entry.message) ? entry.message : undefined;
    if (!message || typeof message.role !== "string") return;
    const timestamp = entryTimestamp(entry, message);

    if (message.role === "user") {
      this.#completePersistedTurn(timestamp);
      const eligibleTurnId = this.#takeEligibleLiveTurnId();
      const eligibleTurn = eligibleTurnId ? this.#findTurn(eligibleTurnId) : undefined;
      if (eligibleTurn?.userMessage) {
        this.#replaceTurnAtEnd({
          ...eligibleTurn,
          userMessage: { ...eligibleTurn.userMessage, sourceEntryId: entry.id, timestamp },
          startedAt: timestamp,
        });
        this.#persistedTurnId = eligibleTurn.id;
      } else {
        const turn = persistedUserTurn(
          entry,
          timestamp,
          this.#validatedBlocks(message.content, message.attachments, entry.id),
        );
        this.#items = [...this.#items, turn];
        this.#persistedTurnId = turn.id;
      }
      return;
    }

    if (message.role === "assistant") {
      const turn = this.#persistedTurn(entry.id, timestamp);
      const messageId = rawMessageId(message, `assistant-${entry.id}`);
      const status = assistantMessageStatus(message.stopReason);
      this.#validatedBlocks(message.content, undefined, messageId);
      this.#replaceMessageItems(
        turn.id,
        messageId,
        assistantActivities(messageId, message, status, timestamp, (content, idPrefix) => (
          this.#validatedBlocks(content, undefined, idPrefix)
        )),
      );
      if (message.stopReason !== "toolUse") {
        this.#setTurnStatus(turn.id, statusToTurnStatus(status), timestamp);
        this.#persistedTurnId = null;
      }
      return;
    }

    if (message.role === "toolResult" && typeof message.toolCallId === "string") {
      const turn = this.#persistedTurn(entry.id, timestamp);
      this.#upsertTool(turn.id, message.toolCallId, {
        name: stringValue(message.toolName, "tool"),
        args: {},
        status: message.isError === true ? "error" : "complete",
        output: extractText(message.content).slice(-160_000),
        isError: message.isError === true,
        endedAt: timestamp,
        timestamp,
      });
      return;
    }

    if (message.role === "bashExecution") {
      const command = stringValue(message.command, "command");
      const output = stringValue(message.output, "");
      this.#appendPersistedItem({
        id: entry.id,
        type: "notice",
        text: `Ran \`${command}\`${output ? `\n\n${output}` : ""}`,
        level: Number(message.exitCode ?? 0) === 0 ? "info" : "error",
        timestamp,
      });
    }
  }

  #projectCompactionEntry(entry: RpcSessionEntry): void {
    const timestamp = entryTimestamp(entry);
    const pendingId = this.#pendingCompactionIds.shift();
    if (pendingId) this.#removeItem(pendingId);
    const compaction: CompactionView = {
      id: pendingId ?? entry.id,
      type: "compaction",
      summary: stringValue(entry.summary, ""),
      tokensBefore: numericValue(entry.tokensBefore) ?? 0,
      timestamp,
    };
    this.#appendPersistedItem(compaction);
  }

  #startAgentTurn(): void {
    let active = this.#activeTurn();
    if (this.#queuedFollowUps.length > 0 && active?.status === "running" && active.items.length === 0) {
      this.#items = this.#items.filter((item) => item.id !== active!.id);
      this.#activeTurnId = null;
      active = undefined;
    }
    const turn = active?.status === "running"
      ? active
      : this.#promoteQueuedFollowUp() ?? active ?? this.#ensureLiveTurn(Date.now());
    this.#activeTurnId = turn.id;
    this.#setTurnStatus(turn.id, "running");
  }

  #settleAgentTurn(): void {
    if (this.#activeTurnId) {
      const turn = this.#turn(this.#activeTurnId);
      if (turn.status === "running") this.#setTurnStatus(turn.id, "completed", Date.now());
    }
    this.#activeTurnId = null;
    this.#streamingMessageId = null;
  }

  #applyAssistantMessageEvent(event: RpcEvent): void {
    const message = event.message;
    if (!isRecord(message) || message.role !== "assistant") return;
    const timestamp = numericValue(message.timestamp) ?? Date.now();
    const turn = this.#activeTurn() ?? this.#ensureLiveTurn(timestamp);
    this.#activeTurnId = turn.id;
    if (!this.#streamingMessageId) {
      this.#streamingMessageId = rawMessageId(message, `assistant-live-${timestamp}-${++this.#sequence}`);
    }

    const delta = isRecord(event.assistantMessageEvent) ? event.assistantMessageEvent : {};
    const status: MessageStatus = event.type === "message_end"
      ? assistantMessageStatus(message.stopReason)
      : delta.type === "error"
        ? delta.reason === "aborted" ? "aborted" : "error"
        : "streaming";
    this.#replaceMessageItems(
      turn.id,
      this.#streamingMessageId,
      assistantActivities(
        this.#streamingMessageId,
        message,
        status,
        timestamp,
        (content, idPrefix) => this.#validatedBlocks(content, undefined, idPrefix),
      ),
    );
    if (status === "streaming") this.#setTurnStatus(turn.id, "running");
    else if (status === "aborted" || status === "error") this.#setTurnStatus(turn.id, statusToTurnStatus(status), Date.now());
    else if (message.stopReason !== "toolUse") this.#setTurnStatus(turn.id, "completed", Date.now());
    if (event.type === "message_end") this.#streamingMessageId = null;
  }

  #applyToolStart(event: RpcEvent): void {
    if (typeof event.toolCallId !== "string") return;
    const turn = this.#activeTurn() ?? this.#ensureLiveTurn(Date.now());
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
    const turn = this.#activeTurn() ?? this.#ensureLiveTurn(Date.now());
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
    const turn = this.#activeTurn() ?? this.#ensureLiveTurn(Date.now());
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

  #applyLiveCompaction(event: RpcEvent): void {
    const result = recordValue(event.result);
    if (typeof result.summary !== "string" || typeof result.tokensBefore !== "number") return;
    const timestamp = Date.now();
    const compaction: CompactionView = {
      id: `compaction-live-${timestamp}-${++this.#sequence}`,
      type: "compaction",
      summary: result.summary,
      tokensBefore: result.tokensBefore,
      timestamp,
    };
    this.#appendLiveItem(compaction);
    this.#pendingCompactionIds.push(compaction.id);
  }

  #alignActiveTurnAwaitingUserMessage(event: RpcEvent): boolean {
    const turn = this.#activeTurn();
    if (
      !turn?.userMessage
      || turn.userMessage.sourceEntryId
      || this.#eligibleLiveTurnIdSet.has(turn.id)
    ) return false;
    return this.#alignActiveUserMessage(event);
  }

  #tryPromoteQueuedUserMessage(event: RpcEvent): boolean {
    if (this.#queuedFollowUps.length === 0) return false;
    const message = event.message;
    if (!isRecord(message) || message.role !== "user") return false;

    const [promoted, ...remaining] = this.#queuedFollowUps;
    if (!promoted) return false;
    this.#queuedFollowUps = remaining;
    if (this.#activeTurnId) {
      const prior = this.#turn(this.#activeTurnId);
      if (prior.status === "running") this.#setTurnStatus(prior.id, "completed", Date.now());
    }
    this.#streamingMessageId = null;

    const timestamp = numericValue(message.timestamp) ?? promoted.timestamp;
    const turn = this.#createUserTurn(promoted.text, promoted.images, timestamp);
    this.#items = [...this.#items, turn];
    this.#activeTurnId = turn.id;
    this.#markLiveTurnEligible(turn.id);
    return true;
  }

  #alignActiveUserMessage(event: RpcEvent): boolean {
    const message = event.message;
    if (!isRecord(message) || message.role !== "user") return false;
    const turn = this.#activeTurn();
    if (!turn?.userMessage) return true;

    const timestamp = numericValue(message.timestamp) ?? turn.startedAt;
    this.#replaceTurn({
      ...turn,
      startedAt: timestamp,
      userMessage: { ...turn.userMessage, timestamp },
    });
    this.#markLiveTurnEligible(turn.id);
    return true;
  }

  #markLiveTurnEligible(turnId: string): void {
    if (this.#eligibleLiveTurnIdSet.has(turnId)) return;
    this.#eligibleLiveTurnIdSet.add(turnId);
    this.#eligibleLiveTurnIds.push(turnId);
  }

  #takeEligibleLiveTurnId(): string | undefined {
    while (this.#eligibleLiveTurnIds.length > 0) {
      const turnId = this.#eligibleLiveTurnIds.shift();
      if (!turnId) continue;
      this.#eligibleLiveTurnIdSet.delete(turnId);
      const turn = this.#findTurn(turnId);
      if (turn?.userMessage && !turn.userMessage.sourceEntryId) return turnId;
    }
    return undefined;
  }

  #promoteQueuedFollowUp(): AgentTurnView | undefined {
    const [next, ...remaining] = this.#queuedFollowUps;
    if (!next) return undefined;
    this.#queuedFollowUps = remaining;
    const turn = this.#createUserTurn(next.text, next.images, next.timestamp);
    this.#items = [...this.#items, turn];
    return turn;
  }

  #refreshBranchControls(branchEdges: readonly ActiveBranchEdge[]): void {
    const controls = new Map(branchEdges.map((edge) => [branchControlId(edge), branchControlView(edge)]));
    this.#items = this.#items.map((item) => {
      if (item.type === "branchControl") return controls.get(item.id) ?? item;
      if (item.type !== "turn") return item;
      return {
        ...item,
        items: item.items.map((turnItem) => turnItem.type === "branchControl" ? controls.get(turnItem.id) ?? turnItem : turnItem),
      };
    });
  }

  #appendPersistedItem(item: ConversationAnnotationView | BranchControlView): void {
    if (this.#persistedTurnId) {
      this.#upsertTurnItem(this.#persistedTurnId, item);
      return;
    }
    this.#items = [...this.#items, item];
  }

  #appendLiveItem(item: ConversationAnnotationView | BranchControlView): void {
    if (this.#activeTurnId) {
      this.#upsertTurnItem(this.#activeTurnId, item);
      return;
    }
    this.#items = [...this.#items, item];
  }

  #persistedTurn(entryId: string, timestamp: number): AgentTurnView {
    if (this.#persistedTurnId) return this.#turn(this.#persistedTurnId);
    const turn: AgentTurnView = {
      id: `turn-${entryId}`,
      type: "turn",
      items: [],
      status: "running",
      startedAt: timestamp,
    };
    this.#items = [...this.#items, turn];
    this.#persistedTurnId = turn.id;
    return turn;
  }

  #completePersistedTurn(endedAt = Date.now()): void {
    if (!this.#persistedTurnId) return;
    const turn = this.#findTurn(this.#persistedTurnId);
    if (turn?.status === "running") this.#setTurnStatus(turn.id, "completed", endedAt);
    this.#persistedTurnId = null;
  }

  #ensureLiveTurn(timestamp: number): AgentTurnView {
    const turn: AgentTurnView = {
      id: `turn-orphan-live-${timestamp}-${++this.#sequence}`,
      type: "turn",
      items: [],
      status: "running",
      startedAt: timestamp,
    };
    this.#items = [...this.#items, turn];
    this.#activeTurnId = turn.id;
    return turn;
  }

  #createUserTurn(
    text: string,
    images: readonly WebviewImageInput[] | readonly ImageAttachmentView[],
    timestamp: number,
  ): AgentTurnView {
    const blocks: MessageBlockView[] = [];
    if (text) blocks.push({ type: "text", text });
    const resolvedImages = toImageViews(images);
    if (resolvedImages.length > 0) blocks.push({ type: "images", images: resolvedImages });
    const message: ConversationMessageView = {
      id: `local-user-${timestamp}-${++this.#sequence}`,
      role: "user",
      blocks,
      status: "complete",
      timestamp,
    };
    return {
      id: `turn-${message.id}`,
      type: "turn",
      userMessage: message,
      items: [],
      status: "running",
      startedAt: timestamp,
    };
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
    const location = this.#toolItems.get(id);
    const turnId = location?.turnId ?? fallbackTurnId;
    const current = location ? this.#turnItem(turnId, location.itemId) : undefined;
    const currentTool = current?.type === "tool" ? current.tool : undefined;
    const args = Object.keys(update.args).length > 0 ? update.args : currentTool?.args ?? {};
    const created = createToolView(id, update.name || currentTool?.name || "tool", args, currentTool?.startedAt ?? update.timestamp);
    const tool: ToolCallView = {
      ...created,
      ...currentTool,
      name: update.name || currentTool?.name || created.name,
      args,
      status: update.status,
      isError: update.isError,
      ...(update.output !== undefined ? { output: update.output } : currentTool?.output !== undefined ? { output: currentTool.output } : {}),
      ...(update.endedAt !== undefined ? { endedAt: update.endedAt } : currentTool?.endedAt !== undefined ? { endedAt: currentTool.endedAt } : {}),
    };
    const activity: AgentActivityView = {
      id: location?.itemId ?? `tool-${id}`,
      type: "tool",
      tool,
      timestamp: current?.type === "tool" ? current.timestamp : tool.startedAt,
    };
    this.#upsertTurnItem(turnId, activity);
    this.#toolItems.set(id, { turnId, itemId: activity.id });
  }

  #replaceMessageItems(turnId: string, messageId: string, items: AgentActivityView[]): void {
    const previousIds = new Set((this.#messageItems.get(messageId) ?? []).map((location) => location.itemId));
    const replacements = new Map(items.map((item) => [item.id, item]));
    const observedIds = new Set<string>();
    const turn = this.#turn(turnId);
    const nextItems = turn.items.flatMap((current) => {
      const replacement = replacements.get(current.id);
      if (replacement) {
        observedIds.add(current.id);
        return [replacement];
      }
      return previousIds.has(current.id) ? [] : [current];
    });
    for (const item of items) {
      if (!observedIds.has(item.id)) nextItems.push(item);
    }
    this.#replaceTurn({ ...turn, items: nextItems });

    this.#messageItems.set(messageId, items.map((item) => ({ turnId, itemId: item.id })));
    for (const item of items) {
      if (item.type === "tool") this.#toolItems.set(item.tool.id, { turnId, itemId: item.id });
    }
  }

  #upsertTurnItem(turnId: string, item: AgentTurnView["items"][number]): void {
    const turn = this.#turn(turnId);
    const itemIndex = turn.items.findIndex((current) => current.id === item.id);
    const items = [...turn.items];
    if (itemIndex === -1) items.push(item);
    else items[itemIndex] = item;
    this.#replaceTurn({ ...turn, items });
  }

  #setTurnStatus(turnId: string, status: AgentTurnStatus, endedAt?: number): void {
    const turn = this.#turn(turnId);
    this.#replaceTurn({
      ...turn,
      status,
      ...(endedAt === undefined ? {} : { endedAt }),
    });
  }

  #activeTurn(): AgentTurnView | undefined {
    return this.#activeTurnId ? this.#findTurn(this.#activeTurnId) : undefined;
  }

  #findTurn(turnId: string): AgentTurnView | undefined {
    const item = this.#items.find((candidate) => candidate.id === turnId);
    return item?.type === "turn" ? item : undefined;
  }

  #turn(turnId: string): AgentTurnView {
    const turn = this.#findTurn(turnId);
    if (!turn) throw new Error(`Unknown projected turn: ${turnId}`);
    return turn;
  }

  #replaceTurn(next: AgentTurnView): void {
    this.#items = this.#items.map((item) => item.id === next.id ? next : item);
  }

  #replaceTurnAtEnd(next: AgentTurnView): void {
    this.#items = [...this.#items.filter((item) => item.id !== next.id), next];
  }

  #turnItem(turnId: string, itemId: string): AgentTurnView["items"][number] | undefined {
    return this.#findTurn(turnId)?.items.find((item) => item.id === itemId);
  }

  #removeItem(itemId: string): void {
    const items: ConversationItemView[] = [];
    for (const item of this.#items) {
      if (item.id === itemId) continue;
      if (item.type === "turn") {
        items.push({ ...item, items: item.items.filter((turnItem) => turnItem.id !== itemId) });
      } else {
        items.push(item);
      }
    }
    this.#items = items;
  }

  #conversationItems(): Array<ConversationAnnotationView | BranchControlView | AgentActivityView> {
    return this.#items.flatMap((item) => item.type === "turn" ? item.items : [item]);
  }

  #validatedBlocks(content: unknown, attachments: unknown, idPrefix: string): MessageBlockView[] {
    const blocks = contentToBlocks(content, attachments, idPrefix);
    const images = blocks.flatMap((block) => block.type === "images" ? block.images : []);
    validateProjectedImageAttachments(images, this.#maxImages, this.#maxImageBytes);
    return blocks;
  }

  #touch(): void {
    this.#updatedAt = Math.max(Date.now(), this.#updatedAt + 1);
  }
}

function persistedUserTurn(
  entry: RpcSessionEntry,
  timestamp: number,
  blocks: MessageBlockView[],
): AgentTurnView {
  return {
    id: `turn-${entry.id}`,
    type: "turn",
    userMessage: {
      id: `message-${entry.id}`,
      sourceEntryId: entry.id,
      role: "user",
      blocks,
      status: "complete",
      timestamp,
    },
    items: [],
    status: "running",
    startedAt: timestamp,
  };
}

function assistantActivities(
  messageId: string,
  message: Record<string, unknown>,
  status: MessageStatus,
  timestamp: number,
  blocksFromContent: (content: unknown, idPrefix: string) => MessageBlockView[],
): AgentActivityView[] {
  const activities: AgentActivityView[] = [];
  let partIndex = 0;
  if (typeof message.content === "string") {
    if (message.content) activities.push(responseActivity(messageId, partIndex++, [{ type: "text", text: message.content }], status, timestamp));
  } else {
    for (const part of arrayValue(message.content)) {
      if (!isRecord(part) || typeof part.type !== "string") continue;
      if (part.type === "thinking" && typeof part.thinking === "string") {
        activities.push({
          id: `${messageId}:reasoning:${partIndex++}`,
          type: "reasoning",
          text: part.thinking,
          status,
          timestamp,
        });
      } else if (part.type === "text" && typeof part.text === "string" && part.text) {
        activities.push(responseActivity(messageId, partIndex++, [{ type: "text", text: part.text }], status, timestamp));
      } else if (part.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string") {
        activities.push(responseActivity(
          messageId,
          partIndex,
          blocksFromContent([part], `${messageId}-${partIndex}`),
          status,
          timestamp,
        ));
        partIndex += 1;
      } else if (part.type === "toolCall" && typeof part.id === "string") {
        const tool = createToolView(part.id, stringValue(part.name, "tool"), recordValue(part.arguments), timestamp);
        activities.push({ id: `tool-${part.id}`, type: "tool", tool, timestamp });
        partIndex += 1;
      }
    }
  }
  if (status === "error" && typeof message.errorMessage === "string" && message.errorMessage) {
    activities.push(responseActivity(messageId, partIndex, [{ type: "error", text: message.errorMessage }], status, timestamp));
  }
  return activities;
}

function responseActivity(
  messageId: string,
  partIndex: number,
  blocks: MessageBlockView[],
  status: MessageStatus,
  timestamp: number,
): ResponseActivityView {
  return {
    id: `${messageId}:response:${partIndex}`,
    type: "response",
    blocks,
    status,
    timestamp,
  };
}

function branchSummaryView(entry: RpcSessionEntry): BranchSummaryView {
  return {
    id: entry.id,
    type: "branchSummary",
    summary: stringValue(entry.summary, ""),
    timestamp: entryTimestamp(entry),
  };
}

function customMessageView(entry: RpcSessionEntry, blocks: MessageBlockView[]): CustomMessageView {
  return {
    id: entry.id,
    type: "customMessage",
    customType: stringValue(entry.customType, "custom"),
    blocks,
    timestamp: entryTimestamp(entry),
  };
}

function branchControlView(edge: ActiveBranchEdge): BranchControlView {
  return {
    id: branchControlId(edge),
    type: "branchControl",
    branchPointId: edge.branchPointId,
    activeChildEntryId: edge.activeChildEntryId,
    pathCount: edge.pathCount,
  };
}

function branchControlId(edge: ActiveBranchEdge): string {
  return `branch-control:${edge.branchPointId ?? "root"}:${edge.activeChildEntryId}`;
}

function isBranchControl(
  item: ConversationAnnotationView | BranchControlView | AgentActivityView,
): item is BranchControlView {
  return item.type === "branchControl";
}

function toImageViews(
  images: readonly WebviewImageInput[] | readonly ImageAttachmentView[],
): ImageAttachmentView[] {
  return images.map((image) => "dataUrl" in image ? image : {
    id: image.id,
    name: image.name,
    mimeType: image.mimeType,
    dataUrl: `data:${image.mimeType};base64,${image.data}`,
    size: image.size,
  });
}

function rawMessageId(message: Record<string, unknown>, fallback: string): string {
  if (typeof message.id === "string") return message.id;
  if (typeof message.timestamp === "number") return `assistant-${message.timestamp}`;
  return fallback;
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

function entryTimestamp(entry: RpcSessionEntry, message?: Record<string, unknown>): number {
  if (typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp)) return entry.timestamp;
  if (typeof entry.timestamp === "string") {
    const parsed = Date.parse(entry.timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (message && typeof message.timestamp === "number" && Number.isFinite(message.timestamp)) return message.timestamp;
  return 0;
}

function retryAttempt(value: unknown): string | number {
  return typeof value === "number" || typeof value === "string" ? value : "?";
}

function numericValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
