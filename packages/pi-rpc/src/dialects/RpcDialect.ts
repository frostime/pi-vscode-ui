import type { RpcCommand, RpcEvent } from "../protocol/rpcTypes.js";
import type { RpcChunkLimits } from "../protocol/RpcChunkAssembler.js";

export interface RpcStartupNegotiation {
  readonly command: RpcCommand;
  readonly chunkLimits: RpcChunkLimits;
}

export interface RpcDialect {
  /** Whether this runtime must send a startup frame before FrostPi sends commands. */
  readonly requiresStartupReady: boolean;
  /** Select a negotiation command from the runtime's startup frame, if supported. */
  getStartupNegotiation?(frame: Record<string, unknown>): RpcStartupNegotiation | undefined;
  /** Validate the successful response to the selected negotiation command. */
  validateNegotiationResponse?(data: unknown): void;
  /** Consume a dialect-specific startup frame. Returns true when the frame is complete. */
  acceptStartupFrame(value: Record<string, unknown>): boolean;
  /** Translate a Pi-shaped request to the runtime's wire vocabulary. */
  normalizeCommand?(command: RpcCommand): RpcCommand;
  /** Adapt successful response data using the original Pi-shaped request. */
  normalizeResponseData?(command: RpcCommand, data: unknown): unknown;
  /** Translate a runtime event into the Pi-shaped event contract. */
  normalizeEvent(event: RpcEvent): RpcEvent;
}
