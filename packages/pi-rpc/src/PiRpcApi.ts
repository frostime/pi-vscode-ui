import type { PiRpcConnection } from "./PiRpcConnection.js";
import type {
  RpcClearQueueResult,
  RpcCommandDescriptor,
  RpcExtensionUiResponse,
  RpcForkResult,
  RpcImageContent,
  RpcModel,
  RpcRemoveQueuedMessageResult,
  RpcSessionEntry,
  RpcSessionState,
  RpcSessionStats,
  StreamingBehavior,
  ThinkingLevel,
} from "./protocol/rpcTypes.js";

export interface PromptOptions {
  images?: RpcImageContent[];
  streamingBehavior?: StreamingBehavior;
  /** Host-side correlation hook; never serialized into the prompt request. */
  onRequestId?: (id: string) => void;
}

export class PiRpcApi {
  constructor(readonly connection: PiRpcConnection) {}

  prompt(message: string, options: PromptOptions = {}): Promise<void> {
    const command = {
      type: "prompt",
      message,
      ...(options.images?.length ? { images: options.images } : {}),
      ...(options.streamingBehavior ? { streamingBehavior: options.streamingBehavior } : {}),
    };
    return options.onRequestId
      ? this.connection.request(command, undefined, options.onRequestId)
      : this.connection.request(command);
  }

  executeExtensionCommand(commandName: string, encodedRequest: string): Promise<void> {
    return this.connection.request({ type: "prompt", message: `/${commandName} ${encodedRequest}` }, null);
  }

  steer(message: string, images?: RpcImageContent[]): Promise<void> {
    return this.connection.request({ type: "steer", message, ...(images?.length ? { images } : {}) });
  }

  followUp(message: string, images?: RpcImageContent[]): Promise<void> {
    return this.connection.request({ type: "follow_up", message, ...(images?.length ? { images } : {}) });
  }

  clearQueue(): Promise<RpcClearQueueResult> {
    return this.connection.request({ type: "clear_queue" });
  }

  /** OMP's confirmed first-text-match removal, not an alias for Pi clear_queue. */
  removeOmpQueuedMessage(message: string, queue: "steering" | "followUp"): Promise<RpcRemoveQueuedMessageResult> {
    return this.connection.request({ type: "remove_queued_message", message, queue });
  }

  abort(): Promise<void> {
    return this.connection.request({ type: "abort" });
  }

  getState(): Promise<RpcSessionState> {
    return this.connection.request({ type: "get_state" });
  }

  async getMessages(): Promise<unknown[]> {
    const data = await this.connection.request<{ messages: unknown[] }>({ type: "get_messages" });
    return data.messages;
  }

  async getEntries(since?: string): Promise<{ entries: RpcSessionEntry[]; leafId: string | null }> {
    return this.connection.request({ type: "get_entries", ...(since ? { since } : {}) });
  }

  fork(entryId: string): Promise<RpcForkResult> {
    return this.connection.request({ type: "fork", entryId }, null);
  }

  /**
   * Replaces the process's session. Like Fork it has no deadline: an extension may ask
   * the user first, and a request abandoned here could still be committed by Pi later.
   */
  newSession(parentSession?: string): Promise<{ cancelled: boolean }> {
    return this.connection.request({ type: "new_session", ...(parentSession ? { parentSession } : {}) }, null);
  }

  switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
    return this.connection.request({ type: "switch_session", sessionPath });
  }

  setSessionName(name: string): Promise<void> {
    return this.connection.request({ type: "set_session_name", name });
  }

  async getCommands(): Promise<RpcCommandDescriptor[]> {
    const data = await this.connection.request<{ commands: RpcCommandDescriptor[] }>({ type: "get_commands" });
    return data.commands;
  }

  async getAvailableModels(): Promise<RpcModel[]> {
    const data = await this.connection.request<{ models: RpcModel[] }>({ type: "get_available_models" });
    return data.models;
  }

  setModel(provider: string, modelId: string): Promise<RpcModel> {
    return this.connection.request({ type: "set_model", provider, modelId });
  }

  setThinkingLevel(level: ThinkingLevel): Promise<void> {
    return this.connection.request({ type: "set_thinking_level", level });
  }

  getSessionStats(): Promise<RpcSessionStats> {
    return this.connection.request({ type: "get_session_stats" });
  }

  compact(customInstructions?: string): Promise<unknown> {
    return this.connection.request({ type: "compact", ...(customInstructions ? { customInstructions } : {}) }, 120_000);
  }

  sendExtensionUiResponse(id: string, response: RpcExtensionUiResponse): Promise<void> {
    return this.connection.sendNotification({ type: "extension_ui_response", id, ...response });
  }
}
