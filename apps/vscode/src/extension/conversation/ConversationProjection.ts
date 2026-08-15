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
  QueuedPromptView,
  ResponseActivityView,
  SessionNoticeLevel,
  SessionNoticeView,
} from "../../shared/model/conversationModel.js";
import { validateProjectedImageAttachments } from "../attachments/normalizeImageAttachment.js";
import {
  ConversationItemStore,
  type AssistantMessageSource,
  type CompactionSource,
  type MessageCorrelationKey,
} from "./ConversationItemStore.js";
import {
  type AdaptedAssistantMessage,
  type AdaptedAssistantPart,
  assistantPartsFromMessage,
  PiAssistantMessageAdapter,
} from "./PiAssistantMessageAdapter.js";
import { contentToBlocks, createToolView, extractText, isRecord, recordValue, stringValue } from "./messageAssembler.js";

export interface ActiveBranchEdge {
  branchPointId: string | null;
  activeChildEntryId: string;
  pathCount: number;
}

export interface ConversationProjectionSnapshot {
  items: readonly ConversationItemView[];
  queuedSteers: readonly QueuedPromptView[];
  queuedFollowUps: readonly QueuedPromptView[];
  updatedAt: number;
}

export type ConversationReconcileResult = "applied" | "reload";

interface PersistedTurnState {
  turnId: string;
  phase: "active" | "error-awaiting-continuation";
}

export class ConversationProjection {
  readonly #store = new ConversationItemStore();
  readonly #assistantMessageAdapter = new PiAssistantMessageAdapter();
  #queuedSteers: QueuedPromptView[] = [];
  #queuedFollowUps: QueuedPromptView[] = [];
  #activeTurnId: string | null = null;
  #persistedTurn: PersistedTurnState | null = null;
  #pendingLiveErrorTurnId: string | null = null;
  #sequence = 0;
  #updatedAt = Date.now();
  readonly #persistedEntryIds = new Set<string>();
  readonly #eligibleLiveTurnIds: string[] = [];
  readonly #eligibleLiveTurnIdSet = new Set<string>();
  #maxImageBytes: number;
  #maxImages: number;

  constructor(maxImageBytes = 10 * 1024 * 1024, maxImages = 12) {
    this.#maxImageBytes = maxImageBytes;
    this.#maxImages = maxImages;
  }

  read(): ConversationProjectionSnapshot {
    return {
      items: this.#store.read(),
      queuedSteers: this.#queuedSteers,
      queuedFollowUps: this.#queuedFollowUps,
      updatedAt: this.#updatedAt,
    };
  }

  replaceEntries(entries: readonly RpcSessionEntry[], branchEdges: readonly ActiveBranchEdge[]): void {
    this.#store.reset();
    this.#activeTurnId = null;
    this.#persistedTurn = null;
    this.#pendingLiveErrorTurnId = null;
    this.#resetStreamingAssistant();
    this.#persistedEntryIds.clear();
    this.#eligibleLiveTurnIds.length = 0;
    this.#eligibleLiveTurnIdSet.clear();

    this.#projectEntries(entries, branchEdges);
    this.#completePersistedTurn(true);
    this.#store.finalizeUnresolvedTools();
    this.#touch();
  }

  reconcileEntries(
    entries: readonly RpcSessionEntry[],
    branchEdges: readonly ActiveBranchEdge[],
  ): ConversationReconcileResult {
    const newEntries = entries.filter((entry) => !this.#persistedEntryIds.has(entry.id));
    // Incremental compaction cannot safely adopt a live view without Pi's
    // structural correlation key. Full replacement clears provisional state and
    // projects the persisted entry independently.
    if (newEntries.some(hasCompactionWithoutCorrelationKey)) return "reload";
    const ownershipConflict = this.#store.preflightPersistedOwnership({
      assistantSources: newEntries.flatMap((entry) => persistedAssistantSource(entry) ?? []),
      compactionSources: newEntries.flatMap((entry) => persistedCompactionSource(entry) ?? []),
    });
    if (ownershipConflict) return "reload";

    const appendedEntryIds = new Set(entries.map((entry) => entry.id));
    const existingControlIds = new Set(this.#conversationItems().filter(isBranchControl).map((control) => control.id));
    for (const edge of branchEdges) {
      if (!existingControlIds.has(branchControlId(edge)) && !appendedEntryIds.has(edge.activeChildEntryId)) {
        return "reload";
      }
    }

    this.#refreshBranchControls(branchEdges);
    this.#projectEntries(entries, branchEdges);
    this.#completePersistedTurn(false);
    this.#touch();
    return "applied";
  }

  setImageLimits(maxImageBytes: number, maxImages: number): void {
    this.#maxImageBytes = maxImageBytes;
    this.#maxImages = maxImages;
  }

  userMessage(sourceEntryId: string): ConversationMessageView | undefined {
    for (const item of this.#store.read()) {
      if (item.type === "turn" && item.userMessage?.sourceEntryId === sourceEntryId) return item.userMessage;
    }
    return undefined;
  }

  appendUserPrompt(text: string, images: WebviewImageInput[], timestamp = Date.now()): string {
    const turn = this.#createUserTurn(text, images, timestamp);
    this.#store.appendItem(turn);
    this.#activeTurnId = turn.id;
    this.#touch();
    return turn.id;
  }

  enqueueSteer(text: string, images: WebviewImageInput[], timestamp = Date.now()): string {
    const id = `queued-steer-${timestamp}-${++this.#sequence}`;
    this.#queuedSteers = [...this.#queuedSteers, queuedPrompt(id, text, images, timestamp)];
    this.#touch();
    return id;
  }

  enqueueFollowUp(text: string, images: WebviewImageInput[], timestamp = Date.now()): string {
    const id = `queued-follow-up-${timestamp}-${++this.#sequence}`;
    this.#queuedFollowUps = [...this.#queuedFollowUps, queuedPrompt(id, text, images, timestamp)];
    this.#touch();
    return id;
  }

  clearQueuedPrompts(): void {
    if (this.#queuedSteers.length === 0 && this.#queuedFollowUps.length === 0) return;
    this.#queuedSteers = [];
    this.#queuedFollowUps = [];
    this.#touch();
  }

  removeQueuedPrompt(id: string): boolean {
    const nextSteers = this.#queuedSteers.filter((item) => item.id !== id);
    const nextFollowUps = this.#queuedFollowUps.filter((item) => item.id !== id);
    if (nextSteers.length === this.#queuedSteers.length && nextFollowUps.length === this.#queuedFollowUps.length) return false;
    this.#queuedSteers = nextSteers;
    this.#queuedFollowUps = nextFollowUps;
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
      this.#resetStreamingAssistant();
    }
    this.#touch();
    return true;
  }

  finalizeLiveState(): void {
    this.#store.finalizeUnresolvedTools();
    this.#assistantMessageAdapter.reset();
    this.#touch();
  }

  applyEvent(event: RpcEvent): void {
    switch (event.type) {
      case "agent_start":
        this.#startAgentTurn();
        break;
      case "agent_end":
        this.#endAgentAttempt(event.willRetry === true);
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
        if (this.#activeTurnId) this.#setTurnStatus(this.#activeTurnId, "running");
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
      this.#completePersistedTurn(true, timestamp);
      const eligibleTurnId = this.#takeEligibleLiveTurnId();
      const eligibleTurn = eligibleTurnId ? this.#findTurn(eligibleTurnId) : undefined;
      if (eligibleTurn?.userMessage) {
        this.#replaceTurnAtEnd({
          ...eligibleTurn,
          userMessage: { ...eligibleTurn.userMessage, sourceEntryId: entry.id, timestamp },
          startedAt: timestamp,
        });
        this.#persistedTurn = { turnId: eligibleTurn.id, phase: "active" };
      } else {
        const turn = persistedUserTurn(
          entry,
          timestamp,
          this.#validatedBlocks(message.content, message.attachments, entry.id),
        );
        this.#store.appendItem(turn);
        this.#persistedTurn = { turnId: turn.id, phase: "active" };
      }
      return;
    }

    if (message.role === "assistant") {
      const turn = this.#persistedTurnFor(entry.id, timestamp);
      const source = persistedAssistantSource(entry);
      if (!source) return;
      const status = assistantMessageStatus(message.stopReason);
      this.#validatedBlocks(message.content, undefined, source.fallbackViewMessageId);
      const placement = this.#store.placeAssistant({
        turnId: turn.id,
        source,
        buildActivities: (viewMessageId) => assistantActivities(
          viewMessageId,
          assistantPartsFromMessage(message),
          typeof message.errorMessage === "string" ? message.errorMessage : undefined,
          status,
          timestamp,
          (content, idPrefix) => this.#validatedBlocks(content, undefined, idPrefix),
        ),
      });
      if (placement.kind === "conflict") throw new Error(`Persisted assistant placement conflict: ${placement.reason}`);
      if (message.stopReason === "error") {
        this.#persistedTurn = { turnId: turn.id, phase: "error-awaiting-continuation" };
      } else if (message.stopReason !== "toolUse") {
        this.#setTurnStatus(turn.id, statusToTurnStatus(status), timestamp);
        this.#persistedTurn = null;
      }
      return;
    }

    if (message.role === "toolResult" && typeof message.toolCallId === "string") {
      const turn = this.#persistedTurnFor(entry.id, timestamp);
      this.#store.upsertTool({
        source: { kind: "persisted", entryId: entry.id },
        fallbackTurnId: turn.id,
        toolCallId: message.toolCallId,
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
    const source = persistedCompactionSource(entry);
    if (!source) return;
    const continuationTurnId = this.#persistedTurn?.phase === "error-awaiting-continuation"
      ? this.#persistedTurn.turnId
      : undefined;
    const placement = this.#store.placeCompaction({
      turnId: continuationTurnId,
      source,
      buildItem: (viewId): CompactionView => ({
        id: viewId,
        type: "compaction",
        summary: stringValue(entry.summary, ""),
        tokensBefore: numericValue(entry.tokensBefore) ?? 0,
        timestamp,
      }),
    });
    if (placement.kind === "conflict") throw new Error(`Persisted compaction placement conflict: ${placement.reason}`);
  }

  #startAgentTurn(): void {
    let active = this.#activeTurn();
    if (this.#hasQueuedPrompts() && active?.status === "running" && active.items.length === 0) {
      this.#store.removeTopLevelItem(active.id);
      this.#activeTurnId = null;
      active = undefined;
    }
    const turn = active?.status === "running"
      ? active
      : this.#promoteNextQueuedPrompt() ?? active;
    if (!turn) {
      this.#activeTurnId = null;
      return;
    }
    this.#activeTurnId = turn.id;
    this.#setTurnStatus(turn.id, "running");
  }

  #endAgentAttempt(willRetry: boolean): void {
    if (!this.#pendingLiveErrorTurnId) return;
    if (willRetry) {
      this.#setTurnStatus(this.#pendingLiveErrorTurnId, "running");
      return;
    }
    this.#setTurnStatus(this.#pendingLiveErrorTurnId, "error", Date.now());
    this.#pendingLiveErrorTurnId = null;
  }

  #settleAgentTurn(): void {
    this.#store.finalizeUnresolvedTools();
    if (this.#activeTurnId) {
      const turn = this.#turn(this.#activeTurnId);
      if (turn.status === "running") {
        this.#setTurnStatus(turn.id, this.#pendingLiveErrorTurnId === turn.id ? "error" : "completed", Date.now());
      }
    }
    this.#pendingLiveErrorTurnId = null;
    this.#activeTurnId = null;
    this.#resetStreamingAssistant();
  }

  #resetStreamingAssistant(): void {
    this.#assistantMessageAdapter.reset();
  }

  #applyAssistantMessageEvent(event: RpcEvent): void {
    const message = this.#assistantMessageAdapter.adapt(event);
    if (!message) return;
    const correlationKey = adaptedCorrelationKey(message);
    if (!correlationKey || this.#store.hasPersistedAssistantOwnership(correlationKey)) return;

    const timestamp = message.timestamp ?? Date.now();
    const turn = this.#activeTurn() ?? this.#ensureLiveTurn(timestamp);
    this.#activeTurnId = turn.id;
    const status: MessageStatus = message.phase === "final"
      ? assistantMessageStatus(message.stopReason)
      : message.legacyFailure ?? "streaming";
    this.#store.placeAssistant({
      turnId: turn.id,
      source: {
        kind: "live",
        correlationKey,
        fallbackViewMessageId: adaptedViewMessageId(message, `assistant-live-${timestamp}-${++this.#sequence}`),
      },
      buildActivities: (viewId) => assistantActivities(
        viewId,
        message.parts,
        message.errorMessage,
        status,
        timestamp,
        (content, idPrefix) => this.#validatedBlocks(content, undefined, idPrefix),
      ),
    });
    if (status === "streaming") this.#setTurnStatus(turn.id, "running");
    else if (status === "error") {
      this.#pendingLiveErrorTurnId = turn.id;
      this.#setTurnStatus(turn.id, "running");
    } else if (status === "aborted") {
      this.#pendingLiveErrorTurnId = null;
      this.#setTurnStatus(turn.id, "aborted", Date.now());
    } else if (message.stopReason !== "toolUse") {
      this.#pendingLiveErrorTurnId = null;
      this.#setTurnStatus(turn.id, "completed", Date.now());
    }
  }

  #applyToolStart(event: RpcEvent): void {
    if (typeof event.toolCallId !== "string") return;
    const turn = this.#liveToolTurnOrCreate(event.toolCallId);
    if (turn) this.#activeTurnId = turn.id;
    this.#store.upsertTool({
      source: { kind: "live" },
      fallbackTurnId: turn?.id,
      toolCallId: event.toolCallId,
      name: stringValue(event.toolName, "tool"),
      args: recordValue(event.args),
      status: "running",
      isError: false,
      timestamp: Date.now(),
    });
  }

  #applyToolUpdate(event: RpcEvent): void {
    if (typeof event.toolCallId !== "string") return;
    const turn = this.#liveToolTurnOrCreate(event.toolCallId);
    this.#store.upsertTool({
      source: { kind: "live" },
      fallbackTurnId: turn?.id,
      toolCallId: event.toolCallId,
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
    const turn = this.#liveToolTurnOrCreate(event.toolCallId);
    const isError = event.isError === true;
    this.#store.upsertTool({
      source: { kind: "live" },
      fallbackTurnId: turn?.id,
      toolCallId: event.toolCallId,
      name: stringValue(event.toolName, "tool"),
      args: recordValue(event.args),
      status: isError ? "error" : "complete",
      output: extractText(event.result).slice(-160_000),
      isError,
      endedAt: Date.now(),
      timestamp: Date.now(),
    });
  }

  #liveToolTurnOrCreate(toolCallId: string): AgentTurnView | undefined {
    return this.#activeTurn() ?? (this.#store.hasTool(toolCallId) ? undefined : this.#ensureLiveTurn(Date.now()));
  }

  #applyLiveCompaction(event: RpcEvent): void {
    const result = recordValue(event.result);
    if (
      typeof result.summary !== "string"
      || typeof result.tokensBefore !== "number"
      || typeof result.firstKeptEntryId !== "string"
    ) return;
    const timestamp = Date.now();
    if (event.willRetry === true && this.#activeTurnId) {
      this.#setTurnStatus(this.#activeTurnId, "running");
    }
    const source: CompactionSource = {
      kind: "live",
      firstKeptEntryId: result.firstKeptEntryId,
      fallbackViewId: `compaction-live-${timestamp}-${++this.#sequence}`,
    };
    this.#store.placeCompaction({
      turnId: this.#activeTurnId ?? undefined,
      source,
      buildItem: (viewId): CompactionView => ({
        id: viewId,
        type: "compaction",
        summary: result.summary as string,
        tokensBefore: result.tokensBefore as number,
        timestamp,
      }),
    });
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
    if (!this.#hasQueuedPrompts()) return false;
    const message = event.message;
    if (!isRecord(message) || message.role !== "user") return false;

    const promoted = this.#takeNextQueuedPrompt();
    if (!promoted) return false;
    if (this.#activeTurnId) {
      const prior = this.#turn(this.#activeTurnId);
      if (prior.status === "running") this.#setTurnStatus(prior.id, "completed", Date.now());
    }
    this.#resetStreamingAssistant();

    const timestamp = numericValue(message.timestamp) ?? promoted.timestamp;
    const turn = this.#createUserTurn(promoted.text, promoted.images, timestamp);
    this.#store.appendItem(turn);
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

  #promoteNextQueuedPrompt(): AgentTurnView | undefined {
    const next = this.#takeNextQueuedPrompt();
    if (!next) return undefined;
    const turn = this.#createUserTurn(next.text, next.images, next.timestamp);
    this.#store.appendItem(turn);
    return turn;
  }

  #takeNextQueuedPrompt(): QueuedPromptView | undefined {
    const steer = this.#queuedSteers[0];
    if (steer) {
      this.#queuedSteers = this.#queuedSteers.slice(1);
      return steer;
    }
    const followUp = this.#queuedFollowUps[0];
    if (followUp) this.#queuedFollowUps = this.#queuedFollowUps.slice(1);
    return followUp;
  }

  #hasQueuedPrompts(): boolean {
    return this.#queuedSteers.length > 0 || this.#queuedFollowUps.length > 0;
  }

  #refreshBranchControls(branchEdges: readonly ActiveBranchEdge[]): void {
    const controls = new Map(branchEdges.map((edge) => [branchControlId(edge), branchControlView(edge)]));
    this.#store.mapItems((item) => {
      if (item.type === "branchControl") return controls.get(item.id) ?? item;
      if (item.type !== "turn") return item;
      return {
        ...item,
        items: item.items.map((turnItem) => turnItem.type === "branchControl" ? controls.get(turnItem.id) ?? turnItem : turnItem),
      };
    });
  }

  #appendPersistedItem(item: ConversationAnnotationView | BranchControlView): void {
    if (this.#persistedTurn) {
      this.#store.upsertTurnItem(this.#persistedTurn.turnId, item);
      return;
    }
    this.#store.appendItem(item);
  }

  #appendLiveItem(item: ConversationAnnotationView | BranchControlView): void {
    if (this.#activeTurnId) {
      this.#store.upsertTurnItem(this.#activeTurnId, item);
      return;
    }
    this.#store.appendItem(item);
  }

  #persistedTurnFor(entryId: string, timestamp: number): AgentTurnView {
    if (this.#persistedTurn) return this.#turn(this.#persistedTurn.turnId);
    const turn: AgentTurnView = {
      id: `turn-${entryId}`,
      type: "turn",
      items: [],
      status: "running",
      startedAt: timestamp,
    };
    this.#store.appendItem(turn);
    this.#persistedTurn = { turnId: turn.id, phase: "active" };
    return turn;
  }

  #completePersistedTurn(force: boolean, endedAt = Date.now()): void {
    if (!this.#persistedTurn) return;
    const turn = this.#findTurn(this.#persistedTurn.turnId);
    // Intermediate refreshes keep the cursor while the live turn can still
    // continue. A forced boundary or a live-finalized error closes it.
    if (
      this.#persistedTurn.phase === "error-awaiting-continuation"
      && !force
      && turn?.status !== "error"
    ) return;
    if (turn?.status === "running") {
      const status = this.#persistedTurn.phase === "error-awaiting-continuation" ? "error" : "completed";
      this.#setTurnStatus(turn.id, status, endedAt);
    }
    this.#persistedTurn = null;
  }

  #ensureLiveTurn(timestamp: number): AgentTurnView {
    const turn: AgentTurnView = {
      id: `turn-orphan-live-${timestamp}-${++this.#sequence}`,
      type: "turn",
      items: [],
      status: "running",
      startedAt: timestamp,
    };
    this.#store.appendItem(turn);
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

  #setTurnStatus(turnId: string, status: AgentTurnStatus, endedAt?: number): void {
    this.#store.setTurnStatus(turnId, status, endedAt);
  }

  #activeTurn(): AgentTurnView | undefined {
    return this.#activeTurnId ? this.#findTurn(this.#activeTurnId) : undefined;
  }

  #findTurn(turnId: string): AgentTurnView | undefined {
    return this.#store.findTurn(turnId);
  }

  #turn(turnId: string): AgentTurnView {
    return this.#store.turn(turnId);
  }

  #replaceTurn(next: AgentTurnView): void {
    this.#store.replaceTurn(next);
  }

  #replaceTurnAtEnd(next: AgentTurnView): void {
    this.#store.replaceTurnAtEnd(next);
  }

  #conversationItems(): Array<ConversationAnnotationView | BranchControlView | AgentActivityView> {
    return this.#store.conversationItems();
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
  parts: readonly AdaptedAssistantPart[],
  errorMessage: string | undefined,
  status: MessageStatus,
  timestamp: number,
  blocksFromContent: (content: unknown, idPrefix: string) => MessageBlockView[],
): AgentActivityView[] {
  const activities: AgentActivityView[] = [];
  for (const part of parts) {
    if (part.type === "thinking") {
      activities.push({
        id: `${messageId}:reasoning:${part.contentIndex}`,
        type: "reasoning",
        text: part.text,
        status,
        timestamp,
      });
    } else if (part.type === "text" && part.text) {
      activities.push(responseActivity(messageId, part.contentIndex, [{ type: "text", text: part.text }], status, timestamp));
    } else if (part.type === "image") {
      activities.push(responseActivity(
        messageId,
        part.contentIndex,
        blocksFromContent([part.content], `${messageId}-${part.contentIndex}`),
        status,
        timestamp,
      ));
    } else if (part.type === "tool") {
      const tool = part.tool.state === "preparing"
        ? {
            state: "preparing" as const,
            rawArguments: part.tool.rawArguments,
            status: "running" as const,
            isError: false,
            startedAt: timestamp,
          }
        : createToolView(part.tool.id, part.tool.name, part.tool.arguments, timestamp);
      activities.push({
        id: `${messageId}:tool:${part.contentIndex}`,
        type: "tool",
        tool,
        timestamp,
      });
    }
  }
  if (status === "error" && errorMessage) {
    const errorIndex = Math.max(-1, ...parts.map((part) => part.contentIndex)) + 1;
    activities.push(responseActivity(messageId, errorIndex, [{ type: "error", text: errorMessage }], status, timestamp));
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

function queuedPrompt(
  id: string,
  text: string,
  images: WebviewImageInput[],
  timestamp: number,
): QueuedPromptView {
  return { id, text, images: toImageViews(images), timestamp };
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

function adaptedViewMessageId(message: AdaptedAssistantMessage, fallback: string): string {
  if (message.id !== undefined) return message.id;
  if (message.timestamp !== undefined) return `assistant-${message.timestamp}`;
  return fallback;
}

function adaptedCorrelationKey(message: AdaptedAssistantMessage): MessageCorrelationKey | undefined {
  if (message.id !== undefined) return `id:${message.id}`;
  if (message.timestamp !== undefined) return `timestamp:${message.timestamp}`;
  return undefined;
}

function messageCorrelationKey(message: Record<string, unknown>): MessageCorrelationKey | undefined {
  if (typeof message.id === "string") return `id:${message.id}`;
  if (typeof message.timestamp === "number" && Number.isFinite(message.timestamp)) {
    return `timestamp:${message.timestamp}`;
  }
  return undefined;
}

function persistedAssistantSource(
  entry: RpcSessionEntry,
): Extract<AssistantMessageSource, { kind: "persisted" }> | undefined {
  if (entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "assistant") return undefined;
  const correlationKey = messageCorrelationKey(entry.message);
  return {
    kind: "persisted",
    entryId: entry.id,
    ...(correlationKey ? { correlationKey } : {}),
    fallbackViewMessageId: `assistant-${entry.id}`,
  };
}

function hasCompactionWithoutCorrelationKey(entry: RpcSessionEntry): boolean {
  return entry.type === "compaction" && typeof entry.firstKeptEntryId !== "string";
}

function persistedCompactionSource(
  entry: RpcSessionEntry,
): Extract<CompactionSource, { kind: "persisted" }> | undefined {
  if (entry.type !== "compaction") return undefined;
  return {
    kind: "persisted",
    entryId: entry.id,
    // Full replacement has no provisional compaction to adopt, so an entry-local
    // fallback preserves distinct persisted records from newer session formats.
    firstKeptEntryId: typeof entry.firstKeptEntryId === "string"
      ? entry.firstKeptEntryId
      : `persisted-entry:${entry.id}`,
    fallbackViewId: entry.id,
  };
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
